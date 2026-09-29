"""
Whisper speech-to-text on the sherpa-onnx exported graphs (the ITANTRA product's models),
driven directly with onnxruntime.

Why not sherpa-onnx's own decoder: in sherpa-onnx 1.13.x the Whisper result text is built
token by token, and every token that carries only part of a multi-byte UTF-8 character is
dropped. Devanagari characters are 3 bytes and Whisper's byte-level BPE splits them often,
so Hindi/Marathi transcripts lose most of their letters ("मला मदत हवी आहे" -> "मला म").
Here the raw token BYTES are concatenated first and decoded once, which is lossless.

Graph contract (from the model metadata):
  encoder: mel [1, 80, 3000] -> n_layer_cross_k, n_layer_cross_v
  decoder: tokens, in_n_layer_self_{k,v}_cache, n_layer_cross_{k,v}, offset
           -> logits, out_n_layer_self_{k,v}_cache
"""
import base64
import os

import numpy as np
import onnxruntime as ort

_FEATURES = None


def _feature_extractor():
    global _FEATURES
    if _FEATURES is None:
        from transformers import WhisperFeatureExtractor  # exact Whisper log-mel front-end

        _FEATURES = WhisperFeatureExtractor(feature_size=80)
    return _FEATURES


class WhisperOnnx:
    def __init__(self, encoder: str, decoder: str, tokens: str, threads: int = 4):
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        self.encoder = ort.InferenceSession(encoder, so, providers=["CPUExecutionProvider"])
        self.decoder = ort.InferenceSession(decoder, so, providers=["CPUExecutionProvider"])
        meta = self.encoder.get_modelmeta().custom_metadata_map
        self.sot = int(meta["sot"])
        self.eot = int(meta["eot"])
        self.transcribe_id = int(meta["transcribe"])
        self.translate_id = int(meta["translate"])
        self.no_timestamps = int(meta["no_timestamps"])
        self.n_text_layer = int(meta["n_text_layer"])
        self.n_text_ctx = int(meta["n_text_ctx"])
        self.n_text_state = int(meta["n_text_state"])
        self.n_vocab = int(meta["n_vocab"])
        codes = meta["all_language_codes"].split(",")
        ids = [int(x) for x in meta["all_language_tokens"].split(",")]
        self.lang2id = dict(zip(codes, ids))
        self.non_speech = [int(x) for x in meta.get("non_speech_tokens", "").split(",") if x]
        self.id2bytes = {}
        with open(tokens, encoding="utf-8") as fh:
            for line in fh:
                parts = line.rstrip("\n").split(" ")
                if len(parts) != 2:
                    continue
                try:
                    self.id2bytes[int(parts[1])] = base64.b64decode(parts[0])
                except ValueError:
                    continue

    def supports(self, lang: str) -> bool:
        return lang in self.lang2id

    def _mel(self, samples: np.ndarray) -> np.ndarray:
        fe = _feature_extractor()
        feats = fe(samples, sampling_rate=16000, return_tensors="np").input_features
        return feats.astype(np.float32)  # [1, 80, 3000]

    def run(self, samples: np.ndarray, lang: str, task: str = "transcribe", max_tokens: int = 200) -> str:
        samples = samples.astype(np.float32)[: 30 * 16000]
        cross_k, cross_v = self.encoder.run(None, {"mel": self._mel(samples)})
        shape = (self.n_text_layer, 1, self.n_text_ctx, self.n_text_state)
        self_k = np.zeros(shape, dtype=np.float32)
        self_v = np.zeros(shape, dtype=np.float32)

        prompt = [self.sot, self.lang2id[lang], self.translate_id if task == "translate" else self.transcribe_id, self.no_timestamps]
        tokens = np.asarray([prompt], dtype=np.int64)
        offset = np.zeros(1, dtype=np.int64)
        out = []
        suppress = np.zeros(self.n_vocab, dtype=bool)
        suppress[self.eot + 1:] = True  # every special / timestamp token after <|endoftext|>
        for t in self.non_speech:
            if t < self.n_vocab:
                suppress[t] = True

        for step in range(max_tokens):
            logits, self_k, self_v = self.decoder.run(
                None,
                {
                    "tokens": tokens,
                    "in_n_layer_self_k_cache": self_k,
                    "in_n_layer_self_v_cache": self_v,
                    "n_layer_cross_k": cross_k,
                    "n_layer_cross_v": cross_v,
                    "offset": offset,
                },
            )
            offset = offset + tokens.shape[1]
            last = logits[0, -1, :].astype(np.float32)
            last[suppress[: last.shape[0]]] = -np.inf
            if step == 0:
                last[self.eot] = -np.inf  # at least one real token
            nxt = int(np.argmax(last))
            if nxt == self.eot or int(offset[0]) >= self.n_text_ctx - 1:
                break
            out.append(nxt)
            # Stop runaway repetition (a known greedy-decode failure mode on silence).
            if len(out) >= 12 and out[-6:] == out[-12:-6]:
                out = out[:-6]
                break
            tokens = np.asarray([[nxt]], dtype=np.int64)

        raw = b"".join(self.id2bytes.get(i, b"") for i in out)
        return raw.decode("utf-8", errors="ignore").strip()


def load_best(small_dir: str, base_dir: str):
    """Whisper-small upgrade when installed, else the Whisper-base the APK bundles."""
    small = os.path.join(small_dir, "small-encoder.int8.onnx")
    if os.path.isfile(small):
        return "whisper-small", WhisperOnnx(
            small, os.path.join(small_dir, "small-decoder.int8.onnx"), os.path.join(small_dir, "small-tokens.txt")
        )
    base = os.path.join(base_dir, "whisper-base-encoder.int8.onnx")
    if os.path.isfile(base):
        return "whisper-base", WhisperOnnx(
            base, os.path.join(base_dir, "whisper-base-decoder.int8.onnx"), os.path.join(base_dir, "whisper-base-tokens.txt")
        )
    return None, None
