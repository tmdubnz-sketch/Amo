<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Amo Android + Mistral setup

This project is now set up as a Vite + React app with Capacitor support for Android builds and direct Mistral API usage from the app.

## Run locally

**Prerequisites:** Node.js


1. Install dependencies: `npm install`
2. Create `.env.local` from `.env.example`
3. Add your Mistral API key later inside the app settings
4. Start the app: `npm run dev:web`

## Android build

1. Create the Android project once: `npm run android:add`
2. Build the web bundle and sync Capacitor: `npm run android:build`
3. Open Android Studio: `npm run android:open`

## API key management

- Users save their own Mistral key inside the app settings
- The key is stored locally on-device with Capacitor Preferences when available
