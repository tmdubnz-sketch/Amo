const TTSAI_BASE = 'https://api.tts.ai/v1';
const TTSAI_API_KEY = import.meta.env.VITE_TTS_AI_API_KEY || '';

export interface CloneResult {
  audioUrl: string;
  uuid: string;
}

export async function cloneVoice(
  referenceAudio: Blob,
  text: string,
  model: string = 'chatterbox'
): Promise<CloneResult> {
  if (!TTSAI_API_KEY) {
    throw new Error('TTS.ai API key not configured');
  }

  const formData = new FormData();
  formData.append('reference_audio', referenceAudio, 'reference.wav');
  formData.append('text', text);
  formData.append('model', model);
  formData.append('format', 'wav');

  const response = await fetch(`${TTSAI_BASE}/tts/clone/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TTSAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Voice cloning failed: ${error.error || response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  
  if (contentType.includes('application/json')) {
    const data = await response.json();
    if (data.uuid || data.job_id) {
      return await pollForCloneResult(data.uuid || data.job_id);
    }
    throw new Error('Unexpected response format');
  }

  const blob = await response.blob();
  const audioUrl = URL.createObjectURL(blob);
  return { audioUrl, uuid: 'direct' };
}

async function pollForCloneResult(uuid: string, maxAttempts: number = 30): Promise<CloneResult> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const response = await fetch(`${TTSAI_BASE}/tts/clone/result/${uuid}`, {
      headers: { 'Authorization': `Bearer ${TTSAI_API_KEY}` },
    });

    if (response.ok) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
        const blob = await response.blob();
        const audioUrl = URL.createObjectURL(blob);
        return { audioUrl, uuid };
      }
      
      const data = await response.json();
      if (data.status === 'completed' && data.audio_url) {
        return { audioUrl: data.audio_url, uuid };
      }
      if (data.status === 'failed') {
        throw new Error('Voice cloning failed on server');
      }
    }
  }
  throw new Error('Voice cloning timed out');
}

export async function listClonedVoices(): Promise<any[]> {
  if (!TTSAI_API_KEY) return [];
  
  try {
    const response = await fetch(`${TTSAI_BASE}/tts/clone/voices/`, {
      headers: { 'Authorization': `Bearer ${TTSAI_API_KEY}` },
    });
    if (response.ok) {
      const data = await response.json();
      return data.voices || [];
    }
  } catch (e) {
    console.error('Failed to list cloned voices:', e);
  }
  return [];
}
