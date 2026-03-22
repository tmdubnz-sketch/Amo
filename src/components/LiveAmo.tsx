import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, MessageCircleMore, X } from 'lucide-react';
import { motion } from 'motion/react';
import AmoAvatar from './AmoAvatar';
import { stopSpeaking } from '../services/ttsService';
import NativeSTT, { NativeSTTResult, NativeSTTStatus } from '../plugins/NativeSTT';

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
    voice: string;
  };
  dialect: string;
}

const POST_TTS_GUARD_MS = 180;
const REARM_DELAY_MS = 250;

export default function LiveAmo({
  onClose,
  onSendMessage,
  latestReply,
  isLoading,
  isSpeechPlaying,
  persona,
  dialect,
}: LiveAmoProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isAssistantActive, setIsAssistantActive] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [isSttAvailable, setIsSttAvailable] = useState(false);
  const sttListenerRefs = useRef<Array<{ remove: () => void }>>([]);
  const shouldAutoListenRef = useRef(true);
  const latestReplyRef = useRef('');
  const sttStatusRef = useRef<'idle' | 'starting' | 'listening'>('idle');
  const hasPendingReplyRef = useRef(false);
  const suppressAutoRearmRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRestartTimer = () => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const clearSttListeners = () => {
    sttListenerRefs.current.forEach((listener) => listener.remove());
    sttListenerRefs.current = [];
  };

  const ensureMicrophoneAccess = async () => {
    try {
      const permResult = await NativeSTT.requestPermissions();
      return permResult.microphone === 'granted';
    } catch (error) {
      console.error('Microphone permission error:', error);
      return false;
    }
  };

  const shouldArmRecognizer = () => (
    shouldAutoListenRef.current
    && !isLoading
    && !isSpeechPlaying
    && sttStatusRef.current === 'idle'
  );

  const startMic = async () => {
    if (!shouldArmRecognizer()) {
      return;
    }

    const hasMicAccess = await ensureMicrophoneAccess();
    if (!hasMicAccess) {
      setIsConnected(false);
      return;
    }

    try {
      sttStatusRef.current = 'starting';
      setIsAssistantActive(false);

      clearSttListeners();

      const partialResultsListener = await NativeSTT.addListener('partialResults', async (result: NativeSTTResult) => {
        const combinedText = result.matches.join(' ').trim();
        setTranscription(combinedText);
      });

      const finalResultsListener = await NativeSTT.addListener('finalResults', async (result: NativeSTTResult) => {
        const combinedText = result.matches.join(' ').trim();
        setTranscription('');

        if (!combinedText) {
          return;
        }

        clearRestartTimer();
        suppressAutoRearmRef.current = true;
        await NativeSTT.stop().catch(() => undefined);
        sttStatusRef.current = 'idle';
        setIsListening(false);
        setIsAssistantActive(true);

        try {
          await onSendMessage(combinedText);
        } finally {
          suppressAutoRearmRef.current = false;
        }
      });

      const statusListener = await NativeSTT.addListener('sttStatus', (status: NativeSTTStatus) => {
        if (status.status === 'listening') {
          sttStatusRef.current = 'listening';
          setIsConnected(true);
          setIsListening(true);
          return;
        }

        sttStatusRef.current = 'idle';
        setIsListening(false);

        if (status.status === 'error') {
          console.warn('STT status error:', status.message);
        }

        if (
          shouldAutoListenRef.current
          && !suppressAutoRearmRef.current
          && !isLoading
          && !isSpeechPlaying
          && !hasPendingReplyRef.current
        ) {
          clearRestartTimer();
          restartTimerRef.current = setTimeout(() => {
            restartTimerRef.current = null;
            void startMic();
          }, REARM_DELAY_MS);
        }
      });

      sttListenerRefs.current = [partialResultsListener, finalResultsListener, statusListener];

      await NativeSTT.start({
        language: 'en-NZ',
        continuous: false,
        partialResults: true,
        completeSilenceMillis: 450,
        possibleCompleteSilenceMillis: 250,
        minimumSpeechMillis: 120,
      });
    } catch (error) {
      sttStatusRef.current = 'idle';
      console.error('Speech recognition start error:', error);
    }
  };

  const scheduleAutoListen = (delayMs = 0) => {
    clearRestartTimer();

    if (!shouldAutoListenRef.current || suppressAutoRearmRef.current || isLoading || isSpeechPlaying) {
      return;
    }

    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      void startMic();
    }, delayMs);
  };

  const stopMic = async () => {
    clearRestartTimer();
    clearSttListeners();

    try {
      await NativeSTT.stop();
    } catch (error) {
      console.error('Error stopping STT:', error);
    }

    sttStatusRef.current = 'idle';
    setIsListening(false);
    setTranscription('');
  };

  const pauseConversation = () => {
    shouldAutoListenRef.current = false;
    void stopMic();
    setIsAssistantActive(false);
  };

  const resumeConversation = async () => {
    shouldAutoListenRef.current = true;
    suppressAutoRearmRef.current = false;
    scheduleAutoListen(POST_TTS_GUARD_MS);
  };

  const handleClose = () => {
    shouldAutoListenRef.current = false;
    clearRestartTimer();
    void stopMic();
    void stopSpeaking();
    onClose();
  };

  useEffect(() => {
    let isMounted = true;

    const initSTT = async () => {
      try {
        const result = await NativeSTT.initialize();
        if (isMounted) {
          setIsSttAvailable(result.available);
          setIsConnected(result.available);

          if (result.available) {
            shouldAutoListenRef.current = true;
            suppressAutoRearmRef.current = false;
            scheduleAutoListen(POST_TTS_GUARD_MS);
          }
        }
      } catch (error) {
        console.error('Failed to initialize STT:', error);
        if (isMounted) {
          setIsSttAvailable(false);
          setIsConnected(false);
        }
      }
    };

    void initSTT();

    return () => {
      isMounted = false;
      shouldAutoListenRef.current = false;
      clearRestartTimer();
      void stopMic();
    };
  }, []);

  useEffect(() => {
    if (isSpeechPlaying) {
      void stopMic();
      setIsAssistantActive(true);
    }
  }, [isSpeechPlaying]);

  useEffect(() => {
    if (isLoading) {
      setIsAssistantActive(true);
      return;
    }

    if (!latestReply || latestReply === latestReplyRef.current) {
      return;
    }

    latestReplyRef.current = latestReply;
    hasPendingReplyRef.current = true;
    setIsAssistantActive(true);
  }, [isLoading, latestReply]);

  useEffect(() => {
    if (isLoading || isSpeechPlaying) {
      setIsAssistantActive(true);
      return;
    }

    if (!hasPendingReplyRef.current) {
      return;
    }

    hasPendingReplyRef.current = false;
    setIsAssistantActive(false);
    scheduleAutoListen(POST_TTS_GUARD_MS);
  }, [isLoading, isSpeechPlaying]);

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
            isSpeaking={isAssistantActive || isSpeechPlaying}
            isListening={isListening}
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Korero with Amo</h2>
          <p className="text-[#8E9299] font-sans uppercase tracking-widest text-xs">
            {!isSttAvailable
              ? 'Speech recognition is not available on this device'
              : isConnected
                ? (isListening ? 'Voice activated and listening now' : 'Waiting for your voice')
                : 'Initializing speech recognition...'}
          </p>
        </div>

        <div className="min-h-[100px] bg-white/5 rounded-2xl p-6 border border-white/10 backdrop-blur-sm">
          <p className="text-lg italic text-white/80">
            {isLoading
              ? 'Amo is thinking...'
              : latestReply || transcription || 'Kia ora. Start speaking when you are ready.'}
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={() => {
              void (isListening ? pauseConversation() : resumeConversation());
            }}
            disabled={!isConnected || isLoading}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-40 ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-[#5A5A40] hover:bg-[#6A6A50]'}`}
          >
            {isListening ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 text-xs text-[#8E9299] font-sans">
          <MessageCircleMore size={14} />
          <span>Amo arms the mic when idle, stops during replies, then re-arms after a short guard.</span>
        </div>
      </div>
    </motion.div>
  );
}
