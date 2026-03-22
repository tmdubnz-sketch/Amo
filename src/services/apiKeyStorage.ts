import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

const STORAGE_KEY = 'amo-mistral-api-key';

function getFallbackStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.sessionStorage;
}

export async function getStoredApiKey() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY });
      if (value) {
        return value;
      }
    } catch (error) {
      console.error('Error reading stored API key from Preferences:', error);
    }
  }

  return getFallbackStorage()?.getItem(STORAGE_KEY) ?? '';
}

export async function setStoredApiKey(value: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Preferences.set({ key: STORAGE_KEY, value });
    } catch (error) {
      console.error('Error saving API key to Preferences:', error);
    }
  }

  getFallbackStorage()?.setItem(STORAGE_KEY, value);
}

export async function clearStoredApiKey() {
  if (Capacitor.isNativePlatform()) {
    try {
      await Preferences.remove({ key: STORAGE_KEY });
    } catch (error) {
      console.error('Error clearing API key from Preferences:', error);
    }
  }

  getFallbackStorage()?.removeItem(STORAGE_KEY);
}
