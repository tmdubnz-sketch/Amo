import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

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
  return {
    port: Number(process.env.PORT || 8787),
    piperPath: (process.env.PIPER_PATH || '/usr/local/bin/piper').trim(),
    voiceModel: (process.env.PIPER_VOICE || 'en_US-lessac-medium').trim(),
    voiceMap: (process.env.TTS_VOICE_MAP || '').trim(),
    defaultRate: Number(process.env.PIPER_RATE || 1.0),
  };
}

function parseVoiceMap(rawVoiceMap) {
  if (!rawVoiceMap) {
    return {};
  }
  try {
    return JSON.parse(rawVoiceMap);
  } catch {
    return {};
  }
}

function resolveVoice(config, requestedVoice) {
  if (!requestedVoice) {
    return config.voiceModel;
  }
  const voiceMap = parseVoiceMap(config.voiceMap);
  return voiceMap[requestedVoice] || config.voiceModel;
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

async function runPiper(text, voiceModel, rate) {
  return new Promise((resolve, reject) => {
    const args = [
      '--model', voiceModel,
      '--output-raw',
      '--speaker', '0',
    ];
    
    if (rate && rate !== 1) {
      args.push('--length-scale', String(1 / rate));
    }

    const piper = spawn('piper', args);
    let audioChunks = [];
    let stderr = '';

    piper.stdout.on('data', (chunk) => {
      audioChunks.push(chunk);
    });

    piper.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    piper.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(audioChunks));
      } else {
        reject(new Error(`Piper exited with code ${code}: ${stderr}`));
      }
    });

    piper.on('error', (err) => {
      reject(new Error(`Failed to run piper: ${err.message}`));
    });

    piper.stdin.write(text);
    piper.stdin.end();
  });
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
    json(response, 200, { ok: true, backend: 'piper' });
    return;
  }

  if (request.method === 'POST' && request.url === '/api/tts') {
    try {
      const rawBody = await readRequestBody(request);
      const payload = rawBody ? JSON.parse(rawBody) : {};
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      const voice = typeof payload.voice === 'string' ? payload.voice.trim() : '';
      const rate = typeof payload.rate === 'number' ? payload.rate : 1;

      if (!text) {
        json(response, 400, { error: 'Missing text.' });
        return;
      }

      const config = getConfig();
      const voiceModel = resolveVoice(config, voice);

      const audioBuffer = await runPiper(text, voiceModel, rate);

      response.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      response.end(audioBuffer);
    } catch (error) {
      console.error('TTS error:', error);
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
  console.log('Using Piper TTS (open source)');
});
