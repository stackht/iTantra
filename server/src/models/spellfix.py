"""
Transcript clean-up with the ITANTRA product's own spellcheck dictionaries.

The Android app ships assets/spellcheck/{hi,mr,en}.bloom (built by
model-conversion/build_spellcheck_wordlist.py) and uses them in SpellCheckEngine to FLAG
words Whisper got wrong. The prototype goes one step further with the same data: for a word
the dictionary does not know, it tries the spelling slips Whisper typically makes in
Devanagari and keeps a variant the dictionary does know.

Why it matters: Opus-MT is very sensitive to these slips. "मुजे मदद चाहीए" (Whisper) pivots to
"Father's help was needed"; the corrected "मुझे मदद चाहिए" pivots to "I need help".

Bloom format (must match SpellCheckEngine.kt / build_spellcheck_wordlist.py):
  "ITBF1" | k: u8 | m: u64 BE | n: u64 BE | bit array
  h1 = FNV-1a-64(utf8), h2 = FNV-1-64(utf8) | 1, bit_i = (h1 + i*h2 mod 2^64) mod m
"""
import os
import re
import struct

FNV_OFFSET = 0xCBF29CE484222325
FNV_PRIME = 0x100000001B3
MASK64 = (1 << 64) - 1

NUKTA = "़"
# Precomposed nukta letters and their bare forms.
NUKTA_PAIRS = [("ड़", "ड"), ("ढ़", "ढ"), ("ज़", "ज"), ("फ़", "फ"), ("क़", "क"), ("ख़", "ख"), ("ग़", "ग")]

# Single-edit substitutions, most likely Whisper slips first. Each pair is tried both ways.
SUBSTITUTIONS = [
    # vowel signs (long/short)
    ("ी", "ि"), ("ू", "ु"), ("े", "ै"), ("ो", "ौ"),
    # nasalisation
    ("ँ", "ं"),
    # aspiration
    ("ज", "झ"), ("छ", "झ"), ("क", "ख"), ("ग", "घ"), ("द", "ध"), ("ब", "भ"), ("त", "थ"), ("प", "फ"), ("च", "छ"), ("ट", "ठ"), ("ड", "ढ"),
    # retroflex flap heard as r
    ("र", "ड़"), ("र", "ड"),
    # sibilants
    ("स", "श"), ("श", "ष"),
    # voicing
    ("त", "द"), ("क", "ग"), ("प", "ब"), ("च", "ज"), ("ट", "ड"),
]
# Whole-suffix rewrites for common endings.
SUFFIXES = [("ीे", "िए"), ("िे", "िए"), ("ीए", "िए"), ("ीये", "िए"), ("िये", "िए"), ("ये", "ए"), ("ए", "ये")]

WORD = re.compile(r"[ऀ-ॿ]+")


class Bloom:
    def __init__(self, path: str):
        with open(path, "rb") as fh:
            data = fh.read()
        if data[:5] != b"ITBF1":
            raise ValueError(f"{path}: not an ITBF1 bloom filter")
        self.k = data[5]
        self.m = struct.unpack(">Q", data[6:14])[0]
        self.n = struct.unpack(">Q", data[14:22])[0]
        self.bits = data[22:]

    def __contains__(self, word: str) -> bool:
        raw = word.encode("utf-8")
        h1 = FNV_OFFSET
        for b in raw:
            h1 ^= b
            h1 = (h1 * FNV_PRIME) & MASK64
        h2 = FNV_OFFSET
        for b in raw:
            h2 = (h2 * FNV_PRIME) & MASK64
            h2 ^= b
        h2 |= 1
        for i in range(self.k):
            idx = ((h1 + i * h2) & MASK64) % self.m
            if not self.bits[idx // 8] & (1 << (idx % 8)):
                return False
        return True


def _normalise(word: str) -> str:
    # Compose "letter + U+093C" into the precomposed nukta letter used by the dictionaries.
    for composed, bare in NUKTA_PAIRS:
        word = word.replace(bare + NUKTA, composed)
    return word


def _single_edits(word: str):
    for a, b in SUFFIXES:
        if word.endswith(a):
            yield word[: -len(a)] + b
    for composed, bare in NUKTA_PAIRS:
        for i in range(len(word)):
            if word[i] == bare:
                yield word[:i] + composed + word[i + 1:]
            elif word[i] == composed:
                yield word[:i] + bare + word[i + 1:]
    for a, b in SUBSTITUTIONS:
        for x, y in ((a, b), (b, a)):
            start = 0
            while True:
                i = word.find(x, start)
                if i < 0:
                    break
                yield word[:i] + y + word[i + len(x):]
                start = i + 1


class SpellFixer:
    def __init__(self, bloom_dir: str):
        self.filters = {}
        for lang in ("hi", "mr"):
            path = os.path.join(bloom_dir, f"{lang}.bloom")
            if os.path.isfile(path):
                self.filters[lang] = Bloom(path)

    def available(self, lang: str) -> bool:
        return lang in self.filters

    def _prefer_flap(self, word: str, bloom) -> str:
        """Hindi writes the flap as ड़/ढ़ inside words (गाड़ी, पढ़ना) but Whisper often drops the
        nukta and the bare spelling is also listed. Opus-MT only knows the standard form, so a
        non-initial ड/ढ not following a nasal or virama becomes ड़/ढ़ when the dictionary has it."""
        for bare, flap in (("ड", "ड़"), ("ढ", "ढ़")):
            i = word.find(bare, 1)
            while i > 0:
                if word[i - 1] not in "ंँ्":
                    cand = word[:i] + flap + word[i + 1:]
                    if cand in bloom:
                        word = cand
                i = word.find(bare, i + 1)
        return word

    def fix_word(self, word: str, lang: str):
        bloom = self.filters[lang]
        word = _normalise(word)
        if len(word) < 2:
            return word
        if word in bloom:
            return self._prefer_flap(word, bloom) if lang == "hi" else word
        seen = set()
        first = []
        for cand in _single_edits(word):
            if cand in seen:
                continue
            seen.add(cand)
            if cand in bloom:
                return cand
            first.append(cand)
        # Two slips in one word (e.g. "गारी" -> "गाड़ी" needs one, "गारे" needs two).
        # Hindi only: the Marathi dictionary has 2.9M forms, so a two-letter search finds
        # false matches for garbled words.
        if lang != "hi":
            return word
        for cand in first[:60]:
            for cand2 in _single_edits(cand):
                if cand2 not in seen and cand2 in bloom:
                    return cand2
                seen.add(cand2)
        return word

    def fix(self, text: str, lang: str):
        """Returns (corrected_text, [(from, to), ...])."""
        if lang not in self.filters:
            return text, []
        changes = []

        def repl(m):
            original = m.group(0)
            fixed = self.fix_word(original, lang)
            if fixed != original:
                changes.append((original, fixed))
            return fixed

        return WORD.sub(repl, text), changes
