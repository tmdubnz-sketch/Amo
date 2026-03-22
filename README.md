<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Amo Android + Mistral setup

This project is a Vite + React app with Capacitor Android support, direct Mistral chat, native STT, and self-hosted Coqui TTS playback.

## Recommended voice stack

The app no longer uses Android or browser system voices. Voice replies now flow through:

1. React app -> `/api/tts`
2. Local Node proxy in `server/index.mjs`
3. Self-hosted Coqui XTTS server at `http://127.0.0.1:5002/v1/audio/speech`
4. Returned audio playback in the app

This is the practical open-source path for getting closer to a real Aotearoa/Maori delivery. System TTS will not get there.

## Local setup

1. Install dependencies: `npm install`
2. Create `.env.local` from `.env.example`
3. Start Coqui XTTS: `npm run dev:coqui`
4. Start the local TTS proxy: `npm run dev:api`
5. Start the app: `npm run dev:web`

The included Docker Compose file mounts `./tts-data/reference` into the Coqui container as `/voices`.
A reference file has been staged at `tts-data/reference/MaakaPohatu.mp3`.

For best XTTS conditioning results, replace that MP3 with a clean mono WAV clip when you can.

## Android build

1. Create the Android project once: `npm run android:add`
2. Build the web bundle and sync Capacitor: `npm run android:build`
3. Open Android Studio: `npm run android:open`

## Mobile networking

For packaged Android builds, set `VITE_API_BASE_URL` to the host that serves the Node proxy on `/api/tts`.
Do not point the mobile app straight at the Coqui container unless you also expose and secure it directly.

## API key management

- Users save their own Mistral key inside the app settings.
- The key is stored locally on-device with Capacitor Preferences when available.
