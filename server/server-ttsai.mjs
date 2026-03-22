import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.PORT || 3000;

function loadEnv() {
  const envPath = resolve('.env');
  if (!existsSync(envPath)) return;
  
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length) {
      process.env[key.trim()] = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}

loadEnv();

const TTSAI_API = process.env.TTSAI_API_KEY || '';
const TTSAI_URL = 'https://api.tts.ai/v1/tts';
const TTS_MODEL = process.env.TTS_MODEL || 'kokoro';
const TTS_VOICE = process.env.TTS_VOICE || 'af_bella';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

async function ttsAIRequest(text, voice, model) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (TTSAI_API) {
    headers['Authorization'] = `Bearer ${TTSAI_API}`;
  }

  const body = {
    text,
    model: model || TTS_MODEL,
    voice: voice || TTS_VOICE
  };

  const response = await fetch(TTSAI_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`TTS.ai error: ${response.status}`);
  }

  return {
    contentType: response.headers.get('content-type') || 'audio/wav',
    buffer: Buffer.from(await response.arrayBuffer())
  };
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok', provider: 'tts.ai' });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/tts') {
    try {
      const body = await readBody(req);
      const { text, voice, lang } = JSON.parse(body);
      
      if (!text) {
        sendJson(res, 400, { error: 'Missing text' });
        return;
      }

      const audio = await ttsAIRequest(text, voice);
      
      res.writeHead(200, {
        'Content-Type': audio.contentType,
        'Content-Length': audio.buffer.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(audio.buffer);
    } catch (err) {
      console.error('TTS error:', err);
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Amo TTS server running on port ${PORT}`);
  console.log(`Using TTS.ai (free, no signup needed)`);
});
