<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Amo Android + Mistral setup

This project is a Vite + React app with Capacitor Android support, direct Mistral chat, ElevenLabs voice playback, and on-device speech recognition for Android.

## Current AI stack

1. Chat uses direct Mistral API calls from the app.
2. Voice replies use ElevenLabs TTS with centralized per-persona voice settings.
3. `Amo` uses a custom ElevenLabs voice cloned from `AmoVoice.wav`, while `Keri` uses a stock ElevenLabs voice.
4. Android live mode uses the native Sherpa-ONNX stack for VAD and speech recognition.
5. Web live mode uses the browser speech recognition API.

The single source of truth for provider, model, persona, dialect, and voice configuration is [src/config/ai.ts](/Users/tmdub/Projects/Amo/src/config/ai.ts).

## Local setup

1. Install dependencies: `npm install`
2. Create `.env.local` from `.env.example`
3. Start the app: `npm run dev:web`

## Persona voices

The app maps persona ids to ElevenLabs voice ids and voice settings in the frontend.

## Android build

1. Create the Android project once: `npm run android:add`
2. Build the web bundle and sync Capacitor: `npm run android:build`
3. Open Android Studio: `npm run android:open`

## API key management

- Users save their own Mistral key inside the app settings.
- The key is stored locally on-device with Capacitor Preferences when available.
