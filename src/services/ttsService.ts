import { Capacitor } from '@capacitor/core';

export interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceId?: string;
}

const TTSAI_URL = 'https://api.tts.ai/v1/tts';
const TTS_MODEL = 'kokoro';
const TTS_VOICE_MAP: Record<string, string> = {
  'bm_george': 'af_scout',
  'bm_lewis': 'af_nicholas',
  'bf_emma': 'af_heart',
  'bf_isabella': 'af_bella',
  'af_nicole': 'af_nicole',
  'af_sarah': 'af_sarah',
  'default': 'af_bella',
};

const TTSAI_API_KEY = import.meta.env.VITE_TTS_AI_API_KEY || '';

let currentAudio: HTMLAudioElement | null = null;

function getTtsVoice(voiceId?: string): string {
  if (!voiceId) return TTS_VOICE_MAP['default'];
  return TTS_VOICE_MAP[voiceId] || TTS_VOICE_MAP['default'];
}

function normalizeSpeechText(text: string) {
  return text
    .replace(/\bAmo\b/g, 'Ahh-maw')
    .replace(/\bMāori\b/g, 'Maa-oh-ree')
    .replace(/\bMaori\b/g, 'Maa-oh-ree')
    .replace(/\bTe Reo Māori\b/g, 'Teh Reh-oh Maa-oh-ree')
    .replace(/\bTe Reo Maori\b/g, 'Teh Reh-oh Maa-oh-ree')
    .replace(/\bKia ora\b/gi, 'Kee-ah or-ah')
    .replace(/\bwhānau\b/gi, 'fah-now')
    .replace(/\bwhanau\b/gi, 'fah-now')
    .replace(/\bkōrero\b/gi, 'koh-reh-roh')
    .replace(/\bkorero\b/gi, 'koh-reh-roh');
}

async function speakWithTtsAI(options: SpeakOptions) {
  if (!TTSAI_API_KEY) {
    console.warn('TTS: TTS.ai API key not configured, skipping');
    throw new Error('TTS.ai API key not configured');
  }

  const text = normalizeSpeechText(options.text);
  const voice = getTtsVoice(options.voiceId);
  
  console.log('TTS: Using TTS.ai with voice:', voice, 'text length:', text.length);
  
  const response = await fetch(TTSAI_URL, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TTSAI_API_KEY}`,
    },
    body: JSON.stringify({ text, model: TTS_MODEL, voice, format: 'mp3' }),
  });

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const errorData = await response.json().catch(() => ({}));
    console.error('TTS.ai API error:', errorData);
    throw new Error('TTS.ai API error: ' + (errorData.error?.message || response.status));
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error('TTS.ai error:', response.status, errorText);
    throw new Error('TTS request failed: ' + response.status);
  }

  console.log('TTS: TTS.ai success, playing audio');
  const blob = await response.blob();
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) currentAudio = null;
      console.log('TTS: Audio finished');
      resolve();
    };
    audio.onerror = (e) => {
      console.error('TTS: Audio playback error:', e);
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) currentAudio = null;
      reject(new Error('Audio playback failed'));
    };
    audio.play().catch((err) => {
      console.error('TTS: Play error:', err);
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) currentAudio = null;
      reject(err);
    });
  });
}

export async function speakText(options: SpeakOptions) {
  try {
    await speakWithTtsAI(options);
    return;
  } catch (error) {
    console.error('TTS.ai failed:', error);
  }

  if (Capacitor.isNativePlatform()) {
    const { speakWithNativeTts } = await import('./nativeTts');
    try {
      await speakWithNativeTts(options);
      return;
    } catch (e) {
      console.error('Native TTS failed:', e);
    }
  }

  const { speakWithWebTts } = await import('./webTts');
  await speakWithWebTts(options);
}

export async function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}
