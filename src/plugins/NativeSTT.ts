import { registerPlugin } from '@capacitor/core';

export interface NativeSTTStartOptions {
  language?: string;
  maxResults?: number;
  partialResults?: boolean;
  continuous?: boolean;
  completeSilenceMillis?: number;
  possibleCompleteSilenceMillis?: number;
  minimumSpeechMillis?: number;
}

export interface NativeSTTResult {
  matches: string[];
  isFinal: boolean;
}

export interface NativeSTTStatus {
  status: 'listening' | 'stopped' | 'error';
  message?: string;
}

export interface NativeSTTPlugin {
  initialize(): Promise<{ available: boolean }>;
  start(options: NativeSTTStartOptions): Promise<void>;
  stop(): Promise<void>;
  checkPermissions(): Promise<{ microphone: string }>;
  requestPermissions(): Promise<{ microphone: string }>;
  addListener(
    eventName: 'partialResults' | 'finalResults' | 'sttStatus',
    listenerFunc: (result: NativeSTTResult | NativeSTTStatus) => void,
  ): Promise<{ remove: () => void }>;
}

const NativeSTT = registerPlugin<NativeSTTPlugin>('NativeSTT', {
  web: () => import('./NativeSTTWeb').then((m) => new m.NativeSTTWeb()),
});

export default NativeSTT;
