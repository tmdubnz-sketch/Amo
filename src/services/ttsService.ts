import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceId?: string;
}

const ttsLanguageFallbacks = ['en-NZ', 'en-GB', 'en-US'];
let currentAudio: HTMLAudioElement | null = null;

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
  const response = await fetch(getTtsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: options.text,
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

async function resolveNativeLanguage(preferredLanguage?: string) {
  try {
    const requested = preferredLanguage || ttsLanguageFallbacks[0];
    const requestedSupport = await TextToSpeech.isLanguageSupported({ lang: requested });
    if (requestedSupport.supported) {
      return requested;
    }

    for (const language of ttsLanguageFallbacks) {
      const result = await TextToSpeech.isLanguageSupported({ lang: language });
      if (result.supported) {
        return language;
      }
    }
  } catch (error) {
    console.error('Error checking native TTS languages:', error);
  }

  return preferredLanguage || 'en-US';
}

async function speakWithNativeTts(options: SpeakOptions) {
  const lang = await resolveNativeLanguage(options.lang);

  await TextToSpeech.stop().catch(() => undefined);
  await TextToSpeech.speak({
    text: options.text,
    lang,
    rate: options.rate ?? 1,
    pitch: options.pitch ?? 1,
    volume: 1,
    queueStrategy: 0,
  });

  // Native TTS doesn't have a completion callback, so we estimate based on text length.
  // Keep this slightly aggressive so live mode re-arms soon after speech ends.
  const wordCount = options.text.split(/\s+/).filter(Boolean).length;
  const baseDurationMs = (wordCount / 3.3) * 1000;
  const rateMultiplier = 1 / (options.rate ?? 1);
  const estimatedDurationMs = Math.max(350, baseDurationMs * rateMultiplier * 0.9);

  await new Promise<void>((resolve) => {
    setTimeout(resolve, estimatedDurationMs);
  });
}

function speakWithWebTts(options: SpeakOptions): Promise<void> {
  if (!('speechSynthesis' in window)) {
    throw new Error('Speech synthesis is not available on this device.');
  }

  window.speechSynthesis.cancel();

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(options.text);
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
    await TextToSpeech.stop().catch(() => undefined);
    return;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
