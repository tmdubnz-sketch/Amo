import { Capacitor } from '@capacitor/core';
import NativeKokoro from '../plugins/NativeKokoro';

interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceId?: string;
}

const ttsLanguageFallbacks = ['en-NZ', 'en-GB', 'en-US'];
let currentAudio: HTMLAudioElement | null = null;

function getKokoroSpeakerId(voiceId?: string) {
  switch ((voiceId || '').trim().toLowerCase()) {
    case 'af_nicole':
      return 2;
    case 'af_sarah':
      return 3;
    case 'bf_emma':
      return 7;
    case 'bf_isabella':
      return 8;
    case 'bm_george':
      return 9;
    case 'bm_lewis':
    default:
      return 10;
  }
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

function getApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, '');
  }

  if (!Capacitor.isNativePlatform()) {
    return '';
  }

  return '';
}

function getTtsUrl() {
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}/api/tts` : '/api/tts';
}

function canUseRemoteTts() {
  return !Capacitor.isNativePlatform();
}

async function speakWithRemoteTts(options: SpeakOptions) {
  const text = normalizeSpeechText(options.text);
  const response = await fetch(getTtsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      lang: options.lang || 'en-NZ',
      rate: options.rate ?? 1,
      voice: options.voiceId,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Remote TTS request failed.' }));
    throw new Error(payload.error || 'Remote TTS request failed.');
  }

  const blob = await response.blob();
  const audioUrl = URL.createObjectURL(blob);
  const audio = new Audio(audioUrl);
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) {
        currentAudio = null;
      }
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) {
        currentAudio = null;
      }
      reject(new Error('Remote audio playback failed.'));
    };
    void audio.play().catch((error) => {
      URL.revokeObjectURL(audioUrl);
      if (currentAudio === audio) {
        currentAudio = null;
      }
      reject(error);
    });
  });
}

async function speakWithNativeTts(options: SpeakOptions) {
  const text = normalizeSpeechText(options.text);
  const speakerId = getKokoroSpeakerId(options.voiceId);
  const nativeTts = await NativeKokoro.initialize({
    speakerId,
    speed: options.rate ?? 1,
  });

  if (!nativeTts.available) {
    throw new Error(nativeTts.reason || 'Kokoro voice assets are not available on this device.');
  }

  await NativeKokoro.stop().catch(() => undefined);
  await NativeKokoro.speak({
    text,
    speakerId,
    speed: options.rate ?? 1,
  });
}

function speakWithWebTts(options: SpeakOptions): Promise<void> {
  if (!('speechSynthesis' in window)) {
    throw new Error('Speech synthesis is not available on this device.');
  }

  window.speechSynthesis.cancel();

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(normalizeSpeechText(options.text));
    utterance.lang = options.lang || 'en-NZ';
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;

    const availableVoices = window.speechSynthesis.getVoices();
    const matchingVoice = availableVoices.find((voice) => voice.lang.toLowerCase().startsWith('en-nz'));
    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Web TTS error'));

    window.speechSynthesis.speak(utterance);
  });
}

export async function speakText(options: SpeakOptions) {
  if (canUseRemoteTts()) {
    try {
      await speakWithRemoteTts(options);
      return;
    } catch (error) {
      console.error('Remote TTS failed, falling back to local TTS:', error);
    }
  }

  if (Capacitor.isNativePlatform()) {
    await speakWithNativeTts(options);
    return;
  }

  await speakWithWebTts(options);
}

export async function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (Capacitor.isNativePlatform()) {
    await NativeKokoro.stop().catch(() => undefined);
    return;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
