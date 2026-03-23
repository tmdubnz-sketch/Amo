import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { AI_CONFIG, getPersonaById, getTtsVoiceId } from '../config/ai';

export interface SpeakOptions {
  text: string;
  voiceId?: string;
  personaId?: string;
}

const ELEVENLABS_API_URL = AI_CONFIG.tts.apiUrl;
const ELEVENLABS_MODEL = AI_CONFIG.tts.model;
const ELEVENLABS_OUTPUT_FORMAT = AI_CONFIG.tts.outputFormat;
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';

let currentAudio: HTMLAudioElement | null = null;
let sharedAudioElement: HTMLAudioElement | null = null;
let currentAudioObjectUrl: string | null = null;

const MAORI_PHRASES: Array<[string, string]> = [
  ['kia ora koutou', 'kee aw-rah koh-toh'],
  ['kia ora', 'kee aw-rah'],
  ['tēnā koutou', 'teh-nah koh-toh'],
  ['tena koutou', 'teh-nah koh-toh'],
  ['tēnā koe', 'teh-nah koh-eh'],
  ['tena koe', 'teh-nah koh-eh'],
  ['haere mai', 'high-reh my'],
  ['te reo māori', 'teh reh-oh maow-ree'],
  ['te reo maori', 'teh reh-oh maow-ree'],
  ['aotearoa', 'ow-teh-ah-roh-ah'],
  ['whakawhanaungatanga', 'fah-kah-fah-now-ngah-tah-ngah'],
  ['whanaungatanga', 'fah-now-ngah-tah-ngah'],
  ['manaakitanga', 'mah-nah-kee-tah-ngah'],
  ['tangata whenua', 'tah-ngah-tah feh-noo-ah'],
  ['wharewānanga', 'fah-reh-wah-nah-ngah'],
  ['whakapapa', 'fah-kah-pah-pah'],
  ['whakamārama', 'fah-kah-mah-rah-mah'],
  ['whakatō', 'fah-kah-toh'],
  ['wharekai', 'fah-reh-kye'],
  ['wharepaku', 'fah-reh-pah-koo'],
  ['whānau', 'fah-now'],
  ['whanau', 'fah-now'],
  ['whenua', 'feh-noo-ah'],
  ['whare', 'fah-reh'],
  ['whawhai', 'fah-fye'],
  ['kōrero', 'koh-reh-roh'],
  ['korero', 'koh-reh-roh'],
  ['māori', 'maow-ree'],
  ['maori', 'maow-ree'],
  ['tūpuna', 'too-poo-nah'],
  ['tipuna', 'too-poo-nah'],
  ['marae', 'mah-rye-eh'],
  ['karakia', 'kah-rah-kee-ah'],
  ['waiata', 'why-ah-tah'],
  ['pōwhiri', 'poh-fee-ree'],
  ['powhiri', 'poh-fee-ree'],
  ['mihimihi', 'mee-hee-mee-hee'],
  ['pepeha', 'peh-peh-hah'],
  ['taniwha', 'tah-nee-fah'],
  ['taiaha', 'tie-ah-hah'],
  ['maunga', 'mow-ngah'],
  ['moana', 'moh-ah-nah'],
  ['aroha', 'ah-roh-hah'],
  ['atua', 'ah-too-ah'],
  ['hapū', 'hah-poo'],
  ['hui', 'hoo-ee'],
  ['rohe', 'roh-heh'],
  ['waka', 'wah-kah'],
  ['mana', 'mah-nah'],
  ['tapu', 'tah-poo'],
  ['noa', 'noh-ah'],
  ['iwi', 'ee-wee'],
  ['haka', 'hah-kah'],
  ['poi', 'poy'],
  ['patu', 'pah-too'],
  ['mere', 'meh-reh'],
  ['awa', 'ah-vah'],
  ['wāhi', 'wah-hee'],
  ['rawe', 'rah-veh'],
  ['kāpai', 'kah-pie'],
  ['ka pai', 'kah pie'],
  ['tu meke', 'too meh-keh'],
  ['tumeke', 'too-meh-keh'],
  ['tino', 'tee-noh'],
  ['amo', 'ah-moh'],
];

function getAudioElement() {
  if (sharedAudioElement) {
    return sharedAudioElement;
  }

  const audio = document.createElement('audio');
  audio.preload = 'auto';
  audio.setAttribute('playsinline', 'true');
  audio.setAttribute('data-amo-tts-audio', 'true');
  audio.style.display = 'none';
  document.body.appendChild(audio);
  sharedAudioElement = audio;
  return audio;
}

function getTtsVoice(voiceId?: string): string {
  const mappedVoice = getTtsVoiceId(voiceId);
  console.log('TTS: Voice mapping - requested:', voiceId, 'mapped to:', mappedVoice);
  return mappedVoice;
}

function getVoiceSettings(personaId?: string) {
  return getPersonaById(personaId || 'amo').voiceSettings || AI_CONFIG.tts.voiceSettings;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePunctuation(text: string) {
  return text
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, ', ')
    .replace(/[()]/g, ', ')
    .replace(/\//g, ' ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyMaoriPhraseGuide(text: string) {
  let result = ` ${text.toLowerCase()} `;

  for (const [source, spoken] of MAORI_PHRASES.sort((a, b) => b[0].length - a[0].length)) {
    const regex = new RegExp(`([^a-zāēīōū])${escapeRegExp(source)}([^a-zāēīōū])`, 'giu');
    result = result.replace(regex, `$1${spoken}$2`);
  }

  // Fallback for unseen "wh" words so they flow instead of stumbling.
  result = result.replace(/\b([a-zāēīōū]*)wh([a-zāēīōū]+)\b/giu, (match) => {
    if (match.includes('-') || match.includes('ah') || match.includes('eh') || match.includes('oh')) {
      return match;
    }

    return match.replace(/wh/giu, 'f');
  });

  return result.replace(/\s+/g, ' ').trim();
}

function normalizeSpeechText(text: string) {
  const withProsody = normalizePunctuation(text);
  const smoothed = applyMaoriPhraseGuide(withProsody);

  // Light comma reduction keeps phrasing natural instead of choppy.
  return smoothed
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*,+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getErrorMessage(payload: any, status: number) {
  const detail =
    typeof payload?.detail?.message === 'string' ? payload.detail.message
    : typeof payload?.detail === 'string' ? payload.detail
    : typeof payload?.message === 'string' ? payload.message
    : typeof payload?.error?.message === 'string' ? payload.error.message
    : typeof payload?.error === 'string' ? payload.error
    : '';

  if (detail) {
    return detail;
  }

  if (status === 401) {
    return 'ElevenLabs API key is invalid.';
  }

  if (status === 429) {
    return 'ElevenLabs rate limit reached.';
  }

  return `ElevenLabs request failed${status ? ` (${status})` : ''}.`;
}

function decodeBase64Audio(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getAudioBlobFromNativeResponse(data: unknown) {
  if (data instanceof ArrayBuffer) {
    return new Blob([data], { type: 'audio/mpeg' });
  }

  if (Array.isArray(data)) {
    return new Blob([new Uint8Array(data)], { type: 'audio/mpeg' });
  }

  if (typeof data === 'string') {
    return new Blob([decodeBase64Audio(data)], { type: 'audio/mpeg' });
  }

  throw new Error('ElevenLabs audio response format was not supported.');
}

async function playAudioBlob(blob: Blob) {
  const audio = getAudioElement();

  if (currentAudioObjectUrl) {
    URL.revokeObjectURL(currentAudioObjectUrl);
  }

  const objectUrl = URL.createObjectURL(blob);
  currentAudioObjectUrl = objectUrl;
  audio.src = objectUrl;
  audio.load();
  currentAudio = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      audio.removeAttribute('src');
      audio.load();
      if (currentAudio === audio) currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      const mediaError = audio.error;
      audio.removeAttribute('src');
      audio.load();
      if (currentAudio === audio) currentAudio = null;
      reject(new Error(`Audio playback failed (${mediaError?.code || 'unknown'}).`));
    };
    audio.play().catch(reject);
  });
}

async function requestElevenLabsAudio(options: SpeakOptions) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const voiceId = getTtsVoice(options.voiceId);
  const voiceSettings = getVoiceSettings(options.personaId);
  const normalizedText = normalizeSpeechText(options.text);
  const url = `${ELEVENLABS_API_URL}/${voiceId}`;
  const headers = {
    'xi-api-key': ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };
  const body = {
    text: normalizedText,
    model_id: ELEVENLABS_MODEL,
    output_format: ELEVENLABS_OUTPUT_FORMAT,
    voice_settings: {
      stability: voiceSettings.stability,
      similarity_boost: voiceSettings.similarityBoost,
      style: voiceSettings.style,
      speed: voiceSettings.speed,
      use_speaker_boost: voiceSettings.useSpeakerBoost,
    },
  };

  console.log('TTS: Using ElevenLabs with voice:', voiceId, 'text length:', body.text.length, 'voice settings:', voiceSettings);
  console.log('TTS: Normalized speech text:', normalizedText);

  if (Capacitor.isNativePlatform()) {
    console.log('TTS: Using Capacitor native HTTP for ElevenLabs request');
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      responseType: 'arraybuffer',
      readTimeout: 30000,
      connectTimeout: 15000,
    });

    if (response.status < 200 || response.status >= 300) {
      console.error('ElevenLabs error:', response.status, response.data);
      throw new Error(getErrorMessage(response.data, response.status));
    }

    return getAudioBlobFromNativeResponse(response.data);
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach ElevenLabs. Check your network connection and API key.');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    console.error('ElevenLabs error:', response.status, payload);
    throw new Error(getErrorMessage(payload, response.status));
  }

  return response.blob();
}

export async function speakText(options: SpeakOptions) {
  console.log('TTS: speakText called with voiceId:', options.voiceId, 'API key present:', !!ELEVENLABS_API_KEY);
  const blob = await requestElevenLabsAudio(options);
  await playAudioBlob(blob);
  console.log('TTS: ElevenLabs succeeded');
}

export async function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }

  if (currentAudioObjectUrl) {
    URL.revokeObjectURL(currentAudioObjectUrl);
    currentAudioObjectUrl = null;
  }
}
