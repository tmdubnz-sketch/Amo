import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import { motion } from 'motion/react';
import AmoAvatar from './AmoAvatar';
import { stopSpeaking } from '../services/ttsService';

interface LiveAmoProps {
  onClose: () => void;
  onSendMessage: (text: string) => Promise<void>;
  latestReply: string;
  isLoading: boolean;
  persona: {
    id: string;
    name: string;
    gender: string;
    voice: string;
  };
  dialect: string;
}

export default function LiveAmo({ onClose, onSendMessage, latestReply, isLoading, persona, dialect }: LiveAmoProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [transcription, setTranscription] = useState('');
  const recognitionRef = useRef<any>(null);
  const recognitionStateRef = useRef<'idle' | 'starting' | 'listening'>('idle');

  const ensureMicrophoneAccess = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      return true;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      console.error('Microphone permission error:', error);
      return false;
    }
  };

  const startMic = async () => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      setIsConnected(false);
      return;
    }

    if (recognitionStateRef.current !== 'idle') {
      return;
    }

    const hasMicAccess = await ensureMicrophoneAccess();
    if (!hasMicAccess) {
      setIsConnected(false);
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-NZ';
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onstart = () => {
        recognitionStateRef.current = 'listening';
        setIsConnected(true);
        setIsListening(true);
      };

      recognition.onresult = async (event: any) => {
        const combinedText = Array.from(event.results)
          .map((result: any) => result[0]?.transcript || '')
          .join(' ')
          .trim();

        setTranscription(combinedText);

        const lastResult = event.results[event.results.length - 1];
        if (lastResult?.isFinal && combinedText) {
          setIsSpeaking(true);
          await onSendMessage(combinedText);
          setIsSpeaking(false);
        }
      };

      recognition.onerror = () => {
        recognitionStateRef.current = 'idle';
        setIsListening(false);
      };

      recognition.onend = () => {
        recognitionStateRef.current = 'idle';
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    try {
      recognitionStateRef.current = 'starting';
      recognitionRef.current.start();
    } catch (error) {
      recognitionStateRef.current = 'idle';
      console.error('Speech recognition start error:', error);
    }
  };

  const stopMic = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    recognitionStateRef.current = 'idle';
    setIsListening(false);
  };

  const handleClose = () => {
    stopMic();
    void stopSpeaking();
    onClose();
  };

  useEffect(() => {
    const SpeechRecognitionCtor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setIsConnected(Boolean(SpeechRecognitionCtor));
    return () => {
      stopMic();
    };
  }, []);

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
            isSpeaking={isSpeaking} 
            isListening={isListening} 
          />
        </div>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Kōrero with Amo</h2>
          <p className="text-[#8E9299] font-sans uppercase tracking-widest text-xs">
            {isConnected ? 'Tap the mic and speak naturally' : 'Speech recognition is not available on this device'}
          </p>
        </div>

        <div className="min-h-[100px] bg-white/5 rounded-2xl p-6 border border-white/10 backdrop-blur-sm">
          <p className="text-lg italic text-white/80">
            {isLoading
              ? 'Amo is thinking...'
              : latestReply || transcription || "Kia ora! Just say something, I'm all ears bro."}
          </p>
        </div>

        <div className="flex justify-center gap-4">
          <button 
            onClick={() => isListening ? stopMic() : startMic()}
            disabled={!isConnected || isLoading}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all disabled:opacity-40 ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-[#5A5A40] hover:bg-[#6A6A50]'}`}
          >
            {isListening ? <MicOff size={24} /> : <Mic size={24} />}
          </button>
        </div>

        <p className="text-xs text-[#8E9299] font-sans">
          Speak naturally. Amo will transcribe your voice, send it to Mistral, and reply out loud if voice is enabled.
        </p>
      </div>
    </motion.div>
  );
}
