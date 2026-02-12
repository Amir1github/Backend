
import React, { useState, useRef, useEffect } from 'react';
import { Assistant, ChatMessage } from '../types';
import { testAssistant, getSystemInstruction } from '../services/geminiService';
import { getTranslation } from '../translations';
import { GoogleGenAI, Modality } from '@google/genai';

export const ChatInterface: React.FC<{ assistant: Assistant; language: string }> = ({ assistant, language }) => {
  const t = getTranslation(language);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const currentSources = useRef<Set<AudioBufferSourceNode>>(new Set());

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, isVoiceMode]);

  const decodeAudio = (base64: string) => {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    } catch (e) {
      console.error("Base64 decoding failed", e);
      return null;
    }
  };

  const startVoiceMode = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) return;
    
    setIsVoiceMode(true);
    setError(null);
    
    try {
      const ai = new GoogleGenAI({ apiKey });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (mediaErr: any) {
        setIsVoiceMode(false);
        if (mediaErr.name === 'NotAllowedError') {
          setError(t.voiceErrors.micDenied);
        } else if (mediaErr.name === 'NotFoundError') {
          setError(t.voiceErrors.micNotFound);
        } else if (mediaErr.name === 'NotReadableError') {
          setError(t.voiceErrors.micInUse);
        } else {
          setError(t.voiceErrors.generic);
        }
        return;
      }
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcm = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) pcm[i] = inputData[i] * 32768;
              const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm.buffer)));
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message) => {
            try {
              const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
              if (audioData) {
                const bytes = decodeAudio(audioData);
                if (!bytes) throw new Error("Audio decode error");
                
                const dataInt16 = new Int16Array(bytes.buffer);
                const buffer = outputCtx.createBuffer(1, dataInt16.length, 24000);
                const channelData = buffer.getChannelData(0);
                for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
                
                const source = outputCtx.createBufferSource();
                source.buffer = buffer;
                source.connect(outputCtx.destination);
                source.onended = () => currentSources.current.delete(source);
                currentSources.current.add(source);
                source.start();
              }
            } catch (audioErr) {
              console.error("Audio processing error", audioErr);
              setError(t.voiceErrors.audioError);
            }

            if (message.serverContent?.interrupted) {
              currentSources.current.forEach(s => s.stop());
              currentSources.current.clear();
            }

            if (message.serverContent?.inputTranscription?.text) {
              const text = message.serverContent.inputTranscription.text;
              setMessages(prev => [...prev, { role: 'user', content: text, timestamp: Date.now() }]);
            }
            if (message.serverContent?.outputTranscription?.text) {
              const text = message.serverContent.outputTranscription.text;
              setMessages(prev => [...prev, { role: 'assistant', content: text, timestamp: Date.now() }]);
            }
          },
          onerror: (e) => {
            console.error("Live Error", e);
            setError(t.voiceErrors.connectionFailed);
            setIsVoiceMode(false);
          },
          onclose: () => setIsVoiceMode(false)
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          systemInstruction: getSystemInstruction(assistant, messages.length > 0)
        }
      });
      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setIsVoiceMode(false);
      setError(t.voiceErrors.generic);
    }
  };

  const stopVoiceMode = () => {
    if (sessionRef.current) {
      try {
        sessionRef.current.close();
      } catch (e) {
        console.warn("Session close failed", e);
      }
    }
    currentSources.current.forEach(s => s.stop());
    currentSources.current.clear();
    setIsVoiceMode(false);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedInput = input.trim();
    if (!trimmedInput || isTyping) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmedInput, timestamp: Date.now() };
    setInput('');
    setIsTyping(true);
    setError(null);
    
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);

    try {
      const response = await testAssistant(assistant, newHistory);
      const assistantMsg: ChatMessage = { role: 'assistant', content: response, timestamp: Date.now() };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      setError("Ошибка связи.");
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-[600px] bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden relative">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between glass-effect sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white font-bold text-sm">
            {assistant.name.charAt(0)}
          </div>
          <div>
            <h4 className="text-sm font-semibold text-slate-900 leading-none">{assistant.name}</h4>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`w-1.5 h-1.5 ${isVoiceMode ? 'bg-red-500 animate-pulse' : 'bg-green-500'} rounded-full`}></span>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                {isVoiceMode ? 'Live Dialogue' : 'Standard Mode'}
              </span>
            </div>
          </div>
        </div>
        
        <button 
          onClick={isVoiceMode ? stopVoiceMode : startVoiceMode}
          className={`p-2 rounded-lg transition-all ${isVoiceMode ? 'bg-red-600 text-white shadow-lg' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {isVoiceMode ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            )}
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-[#FBFDFF] custom-scrollbar">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 animate-fadeIn">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1">
              <p className="text-xs font-bold text-red-800 mb-1">Ошибка</p>
              <p className="text-[11px] text-red-600 font-medium leading-relaxed">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {isVoiceMode && (
          <div className="sticky top-0 z-10 flex flex-col items-center py-10 mb-4 bg-white/95 backdrop-blur-sm rounded-2xl border border-slate-100 shadow-sm">
             <div className="relative w-20 h-20">
                <div className="absolute inset-0 bg-red-500/20 rounded-full animate-ping"></div>
                <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center shadow-xl">
                   <div className="flex gap-1 items-end h-6">
                      <div className="w-1.5 bg-red-500 rounded-full animate-[voice-1_1.2s_infinite]"></div>
                      <div className="w-1.5 bg-red-400 rounded-full animate-[voice-2_0.8s_infinite]"></div>
                      <div className="w-1.5 bg-red-500 rounded-full animate-[voice-3_1s_infinite]"></div>
                   </div>
                </div>
             </div>
             <p className="mt-4 text-[10px] font-black text-red-600 uppercase tracking-widest">Live Voice Active</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
            <div className={`max-w-[85%] px-4 py-2.5 rounded-lg text-sm shadow-sm ${
              msg.role === 'user' ? 'bg-slate-900 text-white rounded-tr-none' : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
            }`}>
              <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 flex space-x-1 items-center">
              <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce"></div>
              <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
              <div className="w-1 h-1 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
            </div>
          </div>
        )}
      </div>

      {!isVoiceMode && (
        <form onSubmit={handleSend} className="p-4 border-t border-slate-100 bg-white flex items-center gap-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Напишите что-нибудь..."
            disabled={isTyping}
            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
          <button type="submit" disabled={!input.trim() || isTyping} className="bg-slate-900 text-white p-2.5 rounded-lg hover:bg-black transition-all">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </form>
      )}

      <style>{`
        @keyframes voice-1 { 0%, 100% { height: 8px; } 50% { height: 24px; } }
        @keyframes voice-2 { 0%, 100% { height: 12px; } 50% { height: 18px; } }
        @keyframes voice-3 { 0%, 100% { height: 6px; } 50% { height: 20px; } }
      `}</style>
    </div>
  );
};
