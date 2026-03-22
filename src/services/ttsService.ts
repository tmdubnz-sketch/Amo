import { Capacitor } from '@capacitor/core';

interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
}

const speechSubstitutions: Array<[RegExp, string]> = [
  [/\bKia ora\b/gi, 'Kee-ah or-ah'],
  [/\bM(?:\u0101|a)ori\b/gi, 'Maa-oh-ree'],
  [/\bAotearoa\b/gi, 'Ah-oh-teh-ah-roh-ah'],
  [/\bTe Reo M(?:\u0101|a)ori\b/gi, 'Teh reh-oh Maa-oh-ree'],
  [/\bTe Reo\b/gi, 'Teh reh-oh'],
  [/\bwh(?:\u0101|a)nau\b/gi, 'faa-now'],
  [/\bwhenua\b/gi, 'feh-noo-ah'],
  [/\bk(?:\u014d|o)rero\b/gi, 'koh-reh-roh'],
  [/\baroha\b/gi, 'ah-roh-hah'],
  [/\bAmo\b/g, 'Ah-moh'],
  [/\bKeri\b/g, 'Keh-ree'],
  [/\biwi\b/gi, 'ee-wee'],
  [/\bNg(?:\u0101|a)puhi\b/gi, 'Ngaa-poo-hee'],
  [/\bTainui\b/gi, 'Tie-noo-ee'],
  [/\bNg(?:\u0101|a)ti Porou\b/gi, 'Ngaa-tee Poh-roh-oo'],
  [/\bNg(?:\u0101|a)i Tahu\b/gi, 'Ngaa-ee Tah-hoo'],
  [/\bTe Arawa\b/gi, 'Teh Ah-rah-wah'],
  [/\bp(?:\u0101|a)tai\b/gi, 'paa-tie'],
  [/\btautoko\b/gi, 'tow-toh-kaw'],
  [/\bmotu\b/gi, 'moh-too'],
  [/\bmahi\b/gi, 'mah-hee'],
  [/\bka pai\b/gi, 'kah pie'],
];

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activePlayback:
  | {
      resolve: () => void;
      reject: (error: Error) => void;
    }
  | null = null;

function buildSpeechText(text: string) {
  let speechText = text;

  for (const [pattern, replacement] of speechSubstitutions) {
    speechText = speechText.replace(pattern, replacement);
  }

  return speechText
    .replace(/\u0101/g, 'aa')
    .replace(/\u0113/g, 'eh')
    .replace(/\u012b/g, 'ee')
    .replace(/\u014d/g, 'oh')
    .replace(/\u016b/g, 'oo');
}

function getApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, '');
  }

  return '';
}

function getTtsUrl() {
  return `${getApiBaseUrl()}/api/tts`;
}

function cleanupAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.src = '';
    activeAudio.load();
    activeAudio = null;
  }

  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

async function speakWithRemoteAudio(options: SpeakOptions) {
  const speechText = buildSpeechText(options.text);

  if (activePlayback) {
    activePlayback.reject(new Error('TTS playback interrupted by a new request.'));
    activePlayback = null;
  }

  cleanupAudio();

  const response = await fetch(getTtsUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: speechText,
      lang: options.lang || 'en-NZ',
      rate: options.rate ?? 1,
      pitch: options.pitch ?? 1,
      platform: Capacitor.getPlatform(),
    }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => 'Remote TTS request failed.');
    throw new Error(message || 'Remote TTS request failed.');
  }

  const audioBlob = await response.blob();
  if (!audioBlob.size) {
    throw new Error('Remote TTS returned empty audio.');
  }

  const objectUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(objectUrl);
  audio.preload = 'auto';
  audio.playbackRate = options.rate ?? 1;
  audio.preservesPitch = true;
  audio.crossOrigin = 'anonymous';

  activeAudio = audio;
  activeObjectUrl = objectUrl;

  await new Promise<void>((resolve, reject) => {
    activePlayback = { resolve, reject };

    audio.onended = () => {
      activePlayback = null;
      cleanupAudio();
      resolve();
    };

    audio.onerror = () => {
      activePlayback = null;
      cleanupAudio();
      reject(new Error('Remote audio playback failed.'));
    };

    void audio.play().catch((error) => {
      activePlayback = null;
      cleanupAudio();
      reject(error instanceof Error ? error : new Error('Remote audio playback failed.'));
    });
  });
}

export async function speakText(options: SpeakOptions) {
  await speakWithRemoteAudio(options);
}

export async function stopSpeaking() {
  if (activePlayback) {
    activePlayback.reject(new Error('TTS playback cancelled.'));
    activePlayback = null;
  }

  cleanupAudio();
}
