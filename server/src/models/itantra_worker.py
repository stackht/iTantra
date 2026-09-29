"""
ITANTRA model worker: runs the Android product's own models for the web prototype.

Speech-to-text: Whisper (the APK's whisper-base int8, or the catalog's whisper-small upgrade),
decoded byte-correctly by whisper_onnx.py.

Translation: the product's Marian (Opus-MT) packs.

Same packs (model-conversion/converted_v2/<src>-<tgt>/), same tokenizer contract and
the same greedy decode as the product's native runtime / verify_native_tokenizer.py:

  encode : source.spm pieces -> vocab.tsv ids (<unk> if absent) -> </s>
  decode : greedy argmax, pad token banned (Marian bad_words_ids), stop at </s>
           ids -> vocab pieces (skip </s>, <pad>) -> target.spm DecodePieces

Protocol: one JSON object per line on stdin, one JSON reply per line on stdout.
  {"id": 1, "op": "translate", "src": "hi", "tgt": "en", "text": "..."}
  {"id": 2, "op": "status"}
  {"id": 3, "op": "transcribe", "lang": "hi", "task": "transcribe", "pcm": "<base64 float32 16 kHz mono>"}
"""
import base64
import json
import os
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")

try:
    import numpy as np
    import onnxruntime as ort
    import sentencepiece as spm
    IMPORT_ERROR = None
except Exception as exc:  # reported through "status", never crashes the hub
    IMPORT_ERROR = f"{type(exc).__name__}: {exc}"

PACK_ROOT = os.environ.get("ITANTRA_MT_DIR", "")
STT_SMALL_DIR = os.environ.get("ITANTRA_STT_SMALL_DIR", "")
STT_BASE_DIR = os.environ.get("ITANTRA_STT_BASE_DIR", "")
_whisper = None
_whisper_id = None
_speller = None
SPELL_DIR = os.environ.get("ITANTRA_SPELL_DIR", "")


def speller():
    global _speller
    if _speller is None:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from spellfix import SpellFixer

        _speller = SpellFixer(SPELL_DIR)
    return _speller


def whisper():
    global _whisper, _whisper_id
    if _whisper is None:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from whisper_onnx import load_best

        _whisper_id, _whisper = load_best(STT_SMALL_DIR, STT_BASE_DIR)
    return _whisper_id, _whisper
# Pairs the product ships (hosted) by default. mr-en exists but the product deliberately
# does not host it (greedy decode reproduces unrelated corpus text on longer input).
ENABLED = [p for p in os.environ.get("ITANTRA_MT_PAIRS", "hi-en,en-hi,en-mr").split(",") if p]
# mr-en: the product converted it (converted_v2/mr-en-fp32) but does not host it because greedy
# decode sometimes emits unrelated text. The prototype uses it only behind a round-trip check.
GATED = {"mr-en": {"models": "mr-en-fp32/models", "check": "en-mr", "min_overlap": 0.45}}
MAX_NEW_TOKENS = 128


class Pack:
    def __init__(self, pair: str, models_dir: str = ""):
        d = os.path.join(PACK_ROOT, pair)
        with open(os.path.join(d, "config.json"), encoding="utf-8") as fh:
            cfg = json.load(fh)
        self.pair = pair
        self.eos = cfg["eos_token_id"]
        self.pad = cfg["pad_token_id"]
        self.start = cfg["decoder_start_token_id"]
        self.id2tok = {}
        self.tok2id = {}
        with open(os.path.join(d, "tokenizer", "vocab.tsv"), encoding="utf-8") as fh:
            for line in fh:
                tid, piece = line.rstrip("\n").split("\t", 1)
                self.id2tok[int(tid)] = piece
                self.tok2id[piece] = int(tid)
        self.unk = self.tok2id.get("<unk>", 1)
        self.sp_src = spm.SentencePieceProcessor(model_file=os.path.join(d, "tokenizer", "source.spm"))
        self.sp_tgt = spm.SentencePieceProcessor(model_file=os.path.join(d, "tokenizer", "target.spm"))
        so = ort.SessionOptions()
        so.intra_op_num_threads = 2
        models = os.path.join(PACK_ROOT, models_dir) if models_dir else os.path.join(d, "models")
        self.enc = ort.InferenceSession(os.path.join(models, "encoder_model.onnx"), so, providers=["CPUExecutionProvider"])
        self.dec = ort.InferenceSession(os.path.join(models, "decoder_model.onnx"), so, providers=["CPUExecutionProvider"])

    def translate(self, text: str) -> str:
        ids = [self.tok2id.get(p, self.unk) for p in self.sp_src.encode(text, out_type=str)] + [self.eos]
        hidden = self.enc.run(["last_hidden_state"], {"input_ids": np.asarray([ids], dtype=np.int64)})[0]
        cur = [self.start]
        out = []
        for _ in range(MAX_NEW_TOKENS):
            logits = self.dec.run(
                ["logits"],
                {"input_ids": np.asarray([cur], dtype=np.int64), "encoder_hidden_states": hidden},
            )[0][0, -1, :].copy()
            if self.pad != self.eos:
                logits[self.pad] = -1e30
            nxt = int(np.argmax(logits))
            if nxt == self.eos:
                break
            cur.append(nxt)
            out.append(nxt)
        pieces = [self.id2tok[i] for i in out if i not in (self.eos, self.pad) and i in self.id2tok]
        return self.sp_tgt.decode_pieces(pieces).strip()


packs: dict = {}


def pack_ready_on_disk(pair: str) -> bool:
    d = os.path.join(PACK_ROOT, pair)
    need = ["config.json", "tokenizer/source.spm", "tokenizer/target.spm", "tokenizer/vocab.tsv"]
    models = os.path.join(PACK_ROOT, GATED[pair]["models"]) if pair in GATED else os.path.join(d, "models")
    return all(os.path.isfile(os.path.join(d, n)) for n in need) and all(
        os.path.isfile(os.path.join(models, m)) for m in ("encoder_model.onnx", "decoder_model.onnx"))


def load_pack(pair: str):
    if pair not in packs:
        packs[pair] = Pack(pair, GATED[pair]["models"] if pair in GATED else "")
    return packs[pair]


def word_overlap(a: str, b: str) -> float:
    strip = str.maketrans("", "", "।.,?!'\"")
    A, B = set(a.translate(strip).split()), set(b.translate(strip).split())
    return len(A & B) / max(1, len(A | B))


def status():
    return {
        "runtime": IMPORT_ERROR is None,
        "error": IMPORT_ERROR,
        "root": PACK_ROOT,
        "pairs": {p: {"installed": pack_ready_on_disk(p), "loaded": p in packs, "gated": p in GATED} for p in list(ENABLED) + list(GATED)},
    }


def handle(req: dict) -> dict:
    op = req.get("op")
    if op == "status":
        return {"ok": True, **status()}
    if op == "transcribe":
        if IMPORT_ERROR:
            return {"ok": False, "error": IMPORT_ERROR}
        started = time.time()
        model_id, model = whisper()
        load_ms = int((time.time() - started) * 1000)
        if model is None:
            return {"ok": False, "error": "No Whisper model found (APK assets or whisper-small upgrade)"}
        lang = str(req.get("lang", "en"))
        if not model.supports(lang):
            return {"ok": False, "error": f"Whisper has no {lang} support"}
        samples = np.frombuffer(base64.b64decode(req.get("pcm", "")), dtype=np.float32)
        started = time.time()
        task = str(req.get("task", "transcribe"))
        raw = model.run(samples, lang, task=task)
        ms = int((time.time() - started) * 1000)
        text, changes = (raw, [])
        if task == "transcribe" and speller().available(lang):
            text, changes = speller().fix(raw, lang)
        return {"ok": True, "text": text, "raw": raw, "corrections": changes, "model": model_id, "ms": ms, "loadMs": load_ms}
    if op == "warm_stt":
        started = time.time()
        model_id, model = whisper()
        if model is not None:
            model.run(np.zeros(16000, dtype=np.float32), "en")
        return {"ok": model is not None, "model": model_id, "ms": int((time.time() - started) * 1000)}
    if op != "translate":
        return {"ok": False, "error": f"unknown op {op}"}
    if IMPORT_ERROR:
        return {"ok": False, "error": IMPORT_ERROR}
    pair = f"{req.get('src')}-{req.get('tgt')}"
    gated = pair in GATED
    if pair not in ENABLED and not gated:
        return {"ok": False, "error": f"no product pack for {pair}"}
    if gated and not req.get("allowGated"):
        return {"ok": False, "error": f"product pack {pair} is not hosted by the product (gated use only)"}
    if not pack_ready_on_disk(pair):
        return {"ok": False, "error": f"pack {pair} not found under {PACK_ROOT}"}
    started = time.time()
    pack = load_pack(pair)
    loaded_ms = int((time.time() - started) * 1000)
    started = time.time()
    source = str(req.get("text", ""))[:1000]
    text = pack.translate(source)
    reply = {"ok": True, "text": text, "pair": pair, "ms": int((time.time() - started) * 1000), "loadMs": loaded_ms}
    if gated:
        rule = GATED[pair]
        back = load_pack(rule["check"]).translate(text) if pack_ready_on_disk(rule["check"]) else ""
        overlap = word_overlap(source, back)
        reply.update({"gated": True, "backTranslation": back, "overlap": round(overlap, 2), "ms": int((time.time() - started) * 1000)})
        if overlap < rule["min_overlap"]:
            reply.update({"ok": False, "error": f"{pair} failed the round-trip check (overlap {overlap:.2f}): {text!r} -> {back!r}"})
    return reply


def main():
    print(json.dumps({"ready": True, **status()}, ensure_ascii=False), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except ValueError:
            continue
        try:
            reply = handle(req)
        except Exception as exc:
            reply = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        reply["id"] = req.get("id")
        print(json.dumps(reply, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
