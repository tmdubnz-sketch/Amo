import React, { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Mic, MicOff, MessageCircleMore, X } from 'lucide-react';
import { motion } from 'motion/react';
import AmoAvatar from './AmoAvatar';
import { soundService } from '../services/soundService';
import { stopSpeaking } from '../services/ttsService';
import NativeSTT, { NativeSTTSessionState } from '../plugins/NativeSTT';

interface LiveAmoProps {
  onClose: () => void;
  onSendMessage: (text: string) => Promise<void>;
  latestReply: string;
  isLoading: boolean;
  isSpeechPlaying: boolean;
  persona: {
    id: string;
    name: string;
    gender: string;
    voice?: string;
  };
  dialect: string;
}

type SttPhase =
  | 'initializing'
  | 'unavailable'
  | 'paused'
  | 'idle'
  | 'starting'
  | 'listening'
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
  sessionDebug: NativeSTTSessionState | null;
}

type LiveSttAction =
  | { type: 'init'; available: boolean }
  | { type: 'setAutoListen'; enabled: boolean }
  | { type: 'startRequested' }
  | { type: 'startFailed'; message: string }
  | { type: 'listening' }
  | { type: 'partial'; text: string }
  | { type: 'stopped' }
  | { type: 'error'; message: string }
  | { type: 'finalCaptured'; text: string }
  | { type: 'sendSettled' }
  | { type: 'replyReceived' }
  | { type: 'replyConsumed' }
  | { type: 'sessionDebug'; session: NativeSTTSessionState };

const POST_TTS_GUARD_MS = 60;
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
  sessionDebug: null,
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
      const nextState = {
        ...state,
        autoListen: action.enabled,
        transcript: action.enabled ? state.transcript : '',
      };

      if (state.phase === 'processing' || state.pendingReply) {
        return nextState;
      }

      return {
        ...nextState,
        phase: getRestingPhase(nextState),
      };
    }
    case 'startRequested':
      return {
        ...state,
        phase: 'starting',
        lastError: null,
      };
    case 'startFailed':
      return {
        ...state,
        phase: 'error',
        transcript: '',
        failures: state.failures + 1,
        lastError: action.message,
      };
    case 'listening':
      return {
        ...state,
        phase: 'listening',
        failures: 0,
        lastError: null,
      };
    case 'partial':
      return {
        ...state,
        transcript: action.text,
        failures: action.text ? 0 : state.failures,
      };
    case 'stopped':
      if (state.phase === 'processing') {
        return state;
      }

      return {
        ...state,
        phase: getRestingPhase(state),
        transcript: '',
      };
    case 'error':
      if (state.phase === 'processing') {
        return state;
      }

      return {
        ...state,
        phase: 'error',
        transcript: '',
        failures: state.failures + 1,
        lastError: action.message,
      };
    case 'finalCaptured':
      return {
        ...state,
        phase: 'processing',
        transcript: action.text,
        lastTranscript: action.text,
        failures: 0,
        lastError: null,
      };
    case 'sendSettled':
      return {
        ...state,
        phase: state.pendingReply ? 'processing' : getRestingPhase(state),
      };
    case 'replyReceived':
      return {
        ...state,
        pendingReply: true,
        phase: 'processing',
      };
    case 'replyConsumed': {
      const nextState = {
        ...state,
        pendingReply: false,
      };

      return {
        ...nextState,
        phase: getRestingPhase(nextState),
      };
    }
    case 'sessionDebug':
      return {
        ...state,
        sessionDebug: action.session,
      };
    default:
      return state;
  }
}

function getStartDelay(failures: number) {
  return Math.min(REARM_DELAY_MS * Math.pow(2, Math.max(0, failures - 1)), MAX_REARM_DELAY_MS);
}

export default function LiveAmo({
  onClose,
  onSendMessage,
  latestReply,
  isLoading,
  isSpeechPlaying,
  persona,
}: LiveAmoProps) {
  const [state, dispatch] = useReducer(liveSttReducer, initialState);

  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenersRef = useRef<Array<{ remove: () => void }>>([]);
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

  const clearListeners = useCallback(() => {
    listenersRef.current.forEach((listener) => listener.remove());
    listenersRef.current = [];
  }, []);

  const ensureMicrophoneAccess = useCallback(async () => {
    try {
      const permission = await NativeSTT.requestPermissions();
      return permission.microphone === 'granted';
    } catch (error) {
      console.error('[LiveAmo] Microphone permission error:', error);
      return false;
    }
  }, []);

  const stopNativeStt = useCallback(async () => {
    controlEpochRef.current += 1;
    clearStartTimer();

    try {
      await NativeSTT.stop();
    } catch (error) {
      console.error('[LiveAmo] Error stopping STT:', error);
    }
  }, [clearStartTimer]);

  const startNativeStt = useCallback(async () => {
    const epoch = controlEpochRef.current + 1;
    controlEpochRef.current = epoch;
    dispatch({ type: 'startRequested' });

    const hasMicrophoneAccess = await ensureMicrophoneAccess();
    if (controlEpochRef.current !== epoch) {
      return;
    }

    if (!hasMicrophoneAccess) {
      dispatch({ type: 'startFailed', message: 'Microphone permission denied.' });
      return;
    }

    try {
      await NativeSTT.start({
        language: 'en-NZ',
        continuous: true,
        partialResults: true,
        completeSilenceMillis: 3000,
        possibleCompleteSilenceMillis: 2000,
        minimumSpeechMillis: 500,
      });

      if (controlEpochRef.current !== epoch) {
        await NativeSTT.stop().catch(() => undefined);
      }
    } catch (error) {
      if (controlEpochRef.current !== epoch) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Failed to start speech recognition.';
      console.error('[LiveAmo] Speech recognition start error:', error);
      dispatch({ type: 'startFailed', message });
    }
  }, [ensureMicrophoneAccess]);

  useEffect(() => {
    let cancelled = false;

    const setup = async () => {
      try {
        const sessionListener = await NativeSTT.addListener('sessionState', async (session: NativeSTTSessionState) => {
          dispatch({ type: 'sessionDebug', session });
          console.info('[LiveAmo] sessionState', JSON.stringify(session));

          if (session.phase === 'starting') {
            dispatch({ type: 'startRequested' });
          }

          if (session.phase === 'listening') {
            dispatch({ type: 'listening' });
            dispatch({ type: 'partial', text: session.transcript });
          }

          if (session.phase === 'error') {
            dispatch({ type: 'error', message: session.message || 'Speech recognition error.' });
          }

          if (session.phase === 'stopped' && !session.finalTranscript) {
            dispatch({ type: 'stopped' });
          }

          const text = session.finalTranscript?.trim() || '';
          if (!text) {
            return;
          }

          console.info('[LiveAmo] final transcript', text);

          clearStartTimer();
          controlEpochRef.current += 1;
          dispatch({ type: 'finalCaptured', text });
          await NativeSTT.stop().catch(() => undefined);

          try {
            await onSendMessageRef.current(text);
          } finally {
            dispatch({ type: 'sendSettled' });
          }
        });

        if (cancelled) {
          sessionListener.remove();
          return;
        }

        listenersRef.current = [sessionListener];

        const result = await NativeSTT.initialize();
        if (!cancelled) {
          dispatch({ type: 'init', available: result.available });
        }
      } catch (error) {
        console.error('[LiveAmo] Failed to initialize STT:', error);
        if (!cancelled) {
          dispatch({ type: 'init', available: false });
        }
      }
    };

    void setup();

    return () => {
      cancelled = true;
      clearStartTimer();
      clearListeners();
      controlEpochRef.current += 1;
      void NativeSTT.stop().catch(() => undefined);
    };
  }, [clearListeners, clearStartTimer]);

  useEffect(() => {
    if (!latestReply || latestReply === latestReplyRef.current) {
      return;
    }

    latestReplyRef.current = latestReply;
    dispatch({ type: 'replyReceived' });
  }, [latestReply]);

  useEffect(() => {
    if (!state.pendingReply || isLoading || isSpeechPlaying) {
      return;
    }

    const timer = setTimeout(() => {
      dispatch({ type: 'replyConsumed' });
    }, POST_TTS_GUARD_MS);

    return () => clearTimeout(timer);
  }, [isLoading, isSpeechPlaying, state.pendingReply]);

  const shouldListen =
    state.isAvailable &&
    state.autoListen &&
    !state.pendingReply &&
    !isLoading &&
    !isSpeechPlaying &&
    state.phase !== 'processing' &&
    state.phase !== 'unavailable' &&
    state.phase !== 'initializing';

  useEffect(() => {
    if (!shouldListen) {
      clearStartTimer();

      if (state.phase === 'starting' || state.phase === 'listening') {
        void stopNativeStt();
      }
      return;
    }

    if (state.phase !== 'idle' && state.phase !== 'error') {
      return;
    }

    clearStartTimer();
    const delay = state.phase === 'error' ? getStartDelay(state.failures) : REARM_DELAY_MS;
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      void startNativeStt();
    }, delay);

    return clearStartTimer;
  }, [clearStartTimer, shouldListen, startNativeStt, state.failures, state.phase, stopNativeStt]);

  const pauseConversation = useCallback(() => {
    dispatch({ type: 'setAutoListen', enabled: false });
    void stopNativeStt();
  }, [stopNativeStt]);

  const resumeConversation = useCallback(() => {
    dispatch({ type: 'setAutoListen', enabled: true });
  }, []);

  const handleClose = useCallback(() => {
    dispatch({ type: 'setAutoListen', enabled: false });
    clearStartTimer();
    void stopNativeStt();
    void stopSpeaking();
    onClose();
  }, [clearStartTimer, onClose, stopNativeStt]);

  const isListening = state.phase === 'listening';
  const isAssistantActive = state.phase === 'processing' || state.pendingReply || isLoading || isSpeechPlaying;

  const statusText = useMemo(() => {
    if (!state.isAvailable) {
      return 'Speech recognition is not available on this device';
    }

    switch (state.phase) {
      case 'initializing':
        return 'Preparing microphone...';
      case 'starting':
        return 'Starting microphone...';
      case 'listening':
        return 'Listening for your voice...';
      case 'processing':
        return 'Amo is processing your korero...';
      case 'paused':
        return 'Tap the mic to resume listening';
      case 'error':
        return state.lastError || 'Reconnecting microphone...';
      default:
        return 'Tap the mic to start listening';
    }
  }, [state.isAvailable, state.lastError, state.phase]);

  const debugText = useMemo(() => {
    if (!state.sessionDebug) {
      return 'waiting for session';
    }

    const parts = [
      `phase:${state.sessionDebug.phase}`,
      `vad:${state.sessionDebug.vadActive ? 'on' : 'off'}`,
      `recording:${state.sessionDebug.recording ? 'yes' : 'no'}`,
      `transcribing:${state.sessionDebug.transcribing ? 'yes' : 'no'}`,
      `speech:${state.sessionDebug.speechDetected ? 'yes' : 'no'}`,
      `level:${state.sessionDebug.level ?? 0}`,
      `floor:${state.sessionDebug.noiseFloor ?? 0}`,
      `gate:${state.sessionDebug.threshold ?? 0}`,
      `backend:${state.sessionDebug.backend || 'unknown'}`,
    ];

    if (state.sessionDebug.message) {
      parts.push(`error:${state.sessionDebug.message}`);
    }

    return parts.join('  ');
  }, [state.sessionDebug]);

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
          <h2 className="text-3xl font-bold tracking-tight">Korero with Amo</h2>
          <p className="text-[#8E9299] font-sans uppercase tracking-widest text-xs">
            {statusText}
          </p>
        </div>

        <div className="min-h-[100px] bg-white/5 rounded-2xl p-6 border border-white/10 backdrop-blur-sm">
          <p className="text-lg italic text-white/80">
            {isLoading
              ? 'Amo is thinking...'
              : latestReply || state.transcript || state.lastTranscript || 'Kia ora. Start speaking when you are ready.'}
          </p>
        </div>

        <div className="rounded-2xl border border-[#8d7748]/30 bg-[#1d1a14]/70 px-4 py-3 text-left font-mono text-[11px] text-[#d6c39a]">
          {debugText}
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={() => {
              if (state.autoListen) {
                pauseConversation();
              } else {
                resumeConversation();
              }
            }}
            disabled={!state.isAvailable || isLoading}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-40 ${state.autoListen ? 'bg-red-500 hover:bg-red-600' : 'bg-[#5A5A40] hover:bg-[#6A6A50]'}`}
          >
            {state.autoListen ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-[#8E9299] font-sans">
          <MessageCircleMore size={14} />
          <span>Amo now drives STT from one controller state and only re-arms the mic when that state says it should.</span>
        </div>
      </div>
    </motion.div>
  );
}
