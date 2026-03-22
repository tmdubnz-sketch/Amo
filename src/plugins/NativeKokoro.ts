import { registerPlugin } from '@capacitor/core';

export interface NativeKokoroInitOptions {
  speakerId?: number;
  speed?: number;
}

export interface NativeKokoroSpeakOptions {
  text: string;
  speakerId?: number;
  speed?: number;
}

export interface NativeKokoroPlugin {
  initialize(options?: NativeKokoroInitOptions): Promise<{ available: boolean; sampleRate?: number; speakerId?: number; reason?: string }>;
  speak(options: NativeKokoroSpeakOptions): Promise<void>;
  stop(): Promise<void>;
}

const NativeKokoro = registerPlugin<NativeKokoroPlugin>('NativeKokoro');

export default NativeKokoro;
