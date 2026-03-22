import { WebPlugin } from '@capacitor/core';
import type {
  NativeSTTPlugin,
  NativeSTTStartOptions,
  NativeSTTResult,
  NativeSTTSessionState,
  NativeSTTStatus,
} from './NativeSTT';

export class NativeSTTWeb extends WebPlugin implements NativeSTTPlugin {
  private recognition: any | null = null;
  private isStopping = false;
  private transcript = '';
  private speechDetected = false;

  private emitSessionState(
    phase: NativeSTTSessionState['phase'],
    overrides: Partial<NativeSTTSessionState> = {},
  ) {
    this.notifyListeners('sessionState', {
      phase,
      transcript: this.transcript,
      speechDetected: this.speechDetected,
      ...overrides,
    } as NativeSTTSessionState);
  }

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

    this.isStopping = false;
    this.transcript = '';
    this.speechDetected = false;
    this.recognition = new SpeechRecognitionCtor();
    this.recognition.lang = options.language || 'en-NZ';
    this.recognition.continuous = options.continuous ?? false;
    this.recognition.interimResults = options.partialResults ?? true;
    this.recognition.maxAlternatives = options.maxResults || 1;

    this.emitSessionState('starting');

    this.recognition.onstart = () => {
      this.notifyListeners('sttStatus', { status: 'listening' } as NativeSTTStatus);
      this.emitSessionState('listening');
    };

    this.recognition.onspeechstart = () => {
      this.speechDetected = true;
      this.emitSessionState('listening');
    };

    this.recognition.onresult = (event: any) => {
      const matches = Array.from(event.results)
        .map((r: any) => r[0]?.transcript || '')
        .filter(Boolean);

      const isFinal = event.results[event.results.length - 1]?.isFinal;
      const transcript = matches.join(' ').trim();
      this.transcript = transcript;
      if (transcript) {
        this.speechDetected = true;
      }

      this.notifyListeners(
        isFinal ? 'finalResults' : 'partialResults',
        { matches, isFinal } as NativeSTTResult,
      );

      this.emitSessionState(isFinal ? 'stopped' : 'listening', {
        finalTranscript: isFinal ? transcript : undefined,
      });

      if (isFinal) {
        this.transcript = '';
        this.speechDetected = false;
      }
    };

    this.recognition.onerror = (event: any) => {
      if (!this.isStopping) {
        this.notifyListeners('sttStatus', {
          status: 'error',
          message: event.error,
        } as NativeSTTStatus);
        this.emitSessionState('error', { message: event.error });
      }
    };

    this.recognition.onend = () => {
      const wasStopping = this.isStopping;
      this.recognition = null;
      this.isStopping = false;
      if (!wasStopping) {
        this.notifyListeners('sttStatus', { status: 'stopped' } as NativeSTTStatus);
        this.emitSessionState('stopped');
      }

      this.transcript = '';
      this.speechDetected = false;
    };

    this.recognition.start();
  }

  async stop(): Promise<void> {
    if (this.recognition) {
      this.isStopping = true;
      try {
        this.recognition.stop();
      } catch {
        // Ignore errors during stop
      }
    }

    this.transcript = '';
    this.speechDetected = false;
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
