#!/bin/bash
# Install Piper TTS - fast, open-source text-to-speech

PIPER_VERSION="1.2.0"

echo "Installing Piper TTS..."

# Download Piper
if [ ! -f ./piper ]; then
  echo "Downloading Piper..."
  curl -L -o piper "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper-linux-x86_64"
  chmod +x piper
fi

# Download voice model (en_US-lessac-medium - good quality, medium size)
VOICE_DIR="./piper-voices"
mkdir -p "$VOICE_DIR"

if [ ! -f "$VOICE_DIR/en_US-lessac-medium.onnx" ]; then
  echo "Downloading voice model..."
  curl -L -o "$VOICE_DIR/en_US-lessac-medium.onnx" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"
fi

if [ ! -f "$VOICE_DIR/en_US-lessac-medium.onnx.json" ]; then
  echo "Downloading voice config..."
  curl -L -o "$VOICE_DIR/en_US-lessac-medium.onnx.json" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
fi

# Additional voices you can download:
# en_US-lessac-low - lower quality but faster
# en_US-amy-medium - female voice
# en_US-ryan-medium - male voice

echo "Done! Run with: PIPER_PATH=./piper TTS_VOICE_MAP='{\"bm_george\":\"$PIPER_DIR/en_US-lessac-medium.onnx\"}' node server/index-piper.mjs"
