import { WebPlugin } from '@capacitor/core';
import type {
  NativeSTTPlugin,
  NativeSTTSessionState,
  NativeSTTStartOptions,
} from './NativeSTT';

const DEFAULT_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

const MONITOR_INTERVAL_MS = 50;
const PREROLL_MS = 350;
const START_CONFIRM_MS = 80;
const END_SILENCE_MS = 450;
const MIN_UTTERANCE_MS = 400;
const MAX_UTTERANCE_MS = 12000;
const MIN_THRESHOLD = 0.006;
const VOICE_FLOOR_MULTIPLIER = 1.6;
const FORCE_TRANSCRIBE_AFTER_MS = 2200;
const RECORDER_FLUSH_WAIT_MS = 320;

type RecordedChunk = {
  blob: Blob;
  at: number;
};

function getApiBaseUrl() {
  const configuredBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, '');
  }

  return '';
}

function getSttUrl() {
  return `${getApiBaseUrl()}/api/stt`;
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    return '';
  }

  const supported = DEFAULT_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
  return supported || '';
}

function getAudioContextCtor() {
  return window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

async function blobToBase64(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Failed to read audio blob.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

async function wait(ms: number) {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class NativeSTTRemote extends WebPlugin implements NativeSTTPlugin {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private monitorSinkNode: GainNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private monitorTimer: number | null = null;
  private currentAbortController: AbortController | null = null;

  private running = false;
  private transcribing = false;
  private speechDetected = false;
  private transcript = '';
  private language = 'en-NZ';
  private mimeType = '';

  private chunks: RecordedChunk[] = [];
  private candidateSpeechStartAt = 0;
  private utteranceStartAt = 0;
  private lastVoiceAt = 0;
  private noiseFloor = 0.008;
  private smoothedLevel = 0;
  private vadActive = false;

  private emitSessionState(
    phase: NativeSTTSessionState['phase'],
    overrides: Partial<NativeSTTSessionState> = {},
  ) {
    this.notifyListeners('sessionState', {
      phase,
      transcript: this.transcript,
      speechDetected: this.speechDetected,
      vadActive: this.vadActive,
      recording: !!this.mediaRecorder,
      transcribing: this.transcribing,
      level: Number(this.smoothedLevel.toFixed(4)),
      noiseFloor: Number(this.noiseFloor.toFixed(4)),
      threshold: Number(Math.max(MIN_THRESHOLD, this.noiseFloor * VOICE_FLOOR_MULTIPLIER).toFixed(4)),
      backend: 'whisper-asr',
      ...overrides,
    } as NativeSTTSessionState);
  }

  async initialize() {
    const available =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined' &&
      !!getAudioContextCtor();

    return { available };
  }

  async start(options: NativeSTTStartOptions): Promise<void> {
    if (this.running) {
      await this.stop();
    }

    this.running = true;
    this.transcribing = false;
    this.language = options.language || 'en-NZ';
    this.transcript = '';
    this.speechDetected = false;
    this.chunks = [];
    this.candidateSpeechStartAt = 0;
    this.utteranceStartAt = 0;
    this.lastVoiceAt = 0;
    this.noiseFloor = 0.008;
    this.smoothedLevel = 0;
    this.vadActive = false;
    this.emitSessionState('starting');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioContextCtor = getAudioContextCtor();
      if (!AudioContextCtor) {
        throw new Error('Audio context is not available on this device.');
      }

      this.audioContext = new AudioContextCtor();
      await this.audioContext.resume().catch(() => undefined);
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processorNode = this.audioContext.createScriptProcessor(2048, 1, 1);
      this.monitorSinkNode = this.audioContext.createGain();
      this.monitorSinkNode.gain.value = 0;

      this.processorNode.onaudioprocess = (event) => {
        const channelData = event.inputBuffer.getChannelData(0);
        if (!channelData || channelData.length === 0) {
          return;
        }

        let sum = 0;
        for (let i = 0; i < channelData.length; i += 1) {
          sum += channelData[i] * channelData[i];
        }

        const rms = Math.sqrt(sum / channelData.length);
        this.smoothedLevel = this.smoothedLevel === 0 ? rms : this.smoothedLevel * 0.82 + rms * 0.18;
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.monitorSinkNode);
      this.monitorSinkNode.connect(this.audioContext.destination);

      this.mimeType = pickMimeType();
      this.startRecorder();
      this.emitSessionState('listening');
      this.startMonitoring();
    } catch (error) {
      this.running = false;
      const message = error instanceof Error ? error.message : 'Failed to access microphone.';
      this.emitSessionState('error', { message });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.transcribing = false;
    this.stopMonitoring();
    this.currentAbortController?.abort();
    this.currentAbortController = null;

    this.stopRecorder();

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
      this.processorNode = null;
    }

    if (this.monitorSinkNode) {
      this.monitorSinkNode.disconnect();
      this.monitorSinkNode = null;
    }

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.transcript = '';
    this.speechDetected = false;
    this.chunks = [];
    this.candidateSpeechStartAt = 0;
    this.utteranceStartAt = 0;
    this.lastVoiceAt = 0;
    this.vadActive = false;
    this.emitSessionState('stopped');
  }

  async checkPermissions() {
    try {
      const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      return { microphone: result.state };
    } catch {
      return { microphone: 'prompt' };
    }
  }

  async requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return { microphone: 'granted' };
    } catch {
      return { microphone: 'denied' };
    }
  }

  private startRecorder() {
    if (!this.mediaStream) {
      throw new Error('Microphone stream is not available.');
    }

    this.mediaRecorder = this.mimeType
      ? new MediaRecorder(this.mediaStream, { mimeType: this.mimeType })
      : new MediaRecorder(this.mediaStream);

    this.mediaRecorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) {
        return;
      }

      this.chunks.push({ blob: event.data, at: Date.now() });
      this.pruneChunks();
    };

    this.mediaRecorder.start(250);
  }

  private stopRecorder() {
    if (!this.mediaRecorder) {
      return;
    }

    try {
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    } catch {
      // Ignore stop errors.
    }

    this.mediaRecorder.ondataavailable = null;
    this.mediaRecorder = null;
  }

  private startMonitoring() {
    const tick = () => {
      if (!this.running || !this.processorNode) {
        return;
      }

      const now = Date.now();
      const isUtteranceOpen = this.utteranceStartAt > 0;
      if (!isUtteranceOpen && !this.transcribing) {
        this.noiseFloor = this.noiseFloor * 0.97 + this.smoothedLevel * 0.03;
      }

      const threshold = Math.max(MIN_THRESHOLD, this.noiseFloor * VOICE_FLOOR_MULTIPLIER);
      const isVoice = this.smoothedLevel >= threshold;
      this.vadActive = isVoice;

      if (!this.transcribing) {
        if (isVoice) {
          this.lastVoiceAt = now;

          if (!this.candidateSpeechStartAt) {
            this.candidateSpeechStartAt = now;
          }

          if (!this.utteranceStartAt && now - this.candidateSpeechStartAt >= START_CONFIRM_MS) {
            this.utteranceStartAt = Math.max(0, now - PREROLL_MS);
            this.speechDetected = true;
            this.emitSessionState('listening');
          }
        } else if (!this.utteranceStartAt) {
          this.candidateSpeechStartAt = 0;
        }

        if (this.utteranceStartAt) {
          const utteranceDuration = now - this.utteranceStartAt;
          const silenceDuration = now - this.lastVoiceAt;
          if (
            utteranceDuration >= MIN_UTTERANCE_MS &&
            (
              silenceDuration >= END_SILENCE_MS ||
              utteranceDuration >= FORCE_TRANSCRIBE_AFTER_MS ||
              utteranceDuration >= MAX_UTTERANCE_MS
            )
          ) {
            void this.finishUtterance(now);
            return;
          }
        }
      }

      this.monitorTimer = window.setTimeout(tick, MONITOR_INTERVAL_MS);
    };

    tick();
  }

  private stopMonitoring() {
    if (this.monitorTimer !== null) {
      clearTimeout(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  private pruneChunks() {
    const floor = this.utteranceStartAt > 0 ? this.utteranceStartAt - PREROLL_MS : Date.now() - 3000;
    this.chunks = this.chunks.filter((chunk) => chunk.at >= floor);
  }

  private async finishUtterance(finishedAt: number) {
    if (this.transcribing || !this.utteranceStartAt) {
      return;
    }

    this.transcribing = true;
    this.stopMonitoring();
    this.emitSessionState('transcribing');

    try {
      this.mediaRecorder?.requestData();
    } catch {
      // Some WebViews may not support requestData reliably.
    }

    await wait(RECORDER_FLUSH_WAIT_MS);

    const utteranceStartAt = this.utteranceStartAt - PREROLL_MS;
    const utteranceChunks = this.chunks.filter((chunk) => chunk.at >= utteranceStartAt && chunk.at <= finishedAt + 500);

    this.candidateSpeechStartAt = 0;
    this.utteranceStartAt = 0;
    this.lastVoiceAt = 0;

    if (utteranceChunks.length === 0) {
      this.transcribing = false;
      this.speechDetected = false;
      this.vadActive = false;
      if (this.running) {
        this.emitSessionState('error', { message: 'No recorded audio chunks were available for transcription.' });
        this.emitSessionState('listening');
        this.startMonitoring();
      }
      return;
    }

    const blob = new Blob(utteranceChunks.map((chunk) => chunk.blob), {
      type: utteranceChunks[0]?.blob.type || this.mimeType || 'audio/webm',
    });

    if (blob.size < 2048) {
      this.transcribing = false;
      this.speechDetected = false;
      this.vadActive = false;
      if (this.running) {
        this.emitSessionState('error', { message: `Recorded audio too small for transcription (${blob.size} bytes).` });
        this.emitSessionState('listening');
        this.startMonitoring();
      }
      return;
    }

    this.chunks = this.chunks.filter((chunk) => chunk.at > finishedAt);

    try {
      const transcript = await this.transcribeBlob(blob);
      this.transcript = '';
      this.speechDetected = false;
      this.vadActive = false;
      this.emitSessionState('stopped', { finalTranscript: transcript, transcript: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Remote STT failed.';
      this.vadActive = false;
      this.emitSessionState('error', { message });
    } finally {
      this.transcribing = false;
      if (this.running) {
        this.transcript = '';
        this.speechDetected = false;
        this.vadActive = false;
        this.emitSessionState('listening', { transcript: '' });
        this.startMonitoring();
      }
    }
  }

  private async transcribeBlob(blob: Blob) {
    const audioBase64 = await blobToBase64(blob);
    this.currentAbortController = new AbortController();

    const response = await fetch(getSttUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || this.mimeType || 'audio/webm',
        language: this.language,
      }),
      signal: this.currentAbortController.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: 'Remote STT request failed.' }));
      throw new Error(payload.error || 'Remote STT request failed.');
    }

    const payload = await response.json();
    const transcript = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!transcript) {
      throw new Error('Remote STT returned empty transcription.');
    }

    return transcript;
  }
}
