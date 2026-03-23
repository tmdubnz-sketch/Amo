/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Volume2, 
  VolumeX, 
  MessageSquare, 
  User,
  Sparkles,
  SlidersHorizontal,
  AudioLines,
  Menu,
  Plus,
  Trash2,
  Moon,
  Sun,
  X,
  Share2,
  Check,
  Bell,
  BellOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import LiveAmo from './components/LiveAmo';
import AmoAvatar from './components/AmoAvatar';
import { soundService } from './services/soundService';
import { generateFact, sendChatMessage } from './services/apiClient';
import { clearStoredApiKey, getStoredApiKey, setStoredApiKey } from './services/apiKeyStorage';
import { speakText } from './services/ttsService';

// Types
interface Message {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string | Date;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  personaId: string;
  dialectId: string;
  lastUpdated: string | Date;
}

interface Fact {
  title: string;
  content: string;
  category: 'Culture' | 'History' | 'Language' | 'Māori Proverbs (Whakataukī)' | 'Māori Art & Design' | 'Māori Landmarks' | 'Māori Mythology (Pūrākau)';
}

interface Persona {
  id: 'amo' | 'keri';
  name: string;
  gender: 'male' | 'female';
  voice?: string;
  description: string;
}

const PERSONAS: Persona[] = [
  { 
    id: 'amo', 
    name: 'Amo', 
    gender: 'male', 
    voice: 'bm_lewis',
    description: 'A friendly and wise male chatbot from Aotearoa with a deep, husky voice.' 
  },
  { 
    id: 'keri', 
    name: 'Keri', 
    gender: 'female', 
    voice: 'bf_emma',
    description: 'A warm and knowledgeable female chatbot from Aotearoa.' 
  },
];

const DIALECTS = [
  { id: 'standard', name: 'General / Standard' },
  { id: 'ngapuhi', name: 'Ngāpuhi (Northland)' },
  { id: 'tainui', name: 'Tainui (Waikato)' },
  { id: 'ngatiporou', name: 'Ngāti Porou (East Coast)' },
  { id: 'ngaitahu', name: 'Ngāi Tahu (South Island)' },
  { id: 'tearawa', name: 'Te Arawa (Bay of Plenty)' },
];

const getSystemInstruction = (persona: Persona, dialect: string) => `You are ${persona.name}, a friendly and grounded ${persona.gender} chatbot from Aotearoa (New Zealand).
You should sound like a real person from Aotearoa, not like someone performing an accent. Use natural New Zealand English with occasional, appropriate Te Reo Maori where it fits naturally.
Always use correct macrons for Maori words when you know them. Do not invent Maori phrasing, forced slang, or exaggerated cultural references.

STYLE RULES:
- Keep the tone warm, respectful, calm, and conversational.
- Prefer plain, natural wording over stylised or theatrical wording.
- Use Te Reo Maori sparingly and correctly. If a Maori phrase is uncertain, use English instead.
- Do not use slang or accent-performance phrases such as "bro", "cuz", "g'day", "sweet as", "choice", or "hard out".
- Do not write out pronunciation guides, accent cues, or phonetic spellings in normal conversation.
- Do not claim iwi-specific language knowledge unless you are confident.

DIALECT GUIDANCE:
The selected dialect is ${dialect}. Treat that as light cultural and vocabulary guidance only. Do not imitate or exaggerate an accent. If unsure, stay neutral and respectful.

You are knowledgeable about Maori culture, history, and the natural world, but you should be careful, accurate, and humble. If you are unsure, say so plainly.`;

export default function App() {
  const [selectedPersona, setSelectedPersona] = useState<Persona>(PERSONAS[0]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [selectedDialect, setSelectedDialect] = useState(DIALECTS[0]);
  const [currentFact, setCurrentFact] = useState<Fact | null>(null);
  const [isFactLoading, setIsFactLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSoundEnabled, setIsSoundEnabled] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storedApiKey, setStoredApiKeyState] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState('');
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestModelReply = [...messages].reverse().find((message) => message.role === 'model')?.text || '';
  const activeApiKey = storedApiKey || undefined;
  const canUseAi = Boolean(storedApiKey);

  const openMistralKeyPage = async () => {
    const url = 'https://console.mistral.ai/api-keys/';

    try {
      if (Capacitor.isNativePlatform()) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url });
        return;
      }
    } catch (error) {
      console.error('Error opening Mistral API key page:', error);
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Load theme and sessions on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('amo-theme') as 'light' | 'dark';
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.toggle('dark', savedTheme === 'dark');
    }

    const savedSessions = localStorage.getItem('amo-sessions');
    if (savedSessions) {
      try {
        const parsedSessions = JSON.parse(savedSessions);
        setSessions(parsedSessions);
        if (parsedSessions.length > 0) {
          loadSession(parsedSessions[0].id, parsedSessions);
        } else {
          createNewSession();
        }
      } catch (error) {
        console.error('Error parsing saved sessions:', error);
        localStorage.removeItem('amo-sessions');
        createNewSession();
      }
    } else {
      createNewSession();
    }

    const savedVoiceEnabled = localStorage.getItem('amo-voice-enabled');
    if (savedVoiceEnabled !== null) {
      setIsVoiceEnabled(savedVoiceEnabled === 'true');
    }

    void (async () => {
      const savedApiKey = await getStoredApiKey();
      setStoredApiKeyState(savedApiKey);
      setApiKeyInput(savedApiKey);
    })();
  }, []);

  // Save sessions whenever they change
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem('amo-sessions', JSON.stringify(sessions));
    }
  }, [sessions]);

  useEffect(() => {
    localStorage.setItem('amo-voice-enabled', String(isVoiceEnabled));
  }, [isVoiceEnabled]);

  // Update current session messages
  useEffect(() => {
    if (currentSessionId) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, messages, lastUpdated: new Date().toISOString() } 
          : s
      ));
    }
  }, [currentSessionId, messages]);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('amo-theme', newTheme);
    document.documentElement.classList.toggle('dark', newTheme === 'dark');
    if (isSoundEnabled) soundService.playToggle();
  };

  const createNewSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [
        {
          id: '1',
          role: 'model',
          text: `Kia ora! I'm ${selectedPersona.name}. How's it going today, whānau? What's on your mind?`,
          timestamp: new Date().toISOString(),
        }
      ],
      personaId: selectedPersona.id,
      dialectId: selectedDialect.id,
      lastUpdated: new Date().toISOString(),
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setMessages(newSession.messages);
    setIsSidebarOpen(false);
  };

  const loadSession = (id: string, sessionsList = sessions) => {
    const session = sessionsList.find(s => s.id === id);
    if (session) {
      setCurrentSessionId(id);
      setMessages(session.messages);
      const persona = PERSONAS.find(p => p.id === session.personaId) || PERSONAS[0];
      const dialect = DIALECTS.find(d => d.id === session.dialectId) || DIALECTS[0];
      setSelectedPersona(persona);
      setSelectedDialect(dialect);
      setIsSidebarOpen(false);
    }
  };

  const deleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSessions = sessions.filter(s => s.id !== id);
    setSessions(newSessions);
    if (currentSessionId === id) {
      if (newSessions.length > 0) {
        loadSession(newSessions[0].id, newSessions);
      } else {
        createNewSession();
      }
    }
  };

  const shareMessage = async (text: string, id: string) => {
    const shareData = {
      title: `Message from ${selectedPersona.name}`,
      text: text,
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          copyToClipboard(text, id);
        }
      }
    } else {
      copyToClipboard(text, id);
    }
  };

  const shareConversation = async () => {
    const conversationText = messages
      .map(m => `${m.role === 'user' ? 'Me' : selectedPersona.name}: ${m.text}`)
      .join('\n\n');
    
    const shareData = {
      title: `Conversation with ${selectedPersona.name}`,
      text: conversationText,
    };

    if (navigator.share && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          copyToClipboard(conversationText, 'conversation');
        }
      }
    } else {
      copyToClipboard(conversationText, 'conversation');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchFact = async () => {
    if (!canUseAi) {
      setCurrentFact(null);
      return;
    }

    setIsFactLoading(true);
    try {
      const response = await generateFact(activeApiKey, selectedDialect.name);
      setCurrentFact(response.fact as Fact);
    } catch (error) {
      console.error("Error fetching fact:", error);
    } finally {
      setIsFactLoading(false);
    }
  };

  useEffect(() => {
    void fetchFact();
  }, [canUseAi, selectedDialect.id]);

  const saveApiKey = async () => {
    const trimmedKey = apiKeyInput.trim();
    setIsSavingApiKey(true);

    try {
      if (!trimmedKey) {
        await clearStoredApiKey();
        setStoredApiKeyState('');
        setApiKeyStatus('Stored key removed.');
      } else {
        await setStoredApiKey(trimmedKey);
        const verifiedKey = await getStoredApiKey();

        if (verifiedKey !== trimmedKey) {
          throw new Error('Stored key verification failed.');
        }

        setStoredApiKeyState(verifiedKey);
        setApiKeyInput(verifiedKey);
        setApiKeyStatus('Mistral key saved on this device.');
      }
    } catch (error) {
      console.error('Error saving API key:', error);
      setApiKeyStatus('Could not save the API key on this device.');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const removeApiKey = async () => {
    setApiKeyInput('');
    setIsSavingApiKey(true);

    try {
      await clearStoredApiKey();
      setStoredApiKeyState('');
      setApiKeyStatus('Stored key removed.');
    } catch (error) {
      console.error('Error removing API key:', error);
      setApiKeyStatus('Could not remove the API key.');
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleSend = async (providedInput?: string) => {
    const messageText = (providedInput ?? input).trim();

    if (!messageText || isLoading) return;
    if (!canUseAi) {
      setShowSettings(true);
      setApiKeyStatus('Add a Mistral API key to start chatting.');
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: messageText,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMessage]);
    if (isSoundEnabled) soundService.playSend();
    setInput('');
    setIsLoading(true);
    setIsListening(true);

    // Update title if it's the first user message
    if (messages.length === 1) {
      setSessions(prev => prev.map(s => 
        s.id === currentSessionId 
          ? { ...s, title: messageText.slice(0, 30) + (messageText.length > 30 ? '...' : '') } 
          : s
      ));
    }

    try {
      const response = await sendChatMessage(
        activeApiKey,
        getSystemInstruction(selectedPersona, selectedDialect.name),
        messages.concat(userMessage).map((message) => ({
          role: message.role,
          text: message.text,
        })),
      );

      const modelText = response.text || "Sorry bro, I got a bit tangled up there. Can you say that again?";
      setIsListening(false);
      
      const modelMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: modelText,
        timestamp: new Date().toISOString(),
      };

      setMessages(prev => [...prev, modelMessage]);
      if (isSoundEnabled) soundService.playReceive();

      if (isVoiceEnabled) {
        speak(modelText);
      }
    } catch (error) {
      console.error("Error calling Mistral:", error);
      setIsListening(false);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: (error as Error).message || "E hoa, something went wrong with the connection. Give it another hoon in a minute.",
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const speak = async (text: string) => {
    try {
      setIsSpeaking(true);
      await speakText({
        text,
        lang: 'en-NZ',
        rate: 0.98,
        pitch: selectedPersona.gender === 'female' ? 1.02 : 0.98,
        voiceId: selectedPersona.voice,
      });
    } catch (error) {
      console.error("TTS Error:", error);
    } finally {
      setIsSpeaking(false);
    }
  };

  const toggleVoice = () => {
    setIsVoiceEnabled((current) => !current);
    if (isSoundEnabled) {
      soundService.playToggle();
    }
  };

  const testVoice = async () => {
    if (!isVoiceEnabled) {
      setIsVoiceEnabled(true);
    }

    await speak(`Kia ora, this is ${selectedPersona.name}. If you can hear me now, the voice is working properly.`);
  };

  return (
    <div className={theme === 'dark' ? 'dark' : ''}>
      <div className={`flex h-screen font-sans transition-colors duration-300 bg-[#f5f5f0] dark:bg-[#1a1a1a] text-[#1a1a1a] dark:text-white`}>
        <AnimatePresence>
        {isLiveMode && (
          <LiveAmo 
            onClose={() => setIsLiveMode(false)} 
            onSendMessage={handleSend}
            latestReply={latestModelReply}
            isLoading={isLoading}
            isSpeechPlaying={isSpeaking}
            persona={selectedPersona}
            dialect={selectedDialect.name}
          />
        )}
      </AnimatePresence>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ 
          x: isSidebarOpen ? 0 : -320,
          width: isSidebarOpen ? 320 : 0
        }}
        className={`fixed lg:static inset-y-0 left-0 z-50 bg-white dark:bg-[#1a1a1a] border-r border-[#5A5A40]/10 dark:border-white/10 flex flex-col transition-colors duration-300 overflow-hidden`}
      >
        <div className="p-4 border-b border-[#5A5A40]/10 dark:border-white/10 flex items-center justify-between">
          <h2 className="font-sans font-bold uppercase tracking-widest text-[#5A5A40] dark:text-[#A0A080] text-sm">Conversations</h2>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1 hover:bg-gray-100 dark:hover:bg-white/5 rounded">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-4">
          <button 
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-2 py-3 bg-[#5A5A40] hover:bg-[#6A6A50] text-white rounded-xl font-sans font-medium transition-all active:scale-95 shadow-sm mb-4"
          >
            <Plus size={18} />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-1">
          {sessions.map(session => (
            <div
              key={session.id}
              onClick={() => loadSession(session.id)}
              className={`group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                currentSessionId === session.id 
                  ? 'bg-[#5A5A40]/10 text-[#5A5A40] dark:bg-white/5 dark:text-white' 
                  : 'hover:bg-gray-100 dark:hover:bg-white/5 text-gray-600 dark:text-gray-400'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <MessageSquare size={16} className="shrink-0" />
                <span className="text-sm font-sans truncate">{session.title}</span>
              </div>
              <button 
                onClick={(e) => deleteSession(session.id, e)}
                className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 rounded-lg transition-all"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-[#5A5A40]/10 dark:border-white/10 space-y-2">
          <button 
            onClick={toggleTheme}
            className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-all text-sm font-sans"
          >
            <div className="flex items-center gap-3">
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
              <span>{theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
            </div>
          </button>
        </div>
      </motion.aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-white dark:bg-[#1a1a1a] border-b border-[#5A5A40]/10 dark:border-white/10 p-4 flex items-center justify-between shadow-sm sticky top-0 z-10 transition-colors duration-300">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors"
            >
              <Menu size={20} />
            </button>
            <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-inner overflow-hidden">
              <AmoAvatar size="sm" persona={selectedPersona.id} isSpeaking={isSpeaking} isListening={isListening} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{selectedPersona.name}</h1>
              <p className="text-xs text-[#5A5A40]/60 dark:text-[#A0A080]/60 uppercase tracking-widest font-sans font-semibold">Te Whānau Bot</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={shareConversation}
              className={`p-2 rounded-full transition-colors flex items-center gap-2 ${copiedId === 'conversation' ? 'bg-green-500/10 text-green-500' : 'bg-gray-100 dark:bg-white/5 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'}`}
              title="Share Conversation"
            >
              {copiedId === 'conversation' ? <Check size={20} /> : <Share2 size={20} />}
            </button>
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded-full transition-colors ${showSettings ? 'bg-[#5A5A40]/10 text-[#5A5A40] dark:bg-white/10 dark:text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'}`}
              title="Settings"
            >
              <SlidersHorizontal size={20} />
            </button>
            <button 
              type="button"
              onClick={() => setIsLiveMode(true)}
              className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-[#5A5A40] text-white rounded-full text-sm font-sans font-medium transition-all hover:bg-[#6A6A50] active:scale-95 shadow-sm"
            >
              <AudioLines size={16} className="animate-pulse" />
              <span className="hidden sm:inline">Live Mode</span>
            </button>
            <button 
              onClick={toggleVoice}
              className={`p-2 rounded-full transition-colors ${isVoiceEnabled ? 'bg-[#5A5A40]/10 text-[#5A5A40] dark:bg-white/10 dark:text-white' : 'bg-gray-100 dark:bg-white/5 text-gray-400 hover:bg-gray-200 dark:hover:bg-white/10'}`}
              title={isVoiceEnabled ? "Voice enabled" : "Voice disabled"}
            >
              {isVoiceEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          </div>
        </header>

        {/* Settings Overlay */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-white dark:bg-[#1a1a1a] border-b border-[#5A5A40]/10 dark:border-white/10 overflow-hidden transition-colors duration-300 max-h-[70vh] overflow-y-auto"
            >
              <div className="p-4 max-w-3xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-sans font-bold uppercase tracking-widest text-[#5A5A40] dark:text-[#A0A080]">Settings</h3>
                  <button onClick={() => setShowSettings(false)} className="text-xs text-[#5A5A40]/60 dark:text-[#A0A080]/60 hover:text-[#5A5A40] dark:hover:text-white">Close</button>
                </div>

                <div className="space-y-3">
                  <p className="text-xs font-sans font-semibold text-[#5A5A40]/60 dark:text-[#A0A080]/60 uppercase tracking-wider">Mistral API Key</p>
                  <div className="space-y-2">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="Paste your Mistral API key"
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-[#5A5A40]/10 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-sans text-sm dark:text-white"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveApiKey}
                        disabled={isSavingApiKey}
                        className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-sans font-medium disabled:opacity-50"
                      >
                        {isSavingApiKey ? 'Saving...' : 'Save Key'}
                      </button>
                      <button
                        onClick={() => {
                          void removeApiKey();
                        }}
                        className="px-4 py-2 bg-gray-100 dark:bg-white/5 text-[#5A5A40] dark:text-white rounded-xl text-sm font-sans"
                      >
                        Clear
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void openMistralKeyPage();
                      }}
                      className="inline-flex text-xs font-sans font-semibold text-[#5A5A40] dark:text-[#A0A080] underline underline-offset-2"
                    >
                      Create a Mistral API key
                    </button>
                    <p className="text-xs text-[#5A5A40]/60 dark:text-[#A0A080]/60">
                      {apiKeyStatus || (canUseAi ? 'Direct Mistral mode is ready.' : 'No key configured yet.')}
                    </p>
                  </div>
                </div>

                {/* Persona Selection */}
                <div className="space-y-2">
                  <p className="text-xs font-sans font-semibold text-[#5A5A40]/60 dark:text-[#A0A080]/60 uppercase tracking-wider">Select Voice / Persona</p>
                  <div className="flex gap-2">
                    {PERSONAS.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => {
                            setSelectedPersona(p);
                            // Update current session persona
                            if (currentSessionId) {
                              setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, personaId: p.id } : s));
                            }
                          }}
                          className={`flex-1 px-4 py-3 rounded-xl text-sm font-sans transition-all border flex flex-col items-center gap-2 ${
                            selectedPersona.id === p.id 
                              ? 'bg-[#5A5A40] text-white border-[#5A5A40]' 
                              : 'bg-gray-50 dark:bg-white/5 text-[#5A5A40] dark:text-[#A0A080] border-gray-200 dark:border-white/10 hover:border-[#5A5A40]/30'
                          }`}
                        >
                          <AmoAvatar size="sm" persona={p.id} />
                          <div className="flex flex-col items-center">
                            <span className="font-bold">{p.name}</span>
                            <span className="text-[10px] opacity-60">({p.gender})</span>
                          </div>
                        </button>
                    ))}
                  </div>
                </div>

                {/* Dialect Selection */}
                <div className="space-y-2">
                  <p className="text-xs font-sans font-semibold text-[#5A5A40]/60 dark:text-[#A0A080]/60 uppercase tracking-wider">Select Dialect / Iwi</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {DIALECTS.map((dialect) => (
                      <button
                        key={dialect.id}
                        onClick={() => {
                          setSelectedDialect(dialect);
                          // Update current session dialect
                          if (currentSessionId) {
                            setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, dialectId: dialect.id } : s));
                          }
                        }}
                        className={`px-3 py-2 rounded-xl text-xs font-sans transition-all border ${
                          selectedDialect.id === dialect.id 
                            ? 'bg-[#5A5A40] text-white border-[#5A5A40]' 
                            : 'bg-gray-50 dark:bg-white/5 text-[#5A5A40] dark:text-[#A0A080] border-gray-200 dark:border-white/10 hover:border-[#5A5A40]/30'
                        }`}
                      >
                        {dialect.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sound Settings */}
                <div className="space-y-2 pt-2">
                  <p className="text-xs font-sans font-semibold text-[#5A5A40]/60 dark:text-[#A0A080]/60 uppercase tracking-wider">Voice Replies</p>
                  <div className="flex gap-2">
                    <button
                      onClick={toggleVoice}
                      className={`px-4 py-2 rounded-xl text-sm font-sans transition-all border ${
                        isVoiceEnabled
                          ? 'bg-[#5A5A40] text-white border-[#5A5A40]'
                          : 'bg-gray-50 dark:bg-white/5 text-[#5A5A40] dark:text-[#A0A080] border-gray-200 dark:border-white/10'
                      }`}
                    >
                      {isVoiceEnabled ? 'Voice On' : 'Voice Off'}
                    </button>
                    <button
                      onClick={() => {
                        void testVoice();
                      }}
                      className="px-4 py-2 bg-gray-100 dark:bg-white/5 text-[#5A5A40] dark:text-white rounded-xl text-sm font-sans"
                    >
                      Test Voice
                    </button>
                  </div>
                  <p className="text-xs text-[#5A5A40]/60 dark:text-[#A0A080]/60">
                    {isVoiceEnabled ? 'Voice replies are enabled.' : 'Voice replies are off.'}
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <p className="text-xs font-sans font-semibold text-[#5A5A40]/60 dark:text-[#A0A080]/60 uppercase tracking-wider">Sound Effects</p>
                  <button 
                    onClick={() => setIsSoundEnabled(!isSoundEnabled)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl transition-all border ${
                      isSoundEnabled 
                        ? 'bg-[#5A5A40]/5 border-[#5A5A40]/20 text-[#5A5A40] dark:text-white' 
                        : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-400'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isSoundEnabled ? <Bell size={18} /> : <BellOff size={18} />}
                      <span className="text-sm font-sans">{isSoundEnabled ? 'Sound Effects On' : 'Sound Effects Off'}</span>
                    </div>
                    <div className={`w-10 h-5 rounded-full relative transition-colors ${isSoundEnabled ? 'bg-[#5A5A40]' : 'bg-gray-300 dark:bg-white/20'}`}>
                      <motion.div 
                        animate={{ x: isSoundEnabled ? 20 : 2 }}
                        className="absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm"
                      />
                    </div>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 space-y-6 max-w-3xl mx-auto w-full bg-[#f5f5f0] dark:bg-[#1a1a1a] transition-colors duration-300">
          {/* Fact Card */}
          <AnimatePresence>
            {currentFact && canUseAi && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white dark:bg-[#2a2a2a] border border-[#5A5A40]/10 dark:border-white/10 rounded-2xl p-4 shadow-sm relative overflow-hidden group transition-colors duration-300"
              >
                <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
                  <Sparkles size={48} />
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-[#5A5A40]/10 dark:bg-white/10 text-[#5A5A40] dark:text-[#A0A080] text-[10px] font-sans font-bold uppercase tracking-widest rounded-full">
                    {currentFact.category}
                  </span>
                  <h4 className="text-sm font-bold font-sans dark:text-white">{currentFact.title}</h4>
                </div>
                <p className="text-sm text-[#1a1a1a]/80 dark:text-white/80 leading-relaxed italic">
                  "{currentFact.content}"
                </p>
                <button 
                  onClick={fetchFact}
                  disabled={isFactLoading}
                  className="mt-3 text-[10px] font-sans font-bold uppercase tracking-widest text-[#5A5A40] dark:text-[#A0A080] hover:underline disabled:opacity-50"
                >
                  {isFactLoading ? 'Fetching...' : 'Next Fact →'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {messages.map((message) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-3 max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 shadow-sm overflow-hidden ${
                  message.role === 'user' ? 'bg-[#5A5A40] text-white' : 'bg-white dark:bg-[#2a2a2a] border border-[#5A5A40]/10 dark:border-white/10'
                }`}>
                  {message.role === 'user' ? <User size={16} /> : <AmoAvatar size="sm" persona={selectedPersona.id} isSpeaking={isSpeaking && messages.indexOf(message) === messages.length - 1} />}
                </div>
                <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm relative group/msg ${
                  message.role === 'user' 
                    ? 'bg-[#5A5A40] text-white rounded-tr-none' 
                    : 'bg-white dark:bg-[#2a2a2a] text-[#1a1a1a] dark:text-white border border-[#5A5A40]/10 dark:border-white/10 rounded-tl-none'
                }`}>
                  {message.text}
                  <div className={`flex items-center gap-2 mt-2 font-sans ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <span className="text-[10px] opacity-40">
                      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button 
                      onClick={() => shareMessage(message.text, message.id)}
                      className={`p-1 rounded-md transition-all opacity-0 group-hover/msg:opacity-100 ${
                        message.role === 'user' 
                          ? 'hover:bg-white/10 text-white/60' 
                          : 'hover:bg-gray-100 dark:hover:bg-white/5 text-[#5A5A40]/60 dark:text-[#A0A080]/60'
                      } ${copiedId === message.id ? 'opacity-100 text-green-500' : ''}`}
                      title="Share Message"
                    >
                      {copiedId === message.id ? <Check size={12} /> : <Share2 size={12} />}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-white dark:bg-[#2a2a2a] border border-[#5A5A40]/10 dark:border-white/10 flex items-center justify-center overflow-hidden">
                  <AmoAvatar size="sm" persona={selectedPersona.id} isSpeaking={true} />
                </div>
                <div className="p-4 bg-white dark:bg-[#2a2a2a] border border-[#5A5A40]/10 dark:border-white/10 rounded-2xl rounded-tl-none shadow-sm">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-[#5A5A40] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-1.5 h-1.5 bg-[#5A5A40] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-1.5 h-1.5 bg-[#5A5A40] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </main>

        {/* Input Area */}
        <footer className="p-4 bg-white dark:bg-[#1a1a1a] border-t border-[#5A5A40]/10 dark:border-white/10 transition-colors duration-300">
          <div className="max-w-3xl mx-auto relative">
             <input
               type="text"
               value={input}
               onChange={(e) => setInput(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && handleSend()}
               placeholder={canUseAi ? 'Pātai mai... (Ask me anything)' : 'Open settings to add a Mistral API key'}
               className="w-full px-6 py-4 bg-gray-50 dark:bg-white/5 border border-[#5A5A40]/10 dark:border-white/10 rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 font-sans text-sm pr-12 transition-all dark:text-white"
             />
              <button
                type="button"
                onClick={() => {
                  void handleSend();
                }}
                disabled={!input.trim() || isLoading || !canUseAi}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-[#5A5A40] text-white rounded-xl hover:bg-[#6A6A50] disabled:opacity-50 transition-all active:scale-95"
              >
               <Send size={18} />
            </button>
          </div>
          <p className="text-[10px] text-center mt-3 text-[#5A5A40]/40 dark:text-[#A0A080]/40 font-sans uppercase tracking-widest">
            Amo can make mistakes. Kia tūpato, whānau.
          </p>
        </footer>
      </div>
    </div>
  </div>
);
}
