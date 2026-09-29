import type { LanguageCode, LanguageInfo } from './types.ts';

export const LANGUAGES: LanguageInfo[] = [
  {
    code: 'hi',
    name: 'Hindi',
    nativeName: 'हिन्दी',
    script: 'Devanagari',
    flag: '🇮🇳',
    level: 'DEMO_READY',
    note: 'Whisper STT · Opus-MT hi↔en · Piper hi_IN voice — all from the ITANTRA Android project.',
    capability: { tag: 'hi-IN', stt: 'browser-dependent', tts: 'browser-dependent', translation: 'available' },
  },
  {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    script: 'Latin',
    flag: '🇬🇧',
    level: 'DEMO_READY',
    note: 'Pivot language. Whisper STT · Opus-MT · Piper en_US voice — from the ITANTRA Android project.',
    capability: { tag: 'en-IN', stt: 'browser-dependent', tts: 'browser-dependent', translation: 'available' },
  },
  {
    code: 'mr',
    name: 'Marathi',
    nativeName: 'मराठी',
    script: 'Devanagari',
    flag: '🇮🇳',
    level: 'DEMO_READY',
    note: 'Whisper STT · Opus-MT en→mr (mr→en via demo dataset) · Piper mr_IN voice — from the ITANTRA Android project.',
    capability: { tag: 'mr-IN', stt: 'browser-dependent', tts: 'browser-dependent', translation: 'available' },
  },
  {
    code: 'gu',
    name: 'Gujarati',
    nativeName: 'ગુજરાતી',
    script: 'Gujarati',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'gu-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
  {
    code: 'bn',
    name: 'Bengali',
    nativeName: 'বাংলা',
    script: 'Bengali',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'bn-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
  {
    code: 'ta',
    name: 'Tamil',
    nativeName: 'தமிழ்',
    script: 'Tamil',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'ta-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
  {
    code: 'te',
    name: 'Telugu',
    nativeName: 'తెలుగు',
    script: 'Telugu',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'te-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
  {
    code: 'kn',
    name: 'Kannada',
    nativeName: 'ಕನ್ನಡ',
    script: 'Kannada',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'kn-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
  {
    code: 'ml',
    name: 'Malayalam',
    nativeName: 'മലയാളം',
    script: 'Malayalam',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'ml-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
  {
    code: 'or',
    name: 'Odia',
    nativeName: 'ଓଡ଼ିଆ',
    script: 'Odia',
    flag: '🇮🇳',
    level: 'FUTURE',
    note: 'Future implementation — speech, translation and voice models for this language are not part of the prototype.',
    capability: { tag: 'or-IN', stt: 'planned', tts: 'planned', translation: 'planned' },
  },
];

const BY_CODE = new Map<LanguageCode, LanguageInfo>(LANGUAGES.map((l) => [l.code, l]));

/** Languages the prototype actually runs end to end. Everything else is future implementation. */
export const ACTIVE_LANGUAGES: LanguageCode[] = ['en', 'hi', 'mr'];

export function isActiveLanguage(code: LanguageCode): boolean {
  return ACTIVE_LANGUAGES.includes(code);
}

export function getLanguage(code: LanguageCode): LanguageInfo {
  const info = BY_CODE.get(code);
  if (!info) throw new Error(`Unknown language code: ${code}`);
  return info;
}

export function isLanguageCode(value: string): value is LanguageCode {
  return BY_CODE.has(value as LanguageCode);
}

export function languageName(code: LanguageCode): string {
  return getLanguage(code).name;
}
