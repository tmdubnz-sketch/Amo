import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const source = readFileSync(filePath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(resolve(process.cwd(), '.env'));
loadEnvFile(resolve(process.cwd(), '.env.local'));

function getConfig() {
  const upstreamUrl = (process.env.COQUI_API_URL || process.env.XTTS_API_URL || 'http://127.0.0.1:5002/v1/audio/speech').trim();
  return {
    port: Number(process.env.PORT || 8787),
    upstreamUrl,
    apiKey: (process.env.COQUI_API_KEY || process.env.XTTS_API_KEY || '').trim(),
    model: (process.env.COQUI_MODEL || 'xtts_v2').trim(),
    voice: (process.env.COQUI_VOICE || process.env.XTTS_SPEAKER_AUDIO_PATH || '').trim(),
    defaultLanguage: (process.env.COQUI_LANGUAGE || process.env.XTTS_LANGUAGE || 'en').trim(),
    responseFormat: (process.env.COQUI_RESPONSE_FORMAT || 'mp3').trim(),
    timeoutMs: Number(process.env.COQUI_TIMEOUT_MS || process.env.XTTS_TIMEOUT_MS || 120000),
    mode: (process.env.TTS_BACKEND_MODE || (upstreamUrl.includes('/v1/audio/speech') ? 'coqui-openai' : 'xtts')).trim(),
  };
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.on('error', rejectBody);
  });
}

function clampSpeed(rate) {
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate)) {
    return 1;
  }

  return Math.max(0.7, Math.min(1.2, numericRate));
}

function mapLanguage(lang, defaultLanguage) {
  if (!lang) {
    return defaultLanguage;
  }

  const normalized = lang.toLowerCase();
  if (normalized.startsWith('en') || normalized.startsWith('mi')) {
    return 'en';
  }

  return lang;
}

function getSpeakerAudioBase64(voicePath) {
  if (!voicePath) {
    return null;
  }

  const absolutePath = resolve(voicePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Speaker audio file not found: ${absolutePath}`);
  }

  return readFileSync(absolutePath).toString('base64');
}

async function requestCoquiOpenAi(text, rate, config, signal) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const body = {
    model: config.model,
    input: text,
    speed: clampSpeed(rate),
    response_format: config.responseFormat,
  };

  if (config.voice) {
    body.voice = config.voice;
  }

  const response = await fetch(config.upstreamUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Coqui TTS request failed.');
    throw new Error(errorText || 'Coqui TTS request failed.');
  }

  const contentType = response.headers.get('content-type') || `audio/${config.responseFormat}`;
  return {
    contentType,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

async function requestXttsJson(text, lang, config, signal) {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const body = {
    text,
    language: mapLanguage(lang, config.defaultLanguage),
  };

  const speakerAudio = getSpeakerAudioBase64(config.voice);
  if (speakerAudio) {
    body.speaker_wav = speakerAudio;
  }

  const response = await fetch(config.upstreamUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'XTTS upstream request failed.');
    throw new Error(errorText || 'XTTS upstream request failed.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('audio/')) {
    return {
      contentType,
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }

  const payload = await response.json();
  const base64Audio = payload.audio || payload.wav || payload.data;
  if (!base64Audio) {
    throw new Error('XTTS upstream response did not contain audio data.');
  }

  return {
    contentType: payload.contentType || 'audio/wav',
    buffer: Buffer.from(base64Audio, 'base64'),
  };
}

async function proxyTts(text, lang, rate) {
  const config = getConfig();
  if (!config.upstreamUrl) {
    throw new Error('COQUI_API_URL is not configured.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    if (config.mode === 'xtts') {
      return await requestXttsJson(text, lang, config, controller.signal);
    }

    return await requestCoquiOpenAi(text, rate, config, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    json(response, 404, { error: 'Not found' });
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/api/health') {
    const config = getConfig();
    json(response, 200, {
      ok: true,
      backendMode: config.mode,
      upstreamUrl: config.upstreamUrl,
      voiceConfigured: Boolean(config.voice),
    });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/tts') {
    try {
      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const lang = typeof payload.lang === 'string' ? payload.lang : 'en-NZ';
      const rate = typeof payload.rate === 'number' ? payload.rate : 1;

      if (!text) {
        json(response, 400, { error: 'Missing text.' });
        return;
      }

      const audio = await proxyTts(text, lang, rate);
      response.writeHead(200, {
        'Content-Type': audio.contentType,
        'Content-Length': audio.buffer.length,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      response.end(audio.buffer);
    } catch (error) {
      json(response, 503, {
        error: error instanceof Error ? error.message : 'TTS request failed.',
      });
    }
    return;
  }

  json(response, 404, { error: 'Not found' });
});

const { port } = getConfig();
server.listen(port, () => {
  console.log(`Amo TTS proxy listening on http://localhost:${port}`);
});
