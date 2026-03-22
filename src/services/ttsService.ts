import { Capacitor } from '@capacitor/core';

interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}

async function speakWithNativeTts(options: SpeakOptions) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech');

  await TextToSpeech.stop().catch(() => undefined);
  await TextToSpeech.speak({
    text: options.text,
    lang: options.lang || 'en-NZ',
    rate: options.rate ?? 1,
    pitch: options.pitch ?? 1,
    volume: 1,
  });
}

function speakWithWebTts(options: SpeakOptions) {
  if (!('speechSynthesis' in window)) {
    throw new Error('Speech synthesis is not available on this device.');
  }

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(options.text);
  utterance.lang = options.lang || 'en-NZ';
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;

  const availableVoices = window.speechSynthesis.getVoices();
  const matchingVoice = availableVoices.find((voice) => voice.lang.toLowerCase().startsWith('en-nz'));
  if (matchingVoice) {
    utterance.voice = matchingVoice;
  }

  window.speechSynthesis.speak(utterance);
}

export async function speakText(options: SpeakOptions) {
  if (Capacitor.isNativePlatform()) {
    await speakWithNativeTts(options);
    return;
  }

  speakWithWebTts(options);
}

export async function stopSpeaking() {
  if (Capacitor.isNativePlatform()) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    await TextToSpeech.stop().catch(() => undefined);
    return;
  }

  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
