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
  phase: 'starting' | 'listening' | 'transcribing' | 'speaking' | 'idle' | 'stopped' | 'error';
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
  speak(options: { text: string; speakerId?: number; speed?: number }): Promise<void>;
  stopSpeaking(): Promise<void>;
  ask(options: { prompt: string }): Promise<{ text: string }>;
  checkPermissions(): Promise<{ microphone: string }>;
  requestPermissions(): Promise<{ microphone: string }>;
  addListener(
    eventName: 'partialResults' | 'finalResults' | 'sttStatus' | 'sessionState' | 'llmResponse',
    listenerFunc: (data: any) => void,
  ): Promise<{ remove: () => void }>;
}

const NativeSTT = registerPlugin<NativeSTTPlugin>('NativeSTT', {
  web: () => import('./NativeSTTWeb').then((m) => new m.NativeSTTWeb()),
});

export default NativeSTT;
