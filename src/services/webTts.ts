import type { SpeakOptions } from './ttsService';

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

export async function speakWithWebTts(options: SpeakOptions) {
  if (!('speechSynthesis' in window)) {
    throw new Error('Speech synthesis not available');
  }

  const text = normalizeSpeechText(options.text);
  window.speechSynthesis.cancel();

  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = options.lang || 'en-NZ';
    utterance.rate = (options.rate ?? 1) * 1.1;
    utterance.pitch = options.pitch ?? 1;

    const voices = window.speechSynthesis.getVoices();
    const enVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    
    console.log('WebTTS: voiceId:', options.voiceId, 'available voices:', enVoices.map(v => v.name));
    
    if (options.voiceId?.startsWith('af_') || options.voiceId?.startsWith('bf_')) {
      utterance.voice = enVoices.find((v) => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman'));
      console.log('WebTTS: Selected female voice:', utterance.voice?.name);
    } else if (options.voiceId?.startsWith('bm_') || options.voiceId?.startsWith('am_')) {
      utterance.voice = enVoices.find((v) => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('man'));
      console.log('WebTTS: Selected male voice:', utterance.voice?.name);
    }
    
    if (!utterance.voice) {
      utterance.voice = enVoices.find((v) => v.lang.toLowerCase().startsWith('en-nz')) 
        || enVoices.find((v) => v.lang.toLowerCase().startsWith('en-gb'))
        || enVoices[0];
      console.log('WebTTS: Fallback voice selected:', utterance.voice?.name);
    }

    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Web TTS error'));
    window.speechSynthesis.speak(utterance);
  });
}
