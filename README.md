<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Amo Android + Mistral setup

This project is now set up as a Vite + React app with an Express API layer for Mistral and Capacitor support for Android builds.

## Run locally

**Prerequisites:** Node.js


1. Install dependencies: `npm install`
2. Create `.env.local` from `.env.example`
3. Set `MISTRAL_API_KEY` for the backend, or add a key later inside the app settings
4. Start the web app and API together: `npm run dev`

## Android build

1. Create the Android project once: `npm run android:add`
2. Build the web bundle and sync Capacitor: `npm run android:build`
3. Open Android Studio: `npm run android:open`

## API key management

- Preferred: keep `MISTRAL_API_KEY` on the server
- Optional: users can save their own Mistral key inside the app settings; it is stored locally on-device with Capacitor Preferences when available
- For packaged mobile builds that call a hosted backend, set `VITE_API_BASE_URL` to that backend URL before building
