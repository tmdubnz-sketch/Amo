import { Capacitor } from '@capacitor/core';
import NativeKokoro from '../plugins/NativeKokoro';
import type { SpeakOptions } from './ttsService';

const KOKORO_SPEAKER_MAP: Record<string, number> = {
  'af_nicole': 2,
  'af_sarah': 3,
  'bf_emma': 7,
  'bf_isabella': 8,
  'bm_george': 9,
  'bm_lewis': 10,
  'default': 10,
};

let nativeKokoroReady: Promise<void> | null = null;
let nativeSpeakRequestId = 0;

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
  if (!nativeKokoroReady) {
    nativeKokoroReady = NativeKokoro.initialize({ speakerId, speed })
      .then((result) => {
        if (!result.available) throw new Error(result.reason || 'Kokoro not available');
      })
      .catch((error) => {
        nativeKokoroReady = null;
        throw error;
      });
  }
  await nativeKokoroReady;
}

export async function speakWithNativeTts(options: SpeakOptions) {
  const text = normalizeSpeechText(options.text);
  const speakerId = getKokoroSpeakerId(options.voiceId);
  const requestId = ++nativeSpeakRequestId;
  const chunks = splitSpeechText(text);
  await ensureNativeKokoroReady(speakerId, options.rate ?? 1);
  await NativeKokoro.stop().catch(() => undefined);

  for (const chunk of chunks) {
    if (requestId !== nativeSpeakRequestId) break;
    await NativeKokoro.speak({ text: chunk, speakerId, speed: options.rate ?? 1 });
  }
}
