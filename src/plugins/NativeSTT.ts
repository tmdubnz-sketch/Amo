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

export interface NativeSTTSessionState {
  phase: 'starting' | 'listening' | 'transcribing' | 'stopped' | 'error';
  transcript: string;
  finalTranscript?: string;
  speechDetected: boolean;
  vadActive?: boolean;
  recording?: boolean;
  transcribing?: boolean;
  level?: number;
  noiseFloor?: number;
  threshold?: number;
  backend?: string;
  message?: string;
}

export interface NativeSTTPlugin {
  initialize(): Promise<{ available: boolean }>;
  start(options: NativeSTTStartOptions): Promise<void>;
  stop(): Promise<void>;
  checkPermissions(): Promise<{ microphone: string }>;
  requestPermissions(): Promise<{ microphone: string }>;
  addListener(
    eventName: 'partialResults' | 'finalResults' | 'sttStatus' | 'sessionState',
    listenerFunc: (result: NativeSTTResult | NativeSTTStatus | NativeSTTSessionState) => void,
  ): Promise<{ remove: () => void }>;
}

const NativeSTT = registerPlugin<NativeSTTPlugin>('NativeSTT', {
  web: () => import('./NativeSTTRemote').then((m) => new m.NativeSTTRemote()),
});

export default NativeSTT;
