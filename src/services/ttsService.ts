import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { AI_CONFIG, getTtsVoiceId } from '../config/ai';

export interface SpeakOptions {
  text: string;
  voiceId?: string;
}

const ELEVENLABS_API_URL = AI_CONFIG.tts.apiUrl;
const ELEVENLABS_MODEL = AI_CONFIG.tts.model;
const ELEVENLABS_OUTPUT_FORMAT = AI_CONFIG.tts.outputFormat;
const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';

let currentAudio: HTMLAudioElement | null = null;
let sharedAudioElement: HTMLAudioElement | null = null;
let currentAudioObjectUrl: string | null = null;

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

function normalizeSpeechText(text: string) {
  const maoriPhonetics: Record<string, string> = {
    'kia ora': 'kee-ah aw-rah',
    'kia ora koutou': 'kee-ah aw-rah koh-toh',
    'tēnā koe': 'teh-nah koh-eh',
    'tena koe': 'teh-nah koh-eh',
    'tēnā koutou': 'teh-nah koh-toh',
    'tena koutou': 'teh-nah koh-toh',
    'naumai': 'now-mye',
    'haere mai': 'hy-reh mye',
    'manaakitanga': 'mah-nah-kee-tah-ngah',
    'māori': 'mah-aw-ree',
    'maori': 'mah-aw-ree',
    'te reo': 'teh reh-oh',
    'te reo māori': 'teh reh-oh mah-aw-ree',
    'whānau': 'fah-now',
    'whanau': 'fah-now',
    'whakapapa': 'fah-kah-pah-pah',
    'whakawhanaungatanga': 'fah-kah-fah-now-ngah-tah-ngah',
    'whare': 'fah-reh',
    'wharekai': 'fah-reh-kye',
    'wharepaku': 'fah-reh-pah-koo',
    'wharewānanga': 'fah-reh-vah-nah-ngah',
    'whakatō': 'fah-kah-toh',
    'whakamārama': 'fah-kah-mah-rah-mah',
    'whanaungatanga': 'fah-now-ngah-tah-ngah',
    'whawhai': 'fah-fye',
    'kōrero': 'koh-reh-roh',
    'korero': 'koh-reh-roh',
    'tangata': 'tah-ngah-tah',
    'whenua': 'feh-noo-ah',
    'awa': 'ah-vah',
    'maunga': 'mow-ngah',
    'moana': 'moh-ah-nah',
    'tūpuna': 'too-poo-nah',
    'tipuna': 'too-poo-nah',
    'tangata whenua': 'tah-ngah-tah feh-noo-ah',
    'tino': 'tee-noh',
    'pai': 'pie',
    'kāpai': 'kah-pie',
    'ka pai': 'kah pie',
    'ka rawe': 'kah rah-veh',
    'rawe': 'rah-veh',
    'tu meke': 'too meh-keh',
    'tumeke': 'too-meh-keh',
    'aroha': 'ah-roh-hah',
    'atua': 'ah-too-ah',
    'iwi': 'ee-vee',
    'hapū': 'hah-poo',
    'hui': 'hoo-ee',
    'marae': 'mah-rye-eh',
    'haka': 'hah-kah',
    'poi': 'poy',
    'taiaha': 'tie-ah-hah',
    'patu': 'pah-too',
    'mere': 'meh-reh',
    'wāhi': 'fah-hee',
    'rohe': 'roh-heh',
    'waka': 'vah-kah',
    'taniwha': 'tah-nee-fah',
    'mana': 'mah-nah',
    'tapu': 'tah-poo',
    'noa': 'noh-ah',
    'karakia': 'kah-rah-kee-ah',
    'waiata': 'wye-ah-tah',
    'hongi': 'hoh-nghee',
    'pōwhiri': 'poh-fee-ree',
    'powhiri': 'poh-fee-ree',
    'mihimihi': 'mee-hee-mee-hee',
    'pepeha': 'peh-peh-hah',
    'amo': 'ah-moh',
    'aotearoa': 'ah-aw-teh-ah-roh-ah',
  };

  let result = text.toLowerCase();
  const sortedWords = Object.keys(maoriPhonetics).sort((a, b) => b.length - a.length);
  for (const word of sortedWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, maoriPhonetics[word]);
  }

  return result.replace(/\b(\w*)wh(\w*)\b/gi, (match, prefix, suffix) => {
    if (match.includes('-') || match.includes('ah')) return match;
    return prefix + 'f' + suffix;
  });
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
  const url = `${ELEVENLABS_API_URL}/${voiceId}`;
  const headers = {
    'xi-api-key': ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };
  const body = {
    text: normalizeSpeechText(options.text),
    model_id: ELEVENLABS_MODEL,
    output_format: ELEVENLABS_OUTPUT_FORMAT,
  };

  console.log('TTS: Using ElevenLabs with voice:', voiceId, 'text length:', body.text.length);

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
