export type PersonaId = 'amo' | 'keri';
export type PersonaGender = 'male' | 'female';

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  gender: PersonaGender;
  voice: string;
  description: string;
}

export interface DialectConfig {
  id: string;
  name: string;
}

export const AI_CONFIG = {
  chat: {
    provider: 'mistral',
    apiUrl: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    apiKeyConsoleUrl: 'https://console.mistral.ai/api-keys/',
  },
  tts: {
    provider: 'tts.ai',
    apiUrl: 'https://api.tts.ai/v1/tts',
    model: 'kokoro',
    apiKeyEnvVar: 'VITE_TTS_AI_API_KEY',
    defaultVoice: 'af_bella',
    voices: {
      am_adam: 'am_adam',
      am_michael: 'am_michael',
      bm_lewis: 'bm_lewis',
      bm_george: 'bm_george',
      bf_emma: 'bf_emma',
      bf_isabella: 'bf_isabella',
      af_nicole: 'af_nicole',
      af_sarah: 'af_sarah',
      af_bella: 'af_bella',
    } as const,
  },
  stt: {
    android: 'native-sherpa',
    web: 'browser-speech-recognition',
  },
  defaults: {
    language: 'en-NZ',
    speechRate: 0.98,
    pitchByGender: {
      male: 0.98,
      female: 1.02,
    } as const,
  },
} as const;

export const PERSONAS: PersonaConfig[] = [
  {
    id: 'amo',
    name: 'Amo',
    gender: 'male',
    voice: 'bm_lewis',
    description: 'A friendly and wise male chatbot from Aotearoa with a British accent.',
  },
  {
    id: 'keri',
    name: 'Keri',
    gender: 'female',
    voice: 'bf_isabella',
    description: 'A warm and knowledgeable female chatbot from Aotearoa.',
  },
];

export const DIALECTS: DialectConfig[] = [
  { id: 'standard', name: 'General / Standard' },
  { id: 'ngapuhi', name: 'Ngapuhi (Northland)' },
  { id: 'tainui', name: 'Tainui (Waikato)' },
  { id: 'ngatiporou', name: 'Ngati Porou (East Coast)' },
  { id: 'ngaitahu', name: 'Ngai Tahu (South Island)' },
  { id: 'tearawa', name: 'Te Arawa (Bay of Plenty)' },
];

export function getPersonaById(id: string) {
  return PERSONAS.find((persona) => persona.id === id) || PERSONAS[0];
}

export function getDialectById(id: string) {
  return DIALECTS.find((dialect) => dialect.id === id) || DIALECTS[0];
}

export function getTtsVoiceId(voiceId?: string) {
  if (!voiceId) {
    return AI_CONFIG.tts.defaultVoice;
  }

  return AI_CONFIG.tts.voices[voiceId as keyof typeof AI_CONFIG.tts.voices] || AI_CONFIG.tts.defaultVoice;
}
