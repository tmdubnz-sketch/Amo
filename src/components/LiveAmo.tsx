import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Mic, MicOff, MessageCircleMore, X } from 'lucide-react';
import { motion } from 'motion/react';
import AmoAvatar from './AmoAvatar';
import { soundService } from '../services/soundService';
import { speakText } from '../services/ttsService';

interface LiveAmoProps {
  onClose: () => void;
  onSendMessage: (text: string) => Promise<void>;
  latestReply: string;
  isLoading: boolean;
  persona: {
    id: string;
    name: string;
    gender: string;
  };
}

type SttPhase =
  | 'initializing'
  | 'unavailable'
  | 'paused'
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speaking'
  | 'processing'
  | 'error';

interface LiveSttState {
  isAvailable: boolean;
  phase: SttPhase;
  autoListen: boolean;
  transcript: string;
  lastTranscript: string;
  pendingReply: boolean;
  failures: number;
  lastError: string | null;
}

type LiveSttAction =
  | { type: 'init'; available: boolean }
  | { type: 'setAutoListen'; enabled: boolean }
  | { type: 'startRequested' }
  | { type: 'startFailed'; message: string }
  | { type: 'listening' }
  | { type: 'speaking' }
  | { type: 'partial'; text: string }
  | { type: 'stopped' }
  | { type: 'error'; message: string }
  | { type: 'finalCaptured'; text: string }
  | { type: 'sendSettled' }
  | { type: 'replyReceived' }
  | { type: 'replyConsumed' };

const REARM_DELAY_MS = 120;
const MAX_REARM_DELAY_MS = 3000;

const initialState: LiveSttState = {
  isAvailable: false,
  phase: 'initializing',
  autoListen: true,
  transcript: '',
  lastTranscript: '',
  pendingReply: false,
  failures: 0,
  lastError: null,
};

function getRestingPhase(state: LiveSttState) {
  if (!state.isAvailable) {
    return 'unavailable' as const;
  }
  return state.autoListen ? ('idle' as const) : ('paused' as const);
}

function liveSttReducer(state: LiveSttState, action: LiveSttAction): LiveSttState {
  switch (action.type) {
    case 'init':
      return {
        ...state,
        isAvailable: action.available,
        phase: action.available ? getRestingPhase({ ...state, isAvailable: true }) : 'unavailable',
        lastError: action.available ? null : 'Speech recognition is not available on this device.',
      };
    case 'setAutoListen': {
      const nextState = { ...state, autoListen: action.enabled, transcript: action.enabled ? state.transcript : '' };
      if (state.phase === 'processing' || state.pendingReply) return nextState;
      return { ...nextState, phase: getRestingPhase(nextState) };
    }
    case 'startRequested':
      return { ...state, phase: 'starting', lastError: null };
    case 'startFailed':
      return { ...state, phase: 'error', transcript: '', failures: state.failures + 1, lastError: action.message };
    case 'listening':
      return { ...state, phase: 'listening', failures: 0, lastError: null };
    case 'speaking':
      return { ...state, phase: 'speaking', failures: 0, lastError: null };
    case 'partial':
      return { ...state, transcript: action.text, failures: action.text ? 0 : state.failures };
    case 'stopped':
      if (state.phase === 'processing' || state.phase === 'speaking') return state;
      return { ...state, phase: getRestingPhase(state), transcript: '' };
    case 'error':
      if (state.phase === 'processing' || state.phase === 'speaking') return state;
      return { ...state, phase: 'error', transcript: '', failures: state.failures + 1, lastError: action.message };
    case 'finalCaptured':
      return { ...state, phase: 'processing', transcript: action.text, lastTranscript: action.text, failures: 0, lastError: null };
    case 'sendSettled':
      return { ...state, phase: state.pendingReply ? 'processing' : state.phase };
    case 'replyReceived':
      return { ...state, pendingReply: true, phase: 'speaking' };
    case 'replyConsumed': {
      const nextState = { ...state, pendingReply: false };
      return { ...nextState, phase: getRestingPhase(nextState) };
    }
    default:
      return state;
  }
}

function getStartDelay(failures: number) {
  return Math.min(REARM_DELAY_MS * Math.pow(2, Math.max(0, failures - 1)), MAX_REARM_DELAY_MS);
}

interface WebSTTCallbacks {
  onStart: () => void;
  onListening: () => void;
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

class WebSpeechRecognizer {
  private recognition: any | null = null;
  private callbacks: WebSTTCallbacks | null = null;

  constructor() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    console.log('[WebSTT] Constructor - SpeechRecognition available:', !!SpeechRecognition);
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'en-NZ';
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      
      this.recognition.onerror = (event: any) => {
        console.log('[WebSTT] onerror:', event.error);
      };
      this.recognition.onstart = () => {
        console.log('[WebSTT] onstart');
      };
      this.recognition.onend = () => {
        console.log('[WebSTT] onend');
      };
      this.recognition.onspeechstart = () => {
        console.log('[WebSTT] onspeechstart');
      };
      this.recognition.onspeechend = () => {
        console.log('[WebSTT] onspeechend');
      };
      this.recognition.onaudiostart = () => {
        console.log('[WebSTT] onaudiostart');
      };
      this.recognition.onaudioend = () => {
        console.log('[WebSTT] onaudioend');
      };
    }
  }

  isAvailable(): boolean {
    console.log('[WebSTT] isAvailable:', !!this.recognition);
    return !!this.recognition;
  }

  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      console.log('[WebSTT] Permission granted');
      return true;
    } catch (e) {
      console.log('[WebSTT] Permission denied:', e);
      return false;
    }
  }

  start(callbacks: WebSTTCallbacks) {
    console.log('[WebSTT] start called');
    if (!this.recognition) {
      console.log('[WebSTT] No recognition object');
      callbacks.onError('Speech recognition not available');
      return;
    }

    this.callbacks = callbacks;

    this.recognition.onresult = (event: any) => {
      console.log('[WebSTT] onresult, results length:', event.results?.length);
      const results = Array.from(event.results).map((r: any) => r[0]?.transcript || '').filter(Boolean);
      const transcript = results.join(' ').trim();
      const isFinal = event.results[event.results.length - 1]?.isFinal;
      console.log('[WebSTT] transcript:', transcript, 'isFinal:', isFinal);

      if (isFinal) {
        callbacks.onFinal(transcript);
      } else if (transcript) {
        callbacks.onPartial(transcript);
      }
    };

    try {
      console.log('[WebSTT] calling recognition.start()');
      this.recognition.start();
      callbacks.onStart();
    } catch (e: any) {
      console.log('[WebSTT] start failed:', e.message);
      callbacks.onError('Failed to start: ' + e.message);
    }
  }

  stop() {
    console.log('[WebSTT] stop called');
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {
        console.log('[WebSTT] stop error:', e);
      }
    }
    this.callbacks = null;
  }
}

export default function LiveAmo({ onClose, onSendMessage, latestReply, isLoading, persona }: LiveAmoProps) {
  const [state, dispatch] = useReducer(liveSttReducer, initialState);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webSttRef = useRef<WebSpeechRecognizer | null>(null);
  const controlEpochRef = useRef(0);
  const latestReplyRef = useRef('');
  const onSendMessageRef = useRef(onSendMessage);
  const lastSoundStateRef = useRef<'on' | 'off'>('off');

  useEffect(() => {
    onSendMessageRef.current = onSendMessage;
  }, [onSendMessage]);

  const clearStartTimer = useCallback(() => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    controlEpochRef.current += 1;
    clearStartTimer();
    if (webSttRef.current) {
      webSttRef.current.stop();
    }
  }, [clearStartTimer]);

  const startListening = useCallback(() => {
    console.log('[LiveAmo] startListening called');
    const epoch = controlEpochRef.current + 1;
    controlEpochRef.current = epoch;
    dispatch({ type: 'startRequested' });

    if (!webSttRef.current?.isAvailable()) {
      dispatch({ type: 'startFailed', message: 'Speech recognition not available' });
      return;
    }

    webSttRef.current.start({
      onStart: () => dispatch({ type: 'startRequested' }),
      onListening: () => dispatch({ type: 'listening' }),
      onPartial: (text) => dispatch({ type: 'partial', text }),
      onFinal: async (text) => {
        if (!text.trim()) return;
        clearStartTimer();
        controlEpochRef.current += 1;
        dispatch({ type: 'finalCaptured', text });
        webSttRef.current?.stop();
        try {
          await onSendMessageRef.current(text);
        } finally {
          dispatch({ type: 'sendSettled' });
        }
      },
      onError: (message) => {
        if (controlEpochRef.current !== epoch) return;
        dispatch({ type: 'error', message });
      },
      onEnd: () => {
        if (controlEpochRef.current !== epoch) return;
        dispatch({ type: 'stopped' });
      },
    });
  }, [clearStartTimer]);

  useEffect(() => {
    webSttRef.current = new WebSpeechRecognizer();
    const available = webSttRef.current.isAvailable();
    console.log('[LiveAmo] STT available:', available);
    dispatch({ type: 'init', available });

    if (available) {
      webSttRef.current.requestPermission().then(granted => {
        console.log('[LiveAmo] Permission result:', granted);
      });
    }

    return () => {
      webSttRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!latestReply || latestReply === latestReplyRef.current) return;
    latestReplyRef.current = latestReply;
    dispatch({ type: 'replyReceived' });
    void speakText({ text: latestReply, personaId: persona.id });
  }, [latestReply, persona.id]);

  const shouldListen = state.isAvailable && state.autoListen && !state.pendingReply && !isLoading &&
    state.phase !== 'processing' && state.phase !== 'speaking' && state.phase !== 'unavailable' && state.phase !== 'initializing';

  useEffect(() => {
    console.log('[LiveAmo] shouldListen effect, shouldListen:', shouldListen, 'phase:', state.phase);
    if (!shouldListen) {
      clearStartTimer();
      if (state.phase === 'starting' || state.phase === 'listening') {
        stopListening();
      }
      return;
    }

    if (state.phase !== 'idle' && state.phase !== 'error') {
      console.log('[LiveAmo] not starting because phase is:', state.phase);
      return;
    }

    clearStartTimer();
    const delay = state.phase === 'error' ? getStartDelay(state.failures) : REARM_DELAY_MS;
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      startListening();
    }, delay);

    return clearStartTimer;
  }, [clearStartTimer, shouldListen, startListening, state.failures, state.phase, stopListening]);

  const pauseConversation = useCallback(() => {
    dispatch({ type: 'setAutoListen', enabled: false });
    stopListening();
  }, [stopListening]);

  const resumeConversation = useCallback(() => {
    dispatch({ type: 'setAutoListen', enabled: true });
  }, []);

  const handleClose = useCallback(() => {
    dispatch({ type: 'setAutoListen', enabled: false });
    clearStartTimer();
    stopListening();
    onClose();
  }, [clearStartTimer, onClose, stopListening]);

  const isListening = state.phase === 'listening';
  const isSpeaking = state.phase === 'speaking';
  const isAssistantActive = state.phase === 'processing' || state.pendingReply || isLoading || isSpeaking;

  const statusText = useMemo(() => {
    if (!state.isAvailable) return 'Speech recognition is not available on this device';
    switch (state.phase) {
      case 'initializing': return 'Preparing microphone...';
      case 'starting': return 'Starting microphone...';
      case 'listening': return 'Listening for your voice...';
      case 'speaking': return 'Amo is speaking...';
      case 'processing': return 'Amo is processing your kōrero...';
      case 'paused': return 'Tap the mic to resume listening';
      case 'error': return state.lastError || 'Reconnecting microphone...';
      default: return 'Tap the mic to start listening';
    }
  }, [state.isAvailable, state.lastError, state.phase]);

  useEffect(() => {
    if (state.autoListen && (state.phase === 'starting' || state.phase === 'listening')) {
      if (lastSoundStateRef.current !== 'on') {
        soundService.playMicOn();
        lastSoundStateRef.current = 'on';
      }
      return;
    }
    if (lastSoundStateRef.current !== 'off') {
      soundService.playMicOff();
      lastSoundStateRef.current = 'off';
    }
  }, [state.autoListen, state.phase]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-[#151619] flex flex-col items-center justify-center p-6 text-white overflow-y-auto"
    >
      <button
        type="button"
        onClick={handleClose}
        className="absolute top-6 right-6 z-10 p-2 hover:bg-white/10 rounded-full transition-colors"
        aria-label="Close live mode"
      >
        <X size={24} />
      </button>

      <div className="text-center space-y-8 max-w-md w-full">
        <div className="relative flex justify-center">
          <AmoAvatar
            size="xl"
            persona={persona.id as any}
            isSpeaking={isAssistantActive}
            isListening={isListening}
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Kōrero with Amo</h2>
          <p className="text-[#8E9299] font-sans uppercase tracking-widest text-xs">{statusText}</p>
        </div>

        <div className="min-h-[100px] bg-white/5 rounded-2xl p-6 border border-white/10 backdrop-blur-sm">
          <p className="text-lg italic text-white/80">
            {isLoading ? 'Amo is thinking...' : latestReply || state.transcript || state.lastTranscript || 'Kia ora. Start speaking when you are ready.'}
          </p>
        </div>

        <div className="rounded-lg bg-black/30 px-4 py-2 text-xs font-mono text-[#888]">
          <div>STT Available: <span className={state.isAvailable ? 'text-green-400' : 'text-red-400'}>{state.isAvailable ? 'YES' : 'NO'}</span></div>
          <div>Phase: {state.phase}</div>
          <div>AutoListen: {state.autoListen ? 'ON' : 'OFF'}</div>
          {state.lastError && <div className="text-red-400">Error: {state.lastError}</div>}
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={() => {
              if (state.autoListen) pauseConversation();
              else resumeConversation();
            }}
            disabled={!state.isAvailable || isLoading}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-40 ${state.autoListen ? 'bg-red-500 hover:bg-red-600' : 'bg-[#5A5A40] hover:bg-[#6A6A50]'}`}
          >
            {state.autoListen ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-[#8E9299] font-sans">
          <MessageCircleMore size={14} />
          <span>Amo drives STT and ElevenLabs TTS for Māori kōrero.</span>
        </div>
      </div>
    </motion.div>
  );
}
