
import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { AssistantBuilder } from './components/AssistantBuilder';
import { ArchitectureDocs } from './pages/ArchitectureDocs';
import { ChatInterface } from './components/ChatInterface';
import { Settings } from './pages/Settings';
import { Integrations } from './pages/Integrations';
import { Marketplace } from './pages/Marketplace';
import { Assistant } from './types';
import { getTranslation } from './translations';

const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [language, setLanguage] = useState('ru');
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [activeAssistant, setActiveAssistant] = useState<Assistant | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [templateToUse, setTemplateToUse] = useState<Partial<Assistant> | null>(null);

  const t = getTranslation(language);

  const handleCreateComplete = (newAssistant: Assistant) => {
    const assistantWithId: Assistant = { 
      ...newAssistant, 
      id: Math.random().toString(36).substr(2, 9),
      authorName: "System Admin",
      isPublished: false
    };
    setAssistants([...assistants, assistantWithId]);
    setCurrentTab('dashboard');
  };

  const handleUpdateAssistant = (updated: Assistant) => {
    setAssistants(prev => prev.map(a => a.id === updated.id ? updated : a));
    if (activeAssistant?.id === updated.id) {
      setActiveAssistant(updated);
    }
  };

  const renderContent = () => {
    switch (currentTab) {
      case 'dashboard':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-8">
              <Dashboard 
                assistants={assistants} 
                onNew={() => { setTemplateToUse(null); setCurrentTab('builder'); }} 
                onSelect={setActiveAssistant}
                onPublish={(a) => {}}
                language={language}
              />
            </div>
            <div className="lg:col-span-4">
              <div className="sticky top-8 space-y-6">
                <div className="bg-slate-900 rounded-xl p-6 text-white shadow-xl">
                  <h3 className="font-bold text-lg mb-2">AliControl Pro</h3>
                  <p className="text-slate-400 text-xs mb-6">Upgrade to manage complex multi-agent workflows and dedicated GPU nodes.</p>
                  <button className="w-full py-2 bg-white text-slate-900 rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-slate-50 transition-colors">Go Enterprise</button>
                </div>
                {activeAssistant ? (
                  <ChatInterface assistant={activeAssistant} language={language} />
                ) : (
                  <div className="h-[400px] border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center p-8 text-center bg-white">
                    <svg className="w-10 h-10 text-slate-200 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                    <p className="text-slate-400 text-xs font-medium">Select an assistant from your fleet to debug.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      case 'builder':
        return <AssistantBuilder onComplete={handleCreateComplete} initialData={templateToUse} language={language} />;
      case 'integrations':
        return <Integrations language={language} assistants={assistants} onUpdateAssistant={handleUpdateAssistant} />;
      case 'architecture':
        return <ArchitectureDocs />;
      case 'marketplace':
        return <Marketplace onUseTemplate={(t) => { setTemplateToUse(t); setCurrentTab('builder'); }} language={language} communityAssistants={[]} />;
      case 'settings':
        return <Settings currentLang={language} onLanguageChange={setLanguage} />;
      default:
        return <div className="p-10 text-center text-slate-400">Environment Ready. Content Pending.</div>;
    }
  };

  return (
    <div className="min-h-screen flex">
      <Sidebar 
        currentTab={currentTab} 
        setCurrentTab={setCurrentTab} 
        language={language} 
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      
      <main className="flex-1 lg:ml-64 flex flex-col min-w-0">
        <header className="h-16 flex items-center justify-between px-8 bg-white border-b border-slate-200 glass-effect sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 text-slate-500 hover:bg-slate-50 rounded-lg">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="flex flex-col">
              <h1 className="text-sm font-bold text-slate-900 uppercase tracking-tight">{t[currentTab] || currentTab}</h1>
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ALI-SYS: ACTIVE</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="hidden sm:flex items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <span className="text-[10px] font-bold text-slate-500 uppercase mr-3">Node cluster: RU-MSK</span>
              <div className="h-4 w-[1px] bg-slate-200 mr-3"></div>
              <span className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">AliControl v1.0</span>
            </div>
          </div>
        </header>

        <div className="p-8 max-w-[1400px] mx-auto w-full">
          {renderContent()}
        </div>
      </main>
    </div>
  );
};

export default App;
