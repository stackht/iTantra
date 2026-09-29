import { isLanguageCode } from '@itantra/shared';
import { VOICE_PACKS } from '../src/tts/catalog.ts';
import { ANDROID_DIR, installVoice, voiceStates } from '../src/tts/installer.ts';

/**
 * npm run voices:install -- hi mr        install specific voices
 * npm run voices:install -- all          every language with an open pack
 * npm run voices:install                 list state
 */
const args = process.argv.slice(2).map((a) => a.toLowerCase());
const wanted = args.includes('all') ? (Object.keys(VOICE_PACKS) as string[]) : args;

console.log(`Android checkout: ${ANDROID_DIR} (override with ITANTRA_ANDROID_DIR)`);
if (wanted.length === 0) {
  for (const state of Object.values(voiceStates())) {
    console.log(`  ${state.lang}  ${state.status.padEnd(10)} ${state.label ?? '—'}  ${state.detail}`);
  }
  console.log('\nUsage: npm run voices:install -- <lang…|all>');
  process.exit(0);
}

let failed = 0;
for (const lang of wanted) {
  if (!isLanguageCode(lang) || !VOICE_PACKS[lang]) {
    console.log(`  ${lang}: no open voice pack — skipped`);
    continue;
  }
  try {
    const manifest = await installVoice(lang, (line) => console.log(line));
    console.log(`  ${lang}: ready — ${manifest.label}`);
  } catch (error) {
    failed += 1;
    console.log(`  ${lang}: failed — ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed > 0 ? 1 : 0);
