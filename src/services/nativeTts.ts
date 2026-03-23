import { Capacitor } from '@capacitor/core';
import NativeKokoro from '../plugins/NativeKokoro';
import NativeAndroidTTS from '../plugins/NativeAndroidTTS';
import type { SpeakOptions } from './ttsService';

const KOKORO_SPEAKER_MAP: Record<string, number> = {
  'af_nicole': 2,
  'af_sarah': 3,
  'bf_emma': 7,
  'bf_isabella': 8,
  'bm_george': 9,
  'bm_lewis': 10,
  'am_adam': 5,
  'am_michael': 6,
  'default': 5,
};

let androidTtsAvailable = false;
let androidTtsReady = NativeAndroidTTS.initialize().then(result => {
  androidTtsAvailable = result.available;
  return result;
}).catch(() => ({ available: false }));

let nativeKokoroReady: Promise<void> | null = null;
let nativeSpeakRequestId = 0;
let currentSpeakerId: number | null = null;

function getKokoroSpeakerId(voiceId?: string): number {
  if (!voiceId) return KOKORO_SPEAKER_MAP['default'];
  return KOKORO_SPEAKER_MAP[voiceId] || KOKORO_SPEAKER_MAP['default'];
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

function splitSpeechText(text: string) {
  if (text.length <= 200) return [text];
  
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      if (part.length <= 200) return [part];
      return part
        .split(/(?<=[,;:])\s+/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
    });
}

async function ensureNativeKokoroReady(speakerId: number, speed: number) {
  // Reinitialize if speaker changed
  if (currentSpeakerId !== speakerId) {
    console.log('TTS: Kokoro speaker changed from', currentSpeakerId, 'to', speakerId);
    nativeKokoroReady = null;
    currentSpeakerId = speakerId;
  }
  
  if (!nativeKokoroReady) {
    nativeKokoroReady = NativeKokoro.initialize({ speakerId, speed })
      .then((result) => {
        if (!result.available) throw new Error(result.reason || 'Kokoro not available');
      })
      .catch((error) => {
        nativeKokoroReady = null;
        currentSpeakerId = null;
        throw error;
      });
  }
  await nativeKokoroReady;
}

export async function speakWithNativeTts(options: SpeakOptions) {
  await androidTtsReady;
  
  // Get speaker ID for gender detection
  const speakerId = getKokoroSpeakerId(options.voiceId);
  const isMaleVoice = speakerId === 5 || speakerId === 6 || speakerId === 9 || speakerId === 10;
  
  if (androidTtsAvailable) {
    try {
      console.log('TTS: Using Android native TTS, male:', isMaleVoice, 'voiceId:', options.voiceId, 'speakerId:', speakerId);
      await NativeAndroidTTS.speak({
        text: options.text,
        pitch: isMaleVoice ? 0.7 : 1.3,  // Much more dramatic pitch difference
        speed: options.rate ?? 1.0,
        speakerId: speakerId,
      });
      return;
    } catch (e) {
      console.warn('Android TTS failed, falling back to Kokoro:', e);
    }
  }

  console.log('TTS: Using Kokoro (slower, higher quality)');
  const text = normalizeSpeechText(options.text);
  const requestId = ++nativeSpeakRequestId;
  const chunks = splitSpeechText(text);
  await ensureNativeKokoroReady(speakerId, options.rate ?? 1);
  await NativeKokoro.stop().catch(() => undefined);

  for (const chunk of chunks) {
    if (requestId !== nativeSpeakRequestId) break;
    await NativeKokoro.speak({ text: chunk, speakerId, speed: options.rate ?? 1 });
  }
}
