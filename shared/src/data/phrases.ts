import type { LanguageCode } from '../types.ts';

/**
 * Curated demo dataset.
 *
 * Every entry is a parallel sentence across the prototype languages, keyed by an
 * English pivot sentence. This is NOT machine translation: it exists so the
 * communication pipeline can be demonstrated deterministically and offline.
 * Anything outside this table is reported honestly as unresolved by the dataset.
 */
export interface PhraseEntry {
  id: string;
  /** English pivot sentence (also the id used by the demo script). */
  pivot: string;
  hi: string;
  mr: string;
  gu: string;
  bn: string;
  ta: string;
  te: string;
  kn: string;
  ml: string;
  or: string;
  /** Extra spellings accepted by the matcher (punctuation/variant tolerant). */
  variants?: Partial<Record<LanguageCode, string[]>>;
}

export const PHRASES: PhraseEntry[] = [
  {
    id: 'need-help',
    pivot: 'I need help.',
    hi: 'मुझे मदद चाहिए',
    mr: 'मला मदत हवी आहे',
    gu: 'મને મદદ જોઈએ છે',
    bn: 'আমার সাহায্য দরকার',
    ta: 'எனக்கு உதவி தேவை',
    te: 'నాకు సహాయం కావాలి',
    kn: 'ನನಗೆ ಸಹಾಯ ಬೇಕು',
    ml: 'എനിക്ക് സഹായം വേണം',
    or: 'ମୁନକୁ ସାହାଯ୍ୟ ଦରକାର',
    variants: {
      hi: ['मदद चाहिए', 'मुझे मदद चाहिये', 'मदद चाहिये'],
      mr: ['मला मदत हवी आहे', 'मदत हवी आहे', 'मला मदत हवी आहे.'],
    },
  },
  {
    id: 'where-are-you',
    pivot: 'Where are you?',
    hi: 'आप कहाँ हैं?',
    mr: 'तुम्ही कुठे आहात?',
    gu: 'તમે ક્યાં છો?',
    bn: 'আপনি কোথায়?',
    ta: 'நீங்கள் எங்கே இருக்கிறீர்கள்?',
    te: 'మీరు ఎక్కడ ఉన్నారు?',
    kn: 'ನೀವು ಎಲ್ಲಿದ್ದೀರಿ?',
    ml: 'നിങ്ങൾ എവിടെയാണ്?',
    or: 'ତୁମେ କେଉଁଥି?',
    variants: {
      hi: ['आप कहाँ है', 'आप कहाँ हैं', 'तुम कहाँ हो'],
      mr: ['तुम्ही कुठे आहात', 'तू कुठे आहेस'],
    },
  },
  {
    id: 'i-am-safe',
    pivot: 'I am safe.',
    hi: 'मैं सुरक्षित हूँ',
    mr: 'मी सुरक्षित आहे',
    gu: 'હું સુરક્ષિત છું',
    bn: 'আমি নিরাপদ',
    ta: 'நான் பாதுகாப்பாக உள்ளேன்',
    te: 'నేను క్షేమం',
    kn: 'ನಾನು ಸುರಕ್ಷಿತ',
    ml: 'ഞാൻ സുരക്ഷിതനാണ്',
    or: 'ମୁଁ ସୁରକ୍ଷିତ',
    variants: { hi: ['मैं सुरक्षित हुं', 'मैं सुरक्षित हूँ'], mr: ['मी सुरक्षित आहे'] },
  },
  {
    id: 'i-need-water',
    pivot: 'I need water.',
    hi: 'मुझे पानी चाहिए',
    mr: 'मला पाणी हवे आहे',
    gu: 'મને પાણી જોઈએ છે',
    bn: 'আমার জল দরকার',
    ta: 'எனக்கு தண்ணீர் தேவை',
    te: 'నాకు నీరు కావాలి',
    kn: 'ನನಗೆ ನೀರು ಬೇಕು',
    ml: 'എനിക്ക് വെള്ളം വേണം',
    or: 'ମୁନକୁ ପାଣୀ ଦରକାର',
    variants: { hi: ['मुझे पानी चाहिये', 'पानी चाहिए'], mr: ['मला पाणी हवे आहे'] },
  },
  {
    id: 'we-have-arrived',
    pivot: 'We have arrived here.',
    hi: 'हम यहाँ पहुँच गए हैं',
    mr: 'आम्ही इथे पोहोचलो आहोत',
    gu: 'અમે અહીં પહોંચી ગયા છીએ',
    bn: 'আমরা এখানে পৌঁছে গেছি',
    ta: 'நாங்கள் இங்கே வந்துவிட்டோம்',
    te: 'మేము ఇక్కడ చేరుకున్నాము',
    kn: 'ನಾವು ಇಲ್ಲಿಗೆ ತಲುಪಿದ್ದೇವೆ',
    ml: 'ഞങ്ങൾ ഇവിടെ എത്തിച്ചു',
    or: 'ଆମେ ଏଠାରେ ପହଞ୍ଚିଛୁ',
  },
  {
    id: 'can-you-hear-me',
    pivot: 'Can you hear me?',
    hi: 'क्या आप मेरी आवाज़ सुन सकते हैं?',
    mr: 'तुम्ही माझा आवाज ऐकता आहात का?',
    gu: 'શું તમે મારો અવાજ સાંભળી શકો છો?',
    bn: 'আপনি কি আমার কথা শুনতে পাচ্ছেন?',
    ta: 'நீங்கள் என்னைக் கேட்க முடியுமா?',
    te: 'మీరు నన్ను వింటగలరా?',
    kn: 'ನೀನು ಕೇಳಿಸಬಹುದೇ?',
    ml: 'എന്നെ കേൾക്കാമോ?',
    or: 'ତୁମେ ମୁଁକୁ ଶୁଣିପାରିବ କି?',
    variants: {
      hi: ['क्या आप मेरी आवाज सुना सकते हैं', 'क्या आप सुन सकते हैं'],
      mr: ['तुम्ही माझा आवाज ऐकता आहात का'],
    },
  },
  {
    id: 'need-immediate-help',
    pivot: 'I need immediate help.',
    hi: 'मुझे तुरंत सहायता चाहिए',
    mr: 'मला लगेच मदत हवी आहे',
    gu: 'મને તરત મદદ જોઈએ છે',
    bn: 'আমার এখনই সাহায্য দরকার',
    ta: 'எனக்கு உடனே உதவி தேவை',
    te: 'నాకు వెంటనే సహాయం కావాలి',
    kn: 'ನನಗೆ ತಕ್ಷಣ ಸಹಾಯ ಬೇಕು',
    ml: 'എനിക്ക് ഉടൻ സഹായം വേണം',
    or: 'ମୁନକୁ ତକ୍ଷଣ ସାହାଯ୍ୟ ଦରକାର',
    variants: { hi: ['मुझे तुरंत मदद चाहिए', 'मुझे तुरंत सहायता चाहिये'], mr: ['मला लगेच मदत हवी आहे'] },
  },
  {
    id: 'coming-to-help',
    pivot: 'I am coming to help you.',
    hi: 'मैं आपकी मदद के लिए आ रहा हूँ',
    mr: 'मी तुमच्या मदतीसाठी येत आहे',
    gu: 'હું તમારી મદદ માટે આવું છું',
    bn: 'আমি আপনাকে সাহায্য করতে আসছি',
    ta: 'நான் உங்களுக்கு உதவ வருகிறேன்',
    te: 'నేను మీకు సహాయం చేయడానికి వస్తున్నాను',
    kn: 'ನಾನು ನಿನಗೆ ಸಹಾಯ ಮಾಡಲು ಬರುತ್ತಿದ್ದೇನೆ',
    ml: 'ഞാൻ നിങ്ങൾക്ക് സഹായിക്കാൻ വരുന്നു',
    or: 'ମୁଁ ତୁମକୁ ସାହାଯ୍ୟ କରିବାକୁ ଆସୁଛି',
    variants: { mr: ['मी मदतीसाठी येत आहे', 'मी येत आहे'] },
  },
  {
    id: 'i-understand',
    pivot: 'I understand.',
    hi: 'मैं समझ गया',
    mr: 'मला कळले',
    gu: 'મને સમજાયું',
    bn: 'আমি বুঝেছি',
    ta: 'எனக்குப் புரிந்தது',
    te: 'నాకు అర్థమైంది',
    kn: 'ನನಗೆ ಅರ್ಥವಾಯಿತು',
    ml: 'എനിക്ക് മനസ്സിലായി',
    or: 'ମୁଁ ବୁଝିଲି',
  },
  {
    id: 'do-not-understand',
    pivot: 'I do not understand.',
    hi: 'मैं नहीं समझा',
    mr: 'मला कळलं नाही',
    gu: 'મને સમજાયું નથી',
    bn: 'আমি বুঝতে পারছি না',
    ta: 'எனக்குப் புரியவில்லை',
    te: 'నాకు అర్థం కావడం లేదు',
    kn: 'ನನಗೆ ಅರ್ಥವಾಗುತ್ತಿಲ್ಲ',
    ml: 'എനിക്ക് മനസ്സിലാകുന്നില്ല',
    or: 'ମୁଁ ବୁଝିପାରୁନି',
  },
  {
    id: 'repeat-please',
    pivot: 'Repeat please.',
    hi: 'कृपया दोहराइए',
    mr: 'कृपया पुन्हा सांगा',
    gu: 'કૃપા કરીને ફરી કહો',
    bn: 'দয়া করে আবার বলুন',
    ta: 'தயவுசெய்து மீண்டும் சொல்லுங்கள்',
    te: 'దయచేసి మళ్ళీ చెప్పండి',
    kn: 'ದಯವಿಟ್ಟು ಮತ್ತೆ ಹೇಳಿ',
    ml: 'ദയവേടി വീണ്ടും പറയൂ',
    or: 'ଦୟାକରି ପୁନର୍ବାର୍ତ୍ତ କୁହନ୍ତୁ',
  },
  {
    id: 'come-here',
    pivot: 'Come here.',
    hi: 'यहाँ आइए',
    mr: 'इथे येका',
    gu: 'અહીં આવો',
    bn: 'এখানে আসুন',
    ta: 'இங்கே வாருங்கள்',
    te: 'ఇక్కడకు రండి',
    kn: 'ಇಲ್ಲಿಗೆ ಬನ್ನಿ',
    ml: 'ഇവിടെക്ക് വരൂ',
    or: 'ଏଠାରେ ଆସନ୍ତୁ',
  },
  {
    id: 'thank-you',
    pivot: 'Thank you.',
    hi: 'धन्यवाद',
    mr: 'धन्यवाद',
    gu: 'આભાર',
    bn: 'ধন্যবাদ',
    ta: 'நன்றி',
    te: 'ధన్యవాదాలు',
    kn: 'ಧನ್ಯವಾದ',
    ml: 'നന്മസ്കാരങ്ങൾ',
    or: 'ଧନ୍ୟବାଦ',
  },
  {
    id: 'yes',
    pivot: 'Yes.',
    hi: 'हाँ',
    mr: 'हो',
    gu: 'હા',
    bn: 'হ্যাঁ',
    ta: 'ஆம்',
    te: 'అవును',
    kn: 'ಹೌದು',
    ml: 'അതെ',
    or: 'ହଁ',
  },
];

export const PIVOT_INDEX: Map<string, PhraseEntry> = new Map(PHRASES.map((p) => [p.pivot.toLowerCase(), p]));

/** Text for a pivot id, used by the demo script so it stays in sync with the dataset. */
export function phraseById(id: string): PhraseEntry {
  const entry = PHRASES.find((p) => p.id === id);
  if (!entry) throw new Error(`Unknown phrase id: ${id}`);
  return entry;
}
