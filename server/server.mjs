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

const COQUI_URL = process.env.COQUI_URL || 'http://localhost:5002/v1/audio/speech';
const VOICE = process.env.TTS_VOICE || '/voices/MaakaPohatu.mp3';

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
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/tts') {
    try {
      const body = await readBody(req);
      const { text, voice } = JSON.parse(body);
      
      if (!text) {
        sendJson(res, 400, { error: 'Missing text' });
        return;
      }

      const coquiRes = await fetch(COQUI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model: 'tts_models/multilingual/multi-dataset/xtts_v2',
          speaker_wav: voice || VOICE,
          language: 'en'
        })
      });

      if (!coquiRes.ok) {
        const err = await coquiRes.text();
        sendJson(res, 502, { error: 'Coqui error: ' + err });
        return;
      }

      const audioBuffer = Buffer.from(await coquiRes.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(audioBuffer);
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Amo TTS server running on port ${PORT}`);
  console.log(`Coqui endpoint: ${COQUI_URL}`);
});
