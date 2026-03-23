import { registerPlugin } from '@capacitor/core';

export interface NativeAndroidTTSPlugin {
  initialize(options?: { speakerId?: number; speed?: number }): Promise<{ available: boolean; voices?: string }>;
  speak(options: { text: string; speakerId?: number; speed?: number; pitch?: number }): Promise<void>;
  stop(): Promise<void>;
  getVoices(): Promise<{ [key: string]: any }>;
}

const NativeAndroidTTS = registerPlugin<NativeAndroidTTSPlugin>('NativeAndroidTTS');

export default NativeAndroidTTS;
