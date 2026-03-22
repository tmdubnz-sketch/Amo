import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'amo-mistral-api-key';

async function getPreferences() {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  const module = await import('@capacitor/preferences');
  return module.Preferences;
}

export async function getStoredApiKey() {
  const preferences = await getPreferences();

  if (preferences) {
    const { value } = await preferences.get({ key: STORAGE_KEY });
    return value ?? '';
  }

  return window.localStorage.getItem(STORAGE_KEY) ?? '';
}

export async function setStoredApiKey(value: string) {
  const preferences = await getPreferences();

  if (preferences) {
    await preferences.set({ key: STORAGE_KEY, value });
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, value);
}

export async function clearStoredApiKey() {
  const preferences = await getPreferences();

  if (preferences) {
    await preferences.remove({ key: STORAGE_KEY });
    return;
  }

  window.localStorage.removeItem(STORAGE_KEY);
}
