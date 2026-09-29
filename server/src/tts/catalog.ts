import type { LanguageCode } from '@itantra/shared';

/**
 * Open-licensed sherpa-onnx Piper/VITS voices — the same packs the Android
 * product installs. Sources, in order: a local copy inside the Android repo
 * checkout (`ITANTRA_ANDROID_DIR`), then the public release URL.
 *
 * Languages without an open voice are deliberately absent (the product refuses
 * non-commercial voices such as Meta MMS-TTS); the browser voice is used instead.
 */
export interface VoicePack {
  lang: LanguageCode;
  id: string;
  label: string;
  license: string;
  sizeBytes: number;
  /** File name inside `<android repo>/model-conversion/converted/open-tts/`. */
  localFile: string;
  url: string;
}

const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models';
const ITANTRA = 'https://github.com/NihalMishra3009/ITANTRA/releases/download/tts-open-v1';

export const VOICE_PACKS: Partial<Record<LanguageCode, VoicePack>> = {
  en: {
    lang: 'en',
    id: 'vits-piper-en_US-ljspeech-high-int8',
    label: 'Piper en_US-ljspeech (high, INT8)',
    license: 'Public domain dataset · MIT runtime',
    sizeBytes: 33_886_472,
    localFile: 'vits-piper-en_US-ljspeech-high-int8.tar.bz2',
    url: `${SHERPA}/vits-piper-en_US-ljspeech-high-int8.tar.bz2`,
  },
  hi: {
    lang: 'hi',
    id: 'vits-piper-hi_IN-pratham-medium-int8',
    label: 'Piper hi_IN-pratham (medium, INT8)',
    license: 'Open (see MODEL_CARD)',
    sizeBytes: 20_987_965,
    localFile: 'vits-piper-hi_IN-pratham-medium-int8.tar.bz2',
    url: `${SHERPA}/vits-piper-hi_IN-pratham-medium-int8.tar.bz2`,
  },
  mr: {
    lang: 'mr',
    id: 'vits-piper-mr_IN-google-medium-int8',
    label: 'Piper mr_IN-google (medium, INT8)',
    license: 'CC BY-SA 4.0 (OpenSLR 64)',
    sizeBytes: 22_079_724,
    localFile: 'vits-piper-mr_IN-google-medium-int8.tar.bz2',
    url: `${ITANTRA}/vits-piper-mr_IN-google-medium-int8.tar.bz2`,
  },
  bn: {
    lang: 'bn',
    id: 'vits-piper-bn_BD-google-medium-int8',
    label: 'Piper bn_BD-google (medium, INT8)',
    license: 'CC BY-SA 4.0 (OpenSLR)',
    sizeBytes: 21_999_797,
    localFile: 'vits-piper-bn_BD-google-medium-int8.tar.bz2',
    url: `${ITANTRA}/vits-piper-bn_BD-google-medium-int8.tar.bz2`,
  },
  te: {
    lang: 'te',
    id: 'vits-piper-te_IN-venkatesh-medium-int8',
    label: 'Piper te_IN-venkatesh (medium, INT8)',
    license: 'Open (see MODEL_CARD)',
    sizeBytes: 20_960_788,
    localFile: 'vits-piper-te_IN-venkatesh-medium-int8.tar.bz2',
    url: `${ITANTRA}/vits-piper-te_IN-venkatesh-medium-int8.tar.bz2`,
  },
  ml: {
    lang: 'ml',
    id: 'vits-piper-ml_IN-meera-medium-int8',
    label: 'Piper ml_IN-meera (medium, INT8)',
    license: 'IndicTTS corpus — licence unverified upstream',
    sizeBytes: 20_183_613,
    localFile: 'vits-piper-ml_IN-meera-medium-int8.tar.bz2',
    url: `${SHERPA}/vits-piper-ml_IN-meera-medium-int8.tar.bz2`,
  },
};

/** Prototype scope: voices are offered for English, Hindi and Marathi only. */
export const ALL_LANGUAGES: LanguageCode[] = ['en', 'hi', 'mr'];
