import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { AI_CONFIG, getTtsVoiceId } from '../config/ai';

export interface SpeakOptions {
  text: string;
  personaId: string;
}

const ELEVENLABS_API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY || '';

let currentAudio: HTMLAudioElement | null = null;
let currentAudioUrl: string | null = null;

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

async function requestAudio(options: SpeakOptions) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not configured');
  }

  const voiceId = getTtsVoiceId(options.personaId);
  const url = `${AI_CONFIG.tts.apiUrl}/${voiceId}`;
  const body = {
    text: options.text.trim(),
    model_id: AI_CONFIG.tts.model,
    output_format: AI_CONFIG.tts.outputFormat,
  };
  const headers = {
    'xi-api-key': ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
    Accept: 'audio/mpeg',
  };

  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      responseType: 'arraybuffer',
      readTimeout: 30000,
      connectTimeout: 15000,
    });

    if (response.status < 200 || response.status >= 300) {
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
    throw new Error(getErrorMessage(payload, response.status));
  }

  return response.blob();
}

export async function speakText(options: SpeakOptions) {
  const blob = await requestAudio(options);

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
  }

  const audio = new Audio();
  audio.setAttribute('playsinline', 'true');
  const url = URL.createObjectURL(blob);
  currentAudio = audio;
  currentAudioUrl = url;
  audio.src = url;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error(`Audio playback failed (${audio.error?.code || 'unknown'}).`));
    audio.play().catch(reject);
  });
}

export async function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
}
