import { WebPlugin } from '@capacitor/core';
import type {
  NativeSTTPlugin,
  NativeSTTStartOptions,
  NativeSTTResult,
  NativeSTTStatus,
} from './NativeSTT';

export class NativeSTTWeb extends WebPlugin implements NativeSTTPlugin {
  private recognition: any | null = null;

  async initialize() {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    return { available: !!SpeechRecognitionCtor };
  }

  async start(options: NativeSTTStartOptions): Promise<void> {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      throw new Error('Speech recognition not supported in this browser');
    }

    this.recognition = new SpeechRecognitionCtor();
    this.recognition.lang = options.language || 'en-NZ';
    this.recognition.continuous = options.continuous ?? false;
    this.recognition.interimResults = options.partialResults ?? true;
    this.recognition.maxAlternatives = options.maxResults || 1;

    this.recognition.onstart = () => {
      this.notifyListeners('sttStatus', { status: 'listening' } as NativeSTTStatus);
    };

    this.recognition.onresult = (event: any) => {
      const matches = Array.from(event.results)
        .map((r: any) => r[0]?.transcript || '')
        .filter(Boolean);

      const isFinal = event.results[event.results.length - 1]?.isFinal;

      this.notifyListeners(
        isFinal ? 'finalResults' : 'partialResults',
        { matches, isFinal } as NativeSTTResult,
      );
    };

    this.recognition.onerror = (event: any) => {
      this.notifyListeners('sttStatus', {
        status: 'error',
        message: event.error,
      } as NativeSTTStatus);
    };

    this.recognition.onend = () => {
      this.notifyListeners('sttStatus', { status: 'stopped' } as NativeSTTStatus);
    };

    this.recognition.start();
  }

  async stop(): Promise<void> {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
  }

  async checkPermissions() {
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      return { microphone: 'denied' };
    }

    try {
      const result = await navigator.permissions.query({ name: 'microphone' as any });
      return { microphone: result.state };
    } catch {
      return { microphone: 'prompt' };
    }
  }

  async requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return { microphone: 'granted' };
    } catch {
      return { microphone: 'denied' };
    }
  }
}
