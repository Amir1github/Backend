
import React, { useState, useEffect, useRef } from 'react';
import { Assistant, AssistantType, CatalogItem } from '../types';
import { getTranslation } from '../translations';
import { crawlWebsiteWithGemini, runBuilderInterview, synthesizeAssistant } from '../services/geminiService';

interface BuilderProps {
  onComplete: (assistant: Assistant) => void;
  initialData?: Partial<Assistant> | null;
  language?: string;
}

export const AssistantBuilder: React.FC<BuilderProps> = ({ onComplete, initialData, language = 'ru' }) => {
  const t = getTranslation(language);
  const bs = t.builderSteps;
  const [step, setStep] = useState(0); 
  const [builderMode, setBuilderMode] = useState<'manual' | 'ai' | null>(null);
  
  // AI Interview State
  const [interviewHistory, setInterviewHistory] = useState<{role: 'user' | 'model', content: string}[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [interviewError, setInterviewError] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const [knowledgeMode, setKnowledgeMode] = useState<'manual' | 'website'>('manual');
  const [siteUrl, setSiteUrl] = useState('');
  const [isCrawling, setIsCrawling] = useState(false);
  
  const [formData, setFormData] = useState<Partial<Assistant>>({
    name: '',
    type: AssistantType.PERSONAL,
    role: '',
    goals: '',
    personality: '',
    knowledgeBase: [],
    catalog: [],
    scenarios: '',
    integrations: [],
    status: 'draft',
    createdAt: Date.now()
  });

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({ ...prev, ...initialData }));
      setBuilderMode('manual');
      setStep(10);
    }
  }, [initialData]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTo({
        top: chatScrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [interviewHistory, isAiThinking]);

  const isPersonal = formData.type === AssistantType.PERSONAL;
  const totalSteps = isPersonal ? 10 : 11;
  const currentDisplayStep = isPersonal && step >= 8 ? step - 1 : step;

  const nextStep = () => {
    if (step === 6 && isPersonal) setStep(8);
    else setStep(prev => Math.min(prev + 1, 11));
  };

  const prevStep = () => {
    if (step === 8 && isPersonal) setStep(6);
    else setStep(prev => Math.max(prev - 1, 0));
  };

  const handleUpdate = (field: keyof Assistant, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const startAiInterview = async () => {
    if (!formData.name || !formData.role) return;
    setStep(100);
    setIsAiThinking(true);
    setInterviewError(null);
    try {
      const firstQuestion = await runBuilderInterview([], formData.name!, formData.role!);
      setInterviewHistory([{ role: 'model', content: firstQuestion }]);
    } catch (e) {
      console.error(e);
      setInterviewError("Не удалось связаться с AI-Архитектором. Пожалуйста, проверьте API ключ или соединение.");
    } finally {
      setIsAiThinking(false);
    }
  };

  const finalizeAssistant = async (history: {role: 'user' | 'model', content: string}[]) => {
    setIsSynthesizing(true);
    try {
      const result = await synthesizeAssistant(history, formData.name!, formData.role!);
      setFormData(prev => ({
        ...prev,
        goals: result.goals,
        personality: result.personality,
        knowledgeBase: result.knowledgeBase,
        scenarios: result.scenarios
      }));
      setStep(10);
    } catch (e) {
      console.error(e);
      setInterviewError("Ошибка при финальной сборке. Попробуйте еще раз.");
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleAiSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!aiInput.trim() || isAiThinking) return;

    const userMessage = aiInput;
    setAiInput('');
    const newHistory = [...interviewHistory, { role: 'user', content: userMessage } as const];
    setInterviewHistory(newHistory);
    setIsAiThinking(true);
    setInterviewError(null);

    try {
      const aiResponse = await runBuilderInterview(newHistory, formData.name!, formData.role!);
      
      if (aiResponse.toUpperCase().includes("CONSTRUCT_READY")) {
        await finalizeAssistant(newHistory);
      } else {
        setInterviewHistory([...newHistory, { role: 'model', content: aiResponse }]);
      }
    } catch (e) {
      console.error(e);
      setInterviewError("Произошла ошибка во время интервью. Попробуйте отправить сообщение снова.");
    } finally {
      setIsAiThinking(false);
    }
  };

  const renderStep = () => {
    const businessRoles = [
      'support', 'sales', 'advisor', 'expert', 'online_consultant', 
      'faq_assistant', 'site_navigator', 'lead_assistant', 
      'tech_support_basic', 'feedback_assistant', 'onboarding_assistant'
    ];
    
    const personalRoles = [
      'personal_assistant', 'tutor', 'search_assistant', 'organizer', 
      'habit_coach', 'fitness_assistant', 'language_buddy', 
      'creative_buddy', 'design_assistant', 'coder_helper', 
      'tech_assistant_personal'
    ];

    if (step === 0) {
      return (
        <div className="space-y-6 animate-fadeIn">
          <div className="text-center mb-10">
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.mode_title}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button 
              onClick={() => { setBuilderMode('manual'); setStep(1); }}
              className="p-10 border-2 border-slate-100 rounded-[3rem] text-left hover:border-indigo-600 hover:bg-indigo-50 transition-all group flex flex-col"
            >
              <span className="text-5xl mb-6">🛠️</span>
              <h4 className="text-xl font-black mb-2">{bs.mode_manual}</h4>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">{bs.mode_manual_desc}</p>
            </button>
            <button 
              onClick={() => { setBuilderMode('ai'); setStep(1); }}
              className="p-10 border-2 border-slate-100 rounded-[3rem] text-left hover:border-indigo-600 hover:bg-indigo-50 transition-all group flex flex-col relative overflow-hidden"
            >
              <div className="absolute top-4 right-6 bg-indigo-600 text-white text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Premium</div>
              <span className="text-5xl mb-6">🧠</span>
              <h4 className="text-xl font-black mb-2">{bs.mode_ai}</h4>
              <p className="text-slate-500 text-sm font-medium leading-relaxed">{bs.mode_ai_desc}</p>
            </button>
          </div>
        </div>
      );
    }

    if (step === 100) {
      const interviewProgress = Math.min((interviewHistory.filter(h => h.role === 'model').length) * 20, 95);
      return (
        <div className="flex flex-col h-[550px] animate-fadeIn relative">
          <div className="flex items-center justify-between mb-6">
             <div>
               <h3 className="text-2xl font-black tracking-tight">AI Архитектор</h3>
               <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Проектируем: {formData.name}</p>
             </div>
             <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-2 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100">
                   <span className={`w-2 h-2 ${isAiThinking ? 'bg-indigo-600 animate-pulse' : 'bg-green-500'} rounded-full`}></span>
                   <span className="text-[10px] font-black text-indigo-600 uppercase tracking-tighter">Сбор данных: {interviewProgress}%</span>
                </div>
                {interviewHistory.length > 4 && !isAiThinking && (
                  <button 
                    onClick={() => finalizeAssistant(interviewHistory)}
                    className="text-[9px] font-black text-indigo-500 hover:text-indigo-700 underline uppercase tracking-widest"
                  >
                    Завершить и собрать сейчас
                  </button>
                )}
             </div>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar pb-4">
            {interviewHistory.length === 0 && isAiThinking && (
               <div className="h-full flex flex-col items-center justify-center text-center py-10">
                  <div className="w-16 h-16 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-sm font-bold text-slate-500">Устанавливаем связь с Архитектором...</p>
               </div>
            )}
            
            {interviewHistory.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}>
                <div className={`max-w-[80%] p-5 rounded-[2rem] text-sm font-medium shadow-sm ${
                  msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {isAiThinking && interviewHistory.length > 0 && (
              <div className="flex justify-start">
                <div className="bg-slate-100 p-5 rounded-[2rem] border border-slate-200 flex gap-2">
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                  <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                </div>
              </div>
            )}
            {interviewError && (
              <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-xs font-bold text-red-600 text-center animate-fadeIn flex flex-col gap-2">
                <span>{interviewError}</span>
                <button onClick={() => { setInterviewError(null); startAiInterview(); }} className="underline">Попробовать снова</button>
              </div>
            )}
          </div>

          <form onSubmit={handleAiSend} className="mt-6 flex gap-3">
             <input 
               autoFocus
               value={aiInput}
               onChange={(e) => setAiInput(e.target.value)}
               placeholder={bs.ai_chat_placeholder}
               disabled={isAiThinking || isSynthesizing}
               className="flex-1 p-5 bg-slate-50 border border-slate-200 rounded-3xl font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all disabled:opacity-50"
             />
             <button 
               type="submit"
               disabled={isAiThinking || !aiInput.trim() || isSynthesizing}
               className="p-5 bg-slate-900 text-white rounded-3xl hover:bg-indigo-600 transition-all shadow-xl active:scale-95 disabled:opacity-50"
             >
               <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
               </svg>
             </button>
          </form>

          {isSynthesizing && (
            <div className="absolute inset-0 bg-white/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-center p-8">
               <div className="relative w-32 h-32 mb-8">
                 <div className="absolute inset-0 border-8 border-indigo-100 rounded-[3rem]"></div>
                 <div className="absolute inset-0 border-8 border-indigo-600 rounded-[3rem] animate-spin border-t-transparent"></div>
                 <div className="absolute inset-0 flex items-center justify-center text-4xl">🧬</div>
               </div>
               <h4 className="text-2xl font-black text-slate-900 mb-2">{bs.ai_generating}</h4>
               <p className="text-slate-500 font-medium max-w-xs">Используем модель Gemini Pro для создания уникального набора навыков и личности...</p>
            </div>
          )}
        </div>
      );
    }

    switch (step) {
      case 1:
        return (
          <div className="space-y-6 animate-fadeIn">
            <div className="space-y-2">
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s1_title}</h3>
              <p className="text-slate-500 font-medium">{bs.s1_desc}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-8">
              <button onClick={() => handleUpdate('type', AssistantType.PERSONAL)} className={`p-8 border-2 rounded-[2rem] text-left transition-all group ${formData.type === AssistantType.PERSONAL ? 'border-indigo-600 bg-indigo-50 shadow-xl shadow-indigo-100' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">👤</div>
                <div className="font-black text-slate-900 text-lg">{bs.s1_personal}</div>
                <div className="text-xs text-slate-500 font-medium mt-2 leading-relaxed">{bs.s1_personal_desc}</div>
              </button>
              <button onClick={() => handleUpdate('type', AssistantType.BUSINESS)} className={`p-8 border-2 rounded-[2rem] text-left transition-all group ${formData.type === AssistantType.BUSINESS ? 'border-indigo-600 bg-indigo-50 shadow-xl shadow-indigo-100' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">🏢</div>
                <div className="font-black text-slate-900 text-lg">{bs.s1_business}</div>
                <div className="text-xs text-slate-500 font-medium mt-2 leading-relaxed">{bs.s1_business_desc}</div>
              </button>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s2_title}</h3>
            <input type="text" value={formData.name} onChange={(e) => handleUpdate('name', e.target.value)} placeholder={bs.s2_placeholder} className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl text-lg font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all" />
          </div>
        );
      case 3:
        return (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s3_title}</h3>
            <select value={formData.role} onChange={(e) => handleUpdate('role', e.target.value)} className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all appearance-none">
              <option value="">{bs.s3_placeholder}</option>
              {!isPersonal ? (
                businessRoles.map(k => <option key={k} value={t.roles[k]}>{t.roles[k]}</option>)
              ) : (
                personalRoles.map(k => <option key={k} value={t.roles[k]}>{t.roles[k]}</option>)
              )}
            </select>
            {builderMode === 'ai' && formData.role && formData.name && (
              <div className="mt-8 p-6 bg-indigo-600 text-white rounded-[2rem] shadow-xl animate-fadeIn flex items-center justify-between">
                <p className="font-bold text-sm">Имя и роль определены. Готовы к интервью?</p>
                <button 
                  onClick={startAiInterview} 
                  disabled={isAiThinking}
                  className="px-6 py-3 bg-white text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 hover:text-white transition-all disabled:opacity-50"
                >
                  {isAiThinking ? 'ЗАГРУЗКА...' : 'НАЧАТЬ'}
                </button>
              </div>
            )}
          </div>
        );
      case 4:
        return (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s4_title}</h3>
            <textarea value={formData.goals} onChange={(e) => handleUpdate('goals', e.target.value)} placeholder={bs.s4_placeholder} className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl min-h-[180px] font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all" />
          </div>
        );
      case 5:
        return (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s5_title}</h3>
            <textarea value={formData.personality} onChange={(e) => handleUpdate('personality', e.target.value)} placeholder={bs.s5_placeholder} className="w-full p-6 bg-slate-50 border border-slate-200 rounded-2xl min-h-[180px] font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all" />
          </div>
        );
      case 6:
        return (
          <div className="space-y-6 animate-fadeIn">
            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s6_title}</h3>
            <div className="flex bg-slate-100 p-1.5 rounded-2xl w-fit mb-6">
              <button onClick={() => setKnowledgeMode('manual')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${knowledgeMode === 'manual' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{bs.s6_manual}</button>
              {!isPersonal && (
                <button onClick={() => setKnowledgeMode('website')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${knowledgeMode === 'website' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{bs.s6_website}</button>
              )}
            </div>
            {knowledgeMode === 'manual' ? (
              <textarea value={formData.knowledgeBase?.join('\n')} onChange={(e) => handleUpdate('knowledgeBase', e.target.value.split('\n'))} placeholder={bs.s6_placeholder} className="w-full p-6 bg-slate-900 text-indigo-100 border-none rounded-2xl min-h-[220px] font-mono text-xs focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all" />
            ) : (
              <div className="space-y-6">
                <div className="flex gap-3">
                  <input type="text" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder={bs.s6_url_placeholder} className="flex-1 p-5 bg-slate-50 border border-slate-200 rounded-2xl font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all" />
                  <button onClick={async () => {
                    setIsCrawling(true);
                    try { const res = await crawlWebsiteWithGemini(siteUrl); handleUpdate('knowledgeBase', [res]); } catch(e) {} finally { setIsCrawling(false); }
                  }} disabled={isCrawling || !siteUrl} className="px-8 py-5 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-900 transition-all shadow-xl disabled:opacity-50">{isCrawling ? bs.s6_crawling : bs.s6_crawl_btn}</button>
                </div>
              </div>
            )}
          </div>
        );
      case 10:
        return (
          <div className="space-y-6 animate-fadeIn">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center text-2xl">✨</div>
              <h3 className="text-3xl font-black text-slate-900 tracking-tight">{bs.s10_title}</h3>
            </div>
            <div className="bg-slate-50 p-8 rounded-[2rem] border border-slate-100 space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-4">
                 <div className="p-4 bg-white rounded-2xl border"><span className="text-[9px] font-black text-slate-400 uppercase block mb-1">Имя</span><span className="text-sm font-bold">{formData.name}</span></div>
                 <div className="p-4 bg-white rounded-2xl border"><span className="text-[9px] font-black text-slate-400 uppercase block mb-1">Роль</span><span className="text-sm font-bold">{formData.role}</span></div>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase block">Цели</span>
                <p className="text-xs font-medium leading-relaxed bg-white p-4 rounded-2xl border">{formData.goals}</p>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase block">Личность</span>
                <p className="text-xs font-medium leading-relaxed bg-white p-4 rounded-2xl border">{formData.personality}</p>
              </div>
              <div className="space-y-2">
                <span className="text-[9px] font-black text-slate-400 uppercase block">База знаний</span>
                <div className="bg-slate-900 text-indigo-100 p-4 rounded-2xl font-mono text-[10px] whitespace-pre-wrap">{formData.knowledgeBase?.join('\n')}</div>
              </div>
            </div>
          </div>
        );
      case 11:
        return (
          <div className="space-y-8 text-center py-12 animate-fadeIn">
            <div className="text-8xl mb-8 animate-bounce">🚀</div>
            <h3 className="text-4xl font-black text-slate-900 tracking-tight">{bs.s11_title}</h3>
            <button onClick={() => onComplete(formData as Assistant)} className="px-12 py-5 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-slate-900 transition-all shadow-2xl active:scale-95">{t.finish}</button>
          </div>
        );
      default: return null;
    }
  };

  return (
    <div className="max-w-4xl mx-auto bg-white rounded-[3rem] shadow-2xl border border-slate-100 p-8 md:p-12 relative overflow-hidden">
      {step > 0 && step < 100 && (
        <div className="mb-12">
          <div className="flex justify-between text-[10px] font-black text-slate-400 mb-4 tracking-widest uppercase">
            <span>{t.step} {currentDisplayStep} {t.of} {totalSteps}</span>
            <span className="text-indigo-600">{Math.round((currentDisplayStep / totalSteps) * 100)}% {t.complete}</span>
          </div>
          <div className="h-2.5 bg-slate-50 rounded-full overflow-hidden shadow-inner">
            <div className="h-full bg-indigo-600 transition-all duration-700 ease-out" style={{ width: `${(currentDisplayStep / totalSteps) * 100}%` }}></div>
          </div>
        </div>
      )}
      <div className="min-h-[400px]">{renderStep()}</div>
      {step > 0 && step < 11 && (
        <div className="mt-16 pt-8 border-t border-slate-50 flex justify-between items-center">
          <button 
            disabled={isAiThinking}
            onClick={prevStep} 
            className="px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            &larr; {t.back}
          </button>
          
          {(builderMode === 'manual' || (builderMode === 'ai' && step < 3) || step >= 10) && (
            <div className="flex flex-col items-end gap-2">
              <button onClick={nextStep} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-600 shadow-xl transition-all active:scale-95">
                {t.next} &rarr;
              </button>
              {builderMode === 'ai' && step < 3 && (
                <span className="text-[9px] font-black text-indigo-500 uppercase tracking-tighter animate-pulse">ИИ ждет ввода данных...</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
