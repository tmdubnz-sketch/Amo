export type PersonaId = 'amo' | 'keri';
export type PersonaGender = 'male' | 'female';

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  gender: PersonaGender;
  voice: string;
  voiceSettings?: {
    stability: number;
    similarityBoost: number;
    style: number;
    speed: number;
    useSpeakerBoost: boolean;
  };
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
    temperature: {
      chat: 0.35,
      fact: 0.55,
    },
    apiKeyConsoleUrl: 'https://console.mistral.ai/api-keys/',
  },
  tts: {
    provider: 'elevenlabs',
    apiUrl: 'https://api.elevenlabs.io/v1/text-to-speech',
    model: 'eleven_flash_v2_5',
    apiKeyEnvVar: 'VITE_ELEVENLABS_API_KEY',
    outputFormat: 'mp3_44100_128',
    defaultVoice: 'EXAVITQu4vr4xnSDxMaL',
    voiceSettings: {
      stability: 0.5,
      similarityBoost: 0.86,
      style: 0.1,
      speed: 0.93,
      useSpeakerBoost: true,
    },
    voices: {
      amo: 'e0AEsbgqftMjHpp59oG2',
      keri: 'EXAVITQu4vr4xnSDxMaL',
    } as const,
  },
  stt: {
    android: 'native-sherpa',
    web: 'browser-speech-recognition',
  },
  defaults: {
    language: 'en-NZ',
  },
} as const;

export const PERSONAS: PersonaConfig[] = [
  {
    id: 'amo',
    name: 'Amo',
    gender: 'male',
    voice: 'amo',
    voiceSettings: {
      stability: 0.78,
      similarityBoost: 0.92,
      style: 0.0,
      speed: 0.88,
      useSpeakerBoost: true,
    },
    description: 'A grounded, serious male chatbot from Aotearoa with a lower, steadier voice and a British-leaning accent.',
  },
  {
    id: 'keri',
    name: 'Keri',
    gender: 'female',
    voice: 'keri',
    voiceSettings: {
      stability: 0.7,
      similarityBoost: 0.88,
      style: 0.03,
      speed: 0.9,
      useSpeakerBoost: true,
    },
    description: 'A calm, grounded female chatbot from Aotearoa with restrained expression and a lower-feeling delivery.',
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

export function getPersonaVoiceSettings(id: string) {
  return PERSONAS.find((persona) => persona.id === id)?.voiceSettings || AI_CONFIG.tts.voiceSettings;
}
