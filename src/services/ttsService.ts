import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}

const ttsLanguageFallbacks = ['en-NZ', 'en-AU', 'en-GB', 'en-US'];

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
  if (Capacitor.isNativePlatform()) {
    await speakWithNativeTts(options);
    return;
  }

  await speakWithWebTts(options);
}

export async function stopSpeaking() {
  if (Capacitor.isNativePlatform()) {
    await TextToSpeech.stop().catch(() => undefined);
    return;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
