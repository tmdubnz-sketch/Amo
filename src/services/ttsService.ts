/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';
const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1/text-to-speech';

const PERSONA_VOICE_IDS: Record<string, string> = {
  'amo': 'BHhU6fTKdSX6bN7T1tpz',
  'keri': 'BHhU6fTKdSX6bN7T1tpz',
};

let currentAudio: HTMLAudioElement | null = null;
let isSpeaking = false;
let pendingQueue: Array<{ text: string; personaId: string; resolve: () => void }> = [];

export interface SpeakOptions {
  text: string;
  personaId: string;
}

async function playAudio(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio = null;
    }
    
    const audio = new Audio(url);
    currentAudio = audio;
    
    audio.onended = () => {
      currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      currentAudio = null;
      reject(new Error('Audio playback failed'));
    };
    
    audio.play().catch(reject);
  });
}

async function processQueue() {
  if (isSpeaking) return;
  
  isSpeaking = true;
  
  while (pendingQueue.length > 0) {
    const item = pendingQueue.shift();
    if (!item) continue;
    
    const voiceId = PERSONA_VOICE_IDS[item.personaId] || PERSONA_VOICE_IDS['amo'];
    
    try {
      const response = await fetch(`${ELEVENLABS_API_URL}/${voiceId}`, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: item.text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true,
          },
        }),
      });

      if (!response.ok) {
        console.warn(`ElevenLabs API error: ${response.status}`);
        item.resolve();
        continue;
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      await playAudio(audioUrl);
      item.resolve();
    } catch (error) {
      console.error('TTS error:', error);
      item.resolve();
    }
  }
  
  isSpeaking = false;
}

export function speakText(options: SpeakOptions): Promise<void> {
  if (!ELEVENLABS_API_KEY) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    pendingQueue.push({ text: options.text, personaId: options.personaId, resolve });
    processQueue();
  });
}

export async function stopSpeaking() {
  pendingQueue = [];
  isSpeaking = false;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}
