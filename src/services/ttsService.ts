import { Capacitor } from '@capacitor/core';

export interface SpeakOptions {
  text: string;
  lang?: string;
  rate?: number;
  pitch?: number;
  voiceId?: string;
}

const TTSAI_URL = 'https://api.tts.ai/v1/tts';
const TTS_MODEL = 'kokoro';
const TTS_VOICE_MAP: Record<string, string> = {
  // Male voices
  'am_adam': 'am_adam',
  'am_michael': 'am_michael',
  'bm_lewis': 'bm_lewis',
  'bm_george': 'bm_george',
  // Female voices
  'bf_emma': 'bf_emma',
  'bf_isabella': 'bf_isabella',
  'af_nicole': 'af_nicole',
  'af_sarah': 'af_sarah',
  'af_bella': 'af_bella',
  'default': 'af_bella',
};

const TTSAI_API_KEY = import.meta.env.VITE_TTS_AI_API_KEY || '';

let currentAudio: HTMLAudioElement | null = null;

function getTtsVoice(voiceId?: string): string {
  if (!voiceId) return TTS_VOICE_MAP['default'];
  const mappedVoice = TTS_VOICE_MAP[voiceId] || TTS_VOICE_MAP['default'];
  console.log('TTS: Voice mapping - requested:', voiceId, 'mapped to:', mappedVoice);
  return mappedVoice;
}

function normalizeSpeechText(text: string) {
  // Māori phonetic guide - CORRECTED:
  // Vowels are ALWAYS: A=ah, E=eh, I=ee, O=oh, U=oo (as in "boot")
  // Macron (ā, ē, ī, ō, ū) = longer vowel sound
  //
  // Diphthongs (vowel combinations that make single sounds):
  // AU = "ow" as in "flow" or "co" (NOT "cow" or "now") - starts ah, rounds to oh
  // AI = "eye" as in "my" (ah-ee)  
  // EI = "ay" as in "hey" (eh-ee)
  // OU = "oh" as in "go" (oh-oo, rounded)
  // UI = "oo-ee" like "sweet" without the t
  // OE = "oh-eh" 
  // AE = "ah-eh" like "eye"
  //
  // WH = f (as in "far")
  // NG = as in "sing" (never separated)
  // K = always hard k, never soft c
  // R = lightly tapped, never rolled hard
  
  // Handle common Māori words with full phonetic spelling
  // AU sounds like "ow" in flow/co, NOT cow/now
  const maoriPhonetics: Record<string, string> = {
    // Greetings & common phrases
    'kia ora': 'kee-ah aw-rah',
    'kia ora koutou': 'kee-ah aw-rah koh-toh',
    'tena koe': 'teh-nah koh-eh',
    'tena koutou': 'teh-nah koh-toh',
    'naumai': 'now-mye',
    'haere mai': 'hy-reh mye',
    'manaakitanga': 'mah-nah-kee-tah-ngah',
    
    // Māori words - AU = ow as in flow/co
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
    'Amo': 'Ah-moh',
    'Aotearoa': 'ah-aw-teh-ah-roh-ah',
    'aotearoa': 'ah-aw-teh-ah-roh-ah',
    'tēnā': 'teh-nah',
    'tena': 'teh-nah',
  };

  let result = text.toLowerCase();
  
  // Replace known Māori words first (longest matches first)
  const sortedWords = Object.keys(maoriPhonetics).sort((a, b) => b.length - a.length);
  for (const word of sortedWords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, maoriPhonetics[word]);
  }
  
  // WH = F rule for ANY word containing "wh" (not already processed)
  // This catches unknown Māori words with WH
  result = result.replace(/\b(\w*)wh(\w*)\b/gi, (match, prefix, suffix) => {
    // Skip if already has phonetic markers
    if (match.includes('-') || match.includes('ah')) return match;
    // Replace WH with F
    return prefix + 'f' + suffix;
  });
  
  // Fix double-e vowel sounds - E should be "eh" not "ee" in Māori
  // But only for Māori-sounding words (after WH conversion)
  
  return result;
}

async function speakWithTtsAI(options: SpeakOptions) {
  if (!TTSAI_API_KEY) {
    console.warn('TTS: TTS.ai API key not configured, skipping');
    throw new Error('TTS.ai API key not configured');
  }

  const text = normalizeSpeechText(options.text);
  const voice = getTtsVoice(options.voiceId);
  
  console.log('TTS: Using TTS.ai with voice:', voice, 'text length:', text.length);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  
  try {
    const response = await fetch(TTSAI_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TTSAI_API_KEY}`,
      },
      body: JSON.stringify({ text, model: TTS_MODEL, voice, format: 'mp3' }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const errorData = await response.json().catch(() => ({}));
      console.error('TTS.ai API error:', errorData);
      throw new Error('TTS.ai API error: ' + (errorData.error?.message || response.status));
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('TTS.ai error:', response.status, errorText);
      throw new Error('TTS request failed: ' + response.status);
    }

    console.log('TTS: TTS.ai success, playing audio');
    const blob = await response.blob();
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    currentAudio = audio;

    await new Promise<void>((resolve, reject) => {
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        if (currentAudio === audio) currentAudio = null;
        console.log('TTS: Audio finished');
        resolve();
      };
      audio.onerror = (e) => {
        console.error('TTS: Audio playback error:', e);
        URL.revokeObjectURL(audioUrl);
        if (currentAudio === audio) currentAudio = null;
        reject(new Error('Audio playback failed'));
      };
      audio.play().catch((err) => {
        console.error('TTS: Play error:', err);
        URL.revokeObjectURL(audioUrl);
        if (currentAudio === audio) currentAudio = null;
        reject(err);
      });
    });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      console.error('TTS: TTS.ai request timed out after 15s');
      throw new Error('TTS.ai request timed out');
    }
    throw error;
  }
}

export async function speakText(options: SpeakOptions) {
  console.log('TTS: speakText called with voiceId:', options.voiceId, 'API key present:', !!TTSAI_API_KEY);
  
  try {
    await speakWithTtsAI(options);
    console.log('TTS: TTS.ai succeeded');
    return;
  } catch (error) {
    console.error('TTS.ai failed, falling back to native:', error);
  }

  if (Capacitor.isNativePlatform()) {
    console.log('TTS: Using native platform TTS');
    const { speakWithNativeTts } = await import('./nativeTts');
    try {
      await speakWithNativeTts(options);
      return;
    } catch (e) {
      console.error('Native TTS failed:', e);
    }
  }

  console.log('TTS: Falling back to web TTS');
  const { speakWithWebTts } = await import('./webTts');
  await speakWithWebTts(options);
}

export async function stopSpeaking() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}
