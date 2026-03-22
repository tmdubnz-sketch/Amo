#!/bin/bash
# Setup script for Oracle Cloud Free Tier
# Run this on a fresh Oracle Cloud ARM instance (ubuntu)

set -e

echo "=== Amo TTS Server Setup ==="
echo "Running on Oracle Cloud Free Tier"

# Update system
echo "Updating system..."
apt update && apt upgrade -y

# Install Docker
echo "Installing Docker..."
apt install -y docker.io docker-compose-v2
systemctl enable docker
usermod -aG docker ubuntu

# Create app directory
mkdir -p /opt/amo-tts
cd /opt/amo-tts

# Create voice samples directory (you'll upload voice files here)
mkdir -p voices

# Copy docker-compose file
cat > docker-compose.yml << 'EOF'
version: '3.8'
services:
  coqui:
    image: ghcr.io/idiap/coqui-tts-cpu:latest
    container_name: amo-tts
    ports:
      - "5002:5002"
    volumes:
      - ./voices:/root/.local/share/tts
    restart: unless-stopped
    command: --model_name tts_models/multilingual/multi-dataset/xtts_v2
EOF

# Copy server files
cat > server.mjs << 'SERVEREOF'
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';

const PORT = process.env.PORT || 3000;
const COQUI_URL = process.env.COQUI_URL || 'http://localhost:5002/v1/audio/speech';
const VOICE = process.env.TTS_VOICE || '/root/.local/share/tts/voices/MaakaPohatu.mp3';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/tts') {
    try {
      const body = await readBody(req);
      const { text } = JSON.parse(body);
      
      if (!text) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Missing text' }));
        return;
      }

      const coquiRes = await fetch(COQUI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model: 'tts_models/multilingual/multi-dataset/xtts_v2',
          speaker_wav: VOICE,
          language: 'en'
        })
      });

      const audioBuffer = Buffer.from(await coquiRes.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(audioBuffer);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Amo TTS server running on port ${PORT}`);
});
SERVEREOF

# Create package.json
cat > package.json << 'EOF'
{
  "name": "amo-tts",
  "version": "1.0.0",
  "type": "module"
}
EOF

# Setup firewall
echo "Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp
ufw --force enable

# Start services
echo "Starting Docker..."
systemctl start docker

echo "Starting TTS services..."
docker compose up -d

# Wait for Coqui to download model (first run takes a few minutes)
echo "Waiting for Coqui TTS to initialize (this takes 5-10 minutes first time)..."
sleep 30

# Check status
echo ""
echo "=== Setup Complete! ==="
echo ""
echo "To check status:"
echo "  docker compose logs -f coqui"
echo ""
echo "Your TTS server will be available at:"
echo "  http://YOUR_SERVER_IP:3000/api/tts"
echo ""
echo "Add to your app's .env:"
echo "  VITE_API_BASE_URL=http://YOUR_SERVER_IP:3000"
