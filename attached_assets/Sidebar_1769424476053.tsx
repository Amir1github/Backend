
import React from 'react';
import { getTranslation } from '../translations';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  language: string;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentTab, setCurrentTab, language, isOpen, onClose }) => {
  const t = getTranslation(language);
  
  const menuGroups = [
    {
      title: 'Management',
      items: [
        { id: 'dashboard', label: t.dashboard, icon: <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /> },
        { id: 'builder', label: t.builder, icon: <path d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" /> },
      ]
    },
    {
      title: 'Infrastructure',
      items: [
        { id: 'integrations', label: t.integrations, icon: <path d="M13 10V3L4 14h7v7l9-11h-7z" /> },
        { id: 'architecture', label: t.sysDesign, icon: <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /> },
      ]
    },
    {
      title: 'Ecosystem',
      items: [
        { id: 'marketplace', label: t.marketplace, icon: <path d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /> },
        { id: 'settings', label: t.settings, icon: <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /> },
      ]
    }
  ];

  return (
    <>
      {isOpen && <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 lg:hidden" onClick={onClose}></div>}

      <aside className={`
        fixed left-0 top-0 h-screen bg-white border-r border-slate-200 z-[60] transition-transform duration-300 ease-in-out
        w-64 ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex flex-col h-full">
          <div className="h-16 flex items-center px-6 border-b border-slate-100">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center mr-3">
              <span className="text-white font-bold text-lg">A</span>
            </div>
            <span className="font-semibold text-slate-900 tracking-tight">AliControl</span>
          </div>

          <nav className="flex-1 overflow-y-auto p-4 space-y-8">
            {menuGroups.map((group) => (
              <div key={group.title}>
                <p className="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">{group.title}</p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { setCurrentTab(item.id); onClose(); }}
                      className={`
                        w-full flex items-center px-3 py-2 rounded-lg text-sm transition-all duration-200
                        ${currentTab === item.id 
                          ? 'bg-slate-900 text-white font-medium' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}
                      `}
                    >
                      <svg className={`w-5 h-5 mr-3 ${currentTab === item.id ? 'text-white' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        {item.icon}
                      </svg>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="p-4 border-t border-slate-100">
            <div className="flex items-center p-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden mr-3 border border-slate-300">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=Admin" alt="Avatar" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">System Operator</p>
                <p className="text-[10px] text-slate-400">Enterprise Mode</p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
