# Deta Space - Free 24/7 Hosting
# Deploy to Deta Space from GitHub

This folder contains the TTS proxy server for Deta Space deployment.

## Quick Setup

1. **Create a Deta Space account** at https://deta.space
   - No credit card needed!

2. **Push this project to GitHub**

3. **Install Deta CLI:**
   ```bash
   npm i -g @deta/cli
   ```

4. **Create a new Space app:**
   ```bash
   deta space new
   ```

5. **Deploy:**
   ```bash
   deta space deploy
   ```

## Setting Up TTS.ai API (Optional)

TTS.ai works without an API key for basic use.

To get an API key (higher rate limits):
1. Go to https://tts.ai
2. Sign up (free)
3. Get API key from dashboard

Add to Space environment variables:
```bash
deta space env set TTSAI_API_KEY=your_key
```

## After Deployment

Get your app's URL from Deta Space dashboard, then set:
```
VITE_API_BASE_URL=https://your-app-name.space.deta.ai
```

Rebuild Android app with the new URL.
