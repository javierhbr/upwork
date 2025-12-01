import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, Download, Plus, Trash2, 
  User, Bot, FileJson, Settings, ChevronUp, ChevronDown, 
  AlertCircle, PlayCircle, Layers, X, Variable, Hash, FileCode,
  Play, CheckCircle, Clock, ChevronRight, Loader2
} from 'lucide-react';

// --- Utility: Load JS-YAML dynamically ---
const loadYamlLibrary = () => {
  return new Promise((resolve, reject) => {
    if (window.jsyaml) {
      resolve(window.jsyaml);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
    script.onload = () => resolve(window.jsyaml);
    script.onerror = () => reject(new Error('Failed to load YAML library'));
    document.head.appendChild(script);
  });
};

// --- Default Initial State ---
const INITIAL_YAML = {
  name: "New_Card_Application",
  chats: [
    {
      title: "default-scenario",
      timeout: 45,
      labels: ["default"],
      input_variables: {
        Ani: "1234567890",
        Dnis: "+18005550199",
        envMode: "UAT"
      },
      test_parameters: {
        PIN: 1234,
        WELCOME_LANGUAGE: {
          messages: [
            { bot: "Thanks for calling Capital One." },
            { bot: "Para Espanol, oprima el 2" }
          ]
        }
      },
      ignoredMessages: [{ bot: "Please wait" }],
      expectedMessages: [
        { reference: "WELCOME_LANGUAGE" },
        { user: "1" }
      ]
    }
  ]
};

const App = () => {
  const [data, setData] = useState(INITIAL_YAML);
  const [activeChatIndex, setActiveChatIndex] = useState(0);
  const [isYamlLoaded, setIsYamlLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('flow'); 
  const [activeRefKey, setActiveRefKey] = useState(null); 
  
  // Creation States
  const [isCreatingRef, setIsCreatingRef] = useState(false);
  const [newRefName, setNewRefName] = useState("");
  const [isCreatingVar, setIsCreatingVar] = useState(false);
  const [newVarName, setNewVarName] = useState("");
  const [isCreatingTestParam, setIsCreatingTestParam] = useState(false);
  const [newTestParamName, setNewTestParamName] = useState("");

  // Delete State
  const [deleteTarget, setDeleteTarget] = useState(null); 
  
  // --- RUNNER STATES ---
  const [viewState, setViewState] = useState('editor'); // 'editor', 'config', 'running', 'results'
  const [runConfig, setRunConfig] = useState({ ocpGroup: '', label: '' });
  const [runTimer, setRunTimer] = useState(0);
  const [simulationResult, setSimulationResult] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    loadYamlLibrary().then(() => setIsYamlLoaded(true));
  }, []);

  // --- Handlers ---

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = window.jsyaml.load(event.target.result);
        setData(parsed);
        setActiveChatIndex(0);
        setActiveRefKey(null);
      } catch (error) {
        alert("Error parsing YAML file. Please check the syntax.");
        console.error(error);
      }
    };
    reader.readAsText(file);
  };

  const handleDownload = () => {
    if (!window.jsyaml) return;
    const yamlStr = window.jsyaml.dump(data, { lineWidth: -1 });
    const blob = new Blob([yamlStr], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${data.name || 'ivr-test'}.yaml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const updateChat = (index, field, value) => {
    const newData = { ...data };
    newData.chats[index] = { ...newData.chats[index], [field]: value };
    setData(newData);
  };

  // --- Helper to get input variables ---
  const getInputVariables = (chat) => {
    if (chat.input_variables) return chat.input_variables;
    if (chat.test_parameters && chat.test_parameters.input_variables) return chat.test_parameters.input_variables;
    return {};
  };

  const updateInputVariable = (key, value) => {
    const newData = { ...data };
    const chat = newData.chats[activeChatIndex];
    if (chat.test_parameters && chat.test_parameters.input_variables) {
      chat.test_parameters.input_variables[key] = value;
    } else {
      if (!chat.input_variables) chat.input_variables = {};
      chat.input_variables[key] = value;
    }
    setData(newData);
  };

  const updateTestParameter = (key, value) => {
    const newData = { ...data };
    const chat = newData.chats[activeChatIndex];
    if (!chat.test_parameters) chat.test_parameters = {};
    chat.test_parameters[key] = value;
    setData(newData);
  };

  // --- Flow Editing Handlers ---
  const addMessageStep = (type) => {
    const newData = { ...data };
    const messages = newData.chats[activeChatIndex].expectedMessages || [];
    let newStep = {};
    if (type === 'bot') newStep = { bot: "" };
    if (type === 'user') newStep = { user: "" };
    if (type === 'reference') newStep = { reference: "" };
    newData.chats[activeChatIndex].expectedMessages = [...messages, newStep];
    setData(newData);
  };

  const updateMessageStep = (msgIndex, key, val) => {
    const newData = { ...data };
    newData.chats[activeChatIndex].expectedMessages[msgIndex] = { 
      ...newData.chats[activeChatIndex].expectedMessages[msgIndex],
      [key]: val 
    };
    setData(newData);
  };

  const insertParam = (msgIndex, field, paramName) => {
    const newData = { ...data };
    const currentVal = newData.chats[activeChatIndex].expectedMessages[msgIndex][field] || "";
    const token = `$${paramName}`;
    const newVal = currentVal ? `${currentVal} ${token}` : token;
    newData.chats[activeChatIndex].expectedMessages[msgIndex][field] = newVal;
    if (field === 'user') {
      newData.chats[activeChatIndex].expectedMessages[msgIndex].parameterized = true;
    }
    setData(newData);
  };

  const toggleParameterized = (msgIndex) => {
    const newData = { ...data };
    const msg = newData.chats[activeChatIndex].expectedMessages[msgIndex];
    if (msg.parameterized) {
      delete msg.parameterized;
    } else {
      msg.parameterized = true;
    }
    setData(newData);
  };

  const deleteMessageStep = (msgIndex) => {
    const newData = { ...data };
    newData.chats[activeChatIndex].expectedMessages.splice(msgIndex, 1);
    setData(newData);
  };

  const moveMessageStep = (msgIndex, direction) => {
    const newData = { ...data };
    const messages = newData.chats[activeChatIndex].expectedMessages;
    if (direction === -1 && msgIndex > 0) {
      [messages[msgIndex], messages[msgIndex - 1]] = [messages[msgIndex - 1], messages[msgIndex]];
    } else if (direction === 1 && msgIndex < messages.length - 1) {
      [messages[msgIndex], messages[msgIndex + 1]] = [messages[msgIndex + 1], messages[msgIndex]];
    }
    setData(newData);
  };

  // --- Reference & Param Creation/Deletion Handlers ---
  const startCreatingReference = () => { setIsCreatingRef(true); setNewRefName(""); };
  const confirmCreateReference = () => {
    const key = newRefName.trim();
    if (!key) { setIsCreatingRef(false); return; }
    const newData = { ...data };
    const chat = newData.chats[activeChatIndex];
    if (!chat.test_parameters) chat.test_parameters = {};
    if (key === 'input_variables' || chat.test_parameters[key]) { alert("Invalid/duplicate name."); return; }
    chat.test_parameters[key] = { messages: [] };
    setData(newData); setActiveRefKey(key); setIsCreatingRef(false);
  };
  const addRefMessageStep = (type) => { /* ... simplified for brevity, logic identical to previous ... */ 
    if (!activeRefKey) return;
    const newData = { ...data };
    const ref = newData.chats[activeChatIndex].test_parameters[activeRefKey];
    if (!ref.messages) ref.messages = [];
    ref.messages.push(type === 'bot' ? { bot: "" } : { user: "" });
    setData(newData);
  };
  const updateRefMessageStep = (msgIndex, key, val) => {
    if (!activeRefKey) return;
    const newData = { ...data };
    newData.chats[activeChatIndex].test_parameters[activeRefKey].messages[msgIndex] = { [key]: val };
    setData(newData);
  };
  const deleteRefMessageStep = (msgIndex) => {
    if (!activeRefKey) return;
    const newData = { ...data };
    newData.chats[activeChatIndex].test_parameters[activeRefKey].messages.splice(msgIndex, 1);
    setData(newData);
  };

  const startCreatingVariable = () => { setIsCreatingVar(true); setNewVarName(""); };
  const confirmCreateVariable = () => {
    const key = newVarName.trim();
    if (!key) { setIsCreatingVar(false); return; }
    const newData = { ...data };
    const chat = newData.chats[activeChatIndex];
    const existingVars = getInputVariables(chat);
    if (existingVars.hasOwnProperty(key)) { alert("Exists."); return; }
    if (chat.test_parameters && chat.test_parameters.input_variables) chat.test_parameters.input_variables[key] = "";
    else { if (!chat.input_variables) chat.input_variables = {}; chat.input_variables[key] = ""; }
    setData(newData); setIsCreatingVar(false);
  };

  const startCreatingTestParam = () => { setIsCreatingTestParam(true); setNewTestParamName(""); };
  const confirmCreateTestParam = () => {
    const key = newTestParamName.trim();
    if (!key) { setIsCreatingTestParam(false); return; }
    const newData = { ...data };
    const chat = newData.chats[activeChatIndex];
    if (!chat.test_parameters) chat.test_parameters = {};
    if (chat.test_parameters.hasOwnProperty(key)) { alert("Exists."); return; }
    chat.test_parameters[key] = "";
    setData(newData); setIsCreatingTestParam(false);
  };

  const requestDelete = (type, key, e) => {
    if (e) e.stopPropagation();
    setDeleteTarget({ type, key });
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const newData = { ...data };
    const chat = newData.chats[activeChatIndex];
    if (deleteTarget.type === 'reference' || deleteTarget.type === 'test_param') {
      if (chat.test_parameters) delete chat.test_parameters[deleteTarget.key];
      if (activeRefKey === deleteTarget.key) setActiveRefKey(null);
    } else if (deleteTarget.type === 'variable') {
      if (chat.test_parameters?.input_variables) delete chat.test_parameters.input_variables[deleteTarget.key];
      else if (chat.input_variables) delete chat.input_variables[deleteTarget.key];
    }
    setData(newData); setDeleteTarget(null);
  };

  // --- RUNNER LOGIC ---

  const initiateRun = () => {
    const chat = data.chats[activeChatIndex];
    // Default label selection
    const defaultLabel = chat.labels && chat.labels.length > 0 ? chat.labels[0] : '';
    setRunConfig({ ocpGroup: '', label: defaultLabel });
    setViewState('config');
  };

  const startSimulation = () => {
    setViewState('running');
    setRunTimer(0);
    
    // Start timer
    timerRef.current = setInterval(() => {
      setRunTimer(prev => prev + 100); // 100ms increments
    }, 100);

    // Mock API call delay (e.g., 2.5 seconds)
    setTimeout(() => {
      finishSimulation();
    }, 2500);
  };

  const finishSimulation = () => {
    clearInterval(timerRef.current);
    
    // Generate Mock Results based on active chat
    const chat = data.chats[activeChatIndex];
    const mockMessages = [];
    let currentTime = 300; // start at 300ms

    // Flatten logic for mock display
    const addMsg = (src, txt) => {
      mockMessages.push({
        time: currentTime,
        source: src,
        message: txt
      });
      currentTime += Math.floor(Math.random() * 800) + 200; // random delay
    };

    // Very basic flattener to show something in result
    (chat.expectedMessages || []).forEach(step => {
      if (step.bot) addMsg('BOT', step.bot);
      if (step.user) addMsg('USER', step.user);
      if (step.reference) addMsg('REF', `[Executed Reference: ${step.reference}]`);
    });

    setSimulationResult({
      dialogId: `4c${Math.random().toString(16).substr(2,10)}...`, // Mock ID
      startTime: new Date().toISOString(),
      inputVariables: getInputVariables(chat),
      messages: mockMessages,
      chatTitle: chat.title
    });

    setViewState('results');
  };

  const closeRunner = () => {
    setViewState('editor');
    setSimulationResult(null);
  };

  // --- Render Helpers ---

  const activeChat = data.chats[activeChatIndex];
  const inputVars = getInputVariables(activeChat);
  const allTestParams = activeChat?.test_parameters || {};
  
  const availableRefs = Object.keys(allTestParams)
    .filter(k => k !== 'input_variables' && typeof allTestParams[k] === 'object' && allTestParams[k] !== null);
  const simpleTestParams = Object.keys(allTestParams)
    .filter(k => k !== 'input_variables' && (typeof allTestParams[k] !== 'object' || allTestParams[k] === null));

  // --- VIEW: EDITOR (Standard UI) ---
  if (viewState === 'editor') {
    return (
      <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans relative">
        {/* Delete Modal */}
        {deleteTarget && (
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 w-80">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-red-600">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Delete Item?</h3>
                  <p className="text-sm text-slate-500 mt-1">Permanently remove <span className="font-mono font-bold">{deleteTarget.key}</span>?</p>
                </div>
                <div className="flex gap-3 w-full">
                  <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 bg-white border rounded text-slate-700">Cancel</button>
                  <button onClick={confirmDelete} className="flex-1 py-2 bg-red-600 text-white rounded">Delete</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-600 rounded-lg"><Settings className="w-5 h-5 text-white" /></div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">IVR Scenario Builder</h1>
              <p className="text-xs text-slate-500">Edit YAML configurations visually</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
             {/* RUN BUTTON */}
            <button 
              onClick={initiateRun}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors text-sm font-medium shadow-sm"
            >
              <Play className="w-4 h-4 fill-current" />
              Run Scenario
            </button>
            <div className="h-6 w-px bg-slate-200 mx-2"></div>
            <label className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md cursor-pointer transition-colors text-sm font-medium">
              <Upload className="w-4 h-4" /> Import
              <input type="file" accept=".yaml,.yml" onChange={handleFileUpload} className="hidden" />
            </label>
            <button onClick={handleDownload} disabled={!isYamlLoaded} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-medium shadow-sm disabled:opacity-50">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </header>

        {/* Main Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
            <div className="p-4 border-b border-slate-100">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Test Scenarios</h2>
              <input value={data.name || ''} onChange={(e) => setData({...data, name: e.target.value})} className="w-full text-sm p-2 border border-slate-300 rounded mb-2" placeholder="Suite Name" />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {data.chats.map((chat, idx) => (
                <button
                  key={idx}
                  onClick={() => { setActiveChatIndex(idx); setActiveRefKey(null); }}
                  className={`w-full text-left p-3 rounded-md text-sm flex items-center justify-between group ${idx === activeChatIndex ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <span className="truncate font-medium">{chat.title || 'Untitled Chat'}</span>
                  {data.chats.length > 1 && (
                    <Trash2 className="w-4 h-4 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500" onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this scenario?')) { const newData = { ...data }; newData.chats.splice(idx, 1); setData(newData); setActiveChatIndex(0); }
                    }} />
                  )}
                </button>
              ))}
              <button onClick={() => { const newData = { ...data }; newData.chats.push({ title: "new-scenario", timeout: 30, expectedMessages: [] }); setData(newData); setActiveChatIndex(newData.chats.length - 1); }} className="w-full mt-2 py-2 border border-dashed border-slate-300 text-slate-500 rounded-md text-sm hover:border-blue-400 hover:text-blue-600 flex items-center justify-center gap-2">
                <Plus className="w-3 h-3" /> New Scenario
              </button>
            </div>
          </aside>

          {/* Editor Area */}
          <main className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
            <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
              <div className="flex gap-4">
                 {['flow', 'params', 'references', 'settings'].map(t => (
                   <button key={t} onClick={() => setActiveTab(t)} className={`text-sm font-medium pb-1 border-b-2 capitalize transition-colors ${activeTab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
                 ))}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Scenario Title:</span>
                <input value={activeChat.title} onChange={(e) => updateChat(activeChatIndex, 'title', e.target.value)} className="text-sm px-2 py-1 border border-slate-300 rounded focus:border-blue-500 outline-none w-48" />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-8">
              <div className="max-w-4xl mx-auto">
                {activeTab === 'flow' && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-slate-800">Interaction Script</h3>
                      <div className="flex gap-2 text-xs">
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-blue-100 border border-blue-300 rounded-full"></div> Bot</div>
                        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-green-100 border border-green-300 rounded-full"></div> User</div>
                      </div>
                    </div>
                    <div className="space-y-3 pb-20">
                      {(activeChat.expectedMessages || []).map((msg, idx) => {
                        const isBot = msg.hasOwnProperty('bot');
                        const isUser = msg.hasOwnProperty('user');
                        const isRef = msg.hasOwnProperty('reference');
                        return (
                          <div key={idx} className="group flex gap-4 items-start animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="w-8 flex flex-col items-center opacity-0 group-hover:opacity-100 transition-opacity pt-2">
                              <button onClick={() => moveMessageStep(idx, -1)} className="p-1 hover:text-blue-600"><ChevronUp className="w-3 h-3" /></button>
                              <button onClick={() => deleteMessageStep(idx)} className="p-1 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                              <button onClick={() => moveMessageStep(idx, 1)} className="p-1 hover:text-blue-600"><ChevronDown className="w-3 h-3" /></button>
                            </div>
                            <div className={`flex-1 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                              <div className={`relative max-w-2xl w-full p-4 rounded-xl border shadow-sm flex flex-col gap-2 ${isBot ? 'bg-white border-slate-200 rounded-tl-none' : ''} ${isUser ? 'bg-green-50 border-green-100 rounded-tr-none' : ''} ${isRef ? 'bg-slate-100 border-dashed border-slate-300' : ''}`}>
                                <div className="flex gap-3">
                                  <div className={`mt-1 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${isBot ? 'bg-blue-100 text-blue-600' : ''} ${isUser ? 'bg-green-200 text-green-700' : ''} ${isRef ? 'bg-slate-300 text-slate-600' : ''}`}>
                                    {isBot && <Bot className="w-5 h-5" />}
                                    {isUser && <User className="w-5 h-5" />}
                                    {isRef && <FileJson className="w-5 h-5" />}
                                  </div>
                                  <div className="flex-1 relative">
                                    <div className="flex justify-between items-center mb-1">
                                      <label className="text-xs font-bold uppercase tracking-wider opacity-50 block">{isBot ? 'Bot Expectation' : isUser ? 'User Input / Action' : 'Load Reference'}</label>
                                      {!isRef && simpleTestParams.length > 0 && (
                                        <div className="relative">
                                          <select className="text-[10px] border border-slate-200 rounded bg-slate-50 text-slate-600 px-1 py-0.5 outline-none hover:border-blue-300 cursor-pointer w-24" onChange={(e) => { if (e.target.value) { insertParam(idx, isBot ? 'bot' : 'user', e.target.value); e.target.value = ""; } }} defaultValue="">
                                            <option value="" disabled>Insert Var...</option>
                                            {simpleTestParams.map(p => <option key={p} value={p}>{p}</option>)}
                                          </select>
                                        </div>
                                      )}
                                    </div>
                                    {isRef ? (
                                      <select className="w-full bg-transparent border-b border-slate-400 focus:border-blue-500 outline-none py-1 text-slate-700 font-mono cursor-pointer" value={msg.reference} onChange={(e) => updateMessageStep(idx, 'reference', e.target.value)}>
                                        <option value="" disabled>Select a reference...</option>
                                        {availableRefs.map(ref => <option key={ref} value={ref}>{ref}</option>)}
                                      </select>
                                    ) : (
                                      <textarea className="w-full bg-transparent resize-none outline-none text-slate-800" rows={isUser ? 1 : 2} value={isBot ? msg.bot : msg.user} placeholder={isBot ? "What should the bot say?" : "What does the user say/press?"} onChange={(e) => updateMessageStep(idx, isBot ? 'bot' : 'user', e.target.value)} />
                                    )}
                                  </div>
                                </div>
                                {isUser && msg.user && msg.user.includes('$') && (
                                  <div className="border-t border-green-200 mt-2 pt-2 flex items-center gap-2">
                                    <input type="checkbox" id={`param-${idx}`} checked={!!msg.parameterized} onChange={() => toggleParameterized(idx)} className="w-3 h-3 text-blue-600 rounded" />
                                    <label htmlFor={`param-${idx}`} className="text-xs text-slate-600 cursor-pointer select-none">Use as Parameter ({msg.parameterized ? 'True' : 'False'})</label>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex justify-center gap-4 mt-8 pt-4 border-t border-slate-200">
                        <button onClick={() => addMessageStep('bot')} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 shadow-sm rounded-full text-slate-700 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 transition-all"><Bot className="w-4 h-4" /> Add Bot Step</button>
                        <button onClick={() => addMessageStep('user')} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 shadow-sm rounded-full text-slate-700 hover:bg-green-50 hover:border-green-200 hover:text-green-700 transition-all"><User className="w-4 h-4" /> Add User Step</button>
                        <button onClick={() => addMessageStep('reference')} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 shadow-sm rounded-full text-slate-700 hover:bg-slate-100 transition-all"><FileJson className="w-4 h-4" /> Add Reference</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Simplified other tabs for brevity, same as previous App.jsx */}
                {activeTab === 'references' && (
                   <div className="flex gap-6 h-[calc(100vh-14rem)]">
                    <div className="w-1/3 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
                      <div className="p-3 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-xl">
                        <span className="text-xs font-bold text-slate-500 uppercase">Available References</span>
                        <button onClick={startCreatingReference} className="text-blue-600 hover:bg-blue-50 p-1 rounded"><Plus className="w-4 h-4" /></button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {isCreatingRef && <input autoFocus className="w-full p-2 text-sm border border-blue-400 rounded shadow-sm outline-none" placeholder="Enter Name..." value={newRefName} onChange={e => setNewRefName(e.target.value)} onKeyDown={e => {if(e.key==='Enter') confirmCreateReference();}} />}
                        {availableRefs.map(ref => (
                          <div key={ref} onClick={() => setActiveRefKey(ref)} className={`p-3 rounded-md text-sm flex justify-between cursor-pointer ${activeRefKey === ref ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}`}>
                             <span>{ref}</span> <Trash2 className="w-3 h-3 text-slate-400 hover:text-red-500" onClick={(e) => requestDelete('reference', ref, e)} />
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Right side Ref Editor is assumed unchanged from previous... */}
                    <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                      {activeRefKey ? (
                        <div className="space-y-2">
                           <h3 className="font-mono text-blue-600 mb-4">{activeRefKey}</h3>
                           {(allTestParams[activeRefKey]?.messages || []).map((msg, idx) => (
                             <div key={idx} className="flex gap-2">
                               <span className={`text-xs font-bold px-2 py-1 rounded ${msg.bot ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{msg.bot ? 'BOT' : 'USER'}</span>
                               <input className="flex-1 border-b bg-transparent" value={msg.bot || msg.user} onChange={(e) => updateRefMessageStep(idx, msg.bot ? 'bot' : 'user', e.target.value)} />
                               <Trash2 className="w-4 h-4 text-slate-300 hover:text-red-500 cursor-pointer" onClick={() => deleteRefMessageStep(idx)} />
                             </div>
                           ))}
                           <button onClick={() => addRefMessageStep('bot')} className="text-xs text-blue-600 mt-2">+ Bot</button>
                           <button onClick={() => addRefMessageStep('user')} className="text-xs text-green-600 mt-2 ml-2">+ User</button>
                        </div>
                      ) : <div className="text-slate-400 text-center mt-10">Select a reference</div>}
                    </div>
                   </div>
                )}
                
                {activeTab === 'params' && (
                  <div className="space-y-6">
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-semibold text-slate-800">Test Input Variables</h3>
                        <button onClick={startCreatingVariable} className="text-sm text-blue-600"><Plus className="w-4 h-4 inline" /> Add</button>
                      </div>
                      {isCreatingVar && <input autoFocus className="w-full mb-2 p-2 text-sm border rounded" placeholder="Key..." value={newVarName} onChange={e=>setNewVarName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')confirmCreateVariable()}} />}
                      {Object.entries(inputVars).map(([k,v]) => (
                        <div key={k} className="flex items-center gap-4 mb-2">
                           <span className="w-1/3 font-mono text-sm text-slate-700">{k}</span>
                           <input className="flex-1 border-b bg-transparent" value={v} onChange={e => updateInputVariable(k, e.target.value)} />
                           <Trash2 className="w-4 h-4 text-slate-300 hover:text-red-500 cursor-pointer" onClick={(e) => requestDelete('variable', k, e)} />
                        </div>
                      ))}
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="font-semibold text-slate-800">Test Parameters</h3>
                        <button onClick={startCreatingTestParam} className="text-sm text-purple-600"><Plus className="w-4 h-4 inline" /> Add</button>
                      </div>
                      {isCreatingTestParam && <input autoFocus className="w-full mb-2 p-2 text-sm border rounded" placeholder="Key..." value={newTestParamName} onChange={e=>setNewTestParamName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')confirmCreateTestParam()}} />}
                      {simpleTestParams.map(k => (
                        <div key={k} className="flex items-center gap-4 mb-2">
                           <span className="w-1/3 font-mono text-sm text-slate-700">{k}</span>
                           <input className="flex-1 border-b bg-transparent" value={allTestParams[k]} onChange={e => updateTestParameter(k, e.target.value)} />
                           <Trash2 className="w-4 h-4 text-slate-300 hover:text-red-500 cursor-pointer" onClick={(e) => requestDelete('test_param', k, e)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {activeTab === 'settings' && (
                   <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                      <h3 className="font-semibold mb-4">General Configuration</h3>
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium mb-1">Timeout (s)</label>
                          <input type="number" value={activeChat.timeout} onChange={(e) => updateChat(activeChatIndex, 'timeout', e.target.value)} className="w-full p-2 border rounded" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium mb-1">Labels</label>
                          <input value={(activeChat.labels||[]).join(', ')} onChange={(e) => updateChat(activeChatIndex, 'labels', e.target.value.split(','))} className="w-full p-2 border rounded" />
                        </div>
                      </div>
                   </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // --- VIEW: RUN CONFIG MODAL ---
  if (viewState === 'config') {
    return (
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-2xl p-8 w-full max-w-md transform transition-all scale-100">
           <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
             <PlayCircle className="w-6 h-6 text-green-600" />
             Run Test Scenario
           </h2>
           
           <div className="space-y-5">
             <div>
               <label className="block text-sm font-bold text-slate-700 mb-2">OCP Group</label>
               <input 
                 autoFocus
                 className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                 placeholder="Enter OCP Group..."
                 value={runConfig.ocpGroup}
                 onChange={(e) => setRunConfig({...runConfig, ocpGroup: e.target.value})}
               />
             </div>
             
             <div>
               <label className="block text-sm font-bold text-slate-700 mb-2">Label to Run</label>
               <div className="relative">
                 <select 
                   className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none appearance-none bg-white"
                   value={runConfig.label}
                   onChange={(e) => setRunConfig({...runConfig, label: e.target.value})}
                 >
                   <option value="">Select a Label...</option>
                   {(data.chats[activeChatIndex].labels || []).map(l => (
                     <option key={l} value={l}>{l}</option>
                   ))}
                 </select>
                 <ChevronDown className="absolute right-3 top-3.5 w-5 h-5 text-slate-400 pointer-events-none" />
               </div>
             </div>
           </div>

           <div className="flex gap-3 mt-8">
             <button 
               onClick={() => setViewState('editor')}
               className="flex-1 py-3 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors"
             >
               Cancel
             </button>
             <button 
               onClick={startSimulation}
               disabled={!runConfig.ocpGroup || !runConfig.label}
               className="flex-1 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
             >
               Start Test
             </button>
           </div>
        </div>
      </div>
    );
  }

  // --- VIEW: RUNNING (LOADER) ---
  if (viewState === 'running') {
    return (
      <div className="flex flex-col h-screen bg-slate-50 items-center justify-center relative">
        <div className="bg-white p-10 rounded-2xl shadow-xl flex flex-col items-center max-w-sm w-full">
           <div className="relative mb-6">
             <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-20"></div>
             <Loader2 className="w-16 h-16 text-blue-600 animate-spin relative z-10" />
           </div>
           
           <h2 className="text-xl font-bold text-slate-800 mb-2">Running Test...</h2>
           <p className="text-slate-500 text-sm mb-6 text-center">
             Executing scenario against OCP Group: <br/>
             <span className="font-mono font-medium text-slate-700">{runConfig.ocpGroup}</span>
           </p>
           
           <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-full font-mono text-slate-600">
             <Clock className="w-4 h-4" />
             <span>{(runTimer / 1000).toFixed(1)}s</span>
           </div>
        </div>
      </div>
    );
  }

  // --- VIEW: RESULTS (IMAGE MATCH) ---
  if (viewState === 'results' && simulationResult) {
    return (
      <div className="flex flex-col h-screen bg-white font-sans overflow-hidden">
        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-4">
             <div className="text-3xl font-bold text-slate-800">1</div>
             <CheckCircle className="w-8 h-8 text-green-500" />
             <div>
               <h1 className="text-2xl font-bold text-slate-800">{simulationResult.chatTitle}</h1>
               <span className="text-sm text-slate-500">{runConfig.label}</span>
             </div>
          </div>
          <button onClick={closeRunner} className="px-4 py-2 border border-slate-300 rounded hover:bg-slate-50 text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
          <div className="max-w-6xl mx-auto space-y-6">
            
            {/* Details Section (Accordion style) */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-blue-600 uppercase">
                [+] Click to see chat details
              </div>
              <div className="p-6 space-y-4">
                 {/* Detail Row */}
                 <div className="flex">
                   <div className="w-48 text-sm text-slate-500">dialog_id</div>
                   <div className="flex-1 bg-slate-100 rounded px-3 py-1 text-sm font-mono text-slate-700 truncate">
                     {simulationResult.dialogId}
                   </div>
                 </div>
                 
                 <div className="flex">
                   <div className="w-48 text-sm text-slate-500">input_variables</div>
                   <div className="flex-1 space-y-2">
                     {Object.entries(simulationResult.inputVariables).map(([k,v]) => (
                       <div key={k} className="flex items-center bg-slate-50 rounded border border-slate-100 p-1">
                         <span className="w-32 text-xs font-semibold text-slate-600 pl-2">{k}</span>
                         <span className="text-sm text-slate-800 font-mono bg-white px-2 rounded flex-1">{v}</span>
                       </div>
                     ))}
                   </div>
                 </div>

                 <div className="flex">
                   <div className="w-48 text-sm text-slate-500">startTime</div>
                   <div className="flex-1 bg-slate-100 rounded px-3 py-1 text-sm font-mono text-slate-700">
                     {simulationResult.startTime}
                   </div>
                 </div>
              </div>
            </div>

            {/* Conversation Table */}
            <div>
              <h2 className="text-xl font-bold text-slate-800 mb-4">Conversation</h2>
              <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-slate-200">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-white border-b border-slate-200">
                      <th className="px-4 py-3 text-sm font-medium text-slate-600 w-32">Message Time (ms)</th>
                      <th className="px-4 py-3 text-sm font-medium text-slate-600 w-24">Source</th>
                      <th className="px-4 py-3 text-sm font-medium text-slate-600">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {simulationResult.messages.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 bg-green-100/30">
                        <td className="px-4 py-3 text-sm font-mono text-slate-700">{row.time}</td>
                        <td className="px-4 py-3 text-sm font-bold text-slate-600 uppercase">{row.source}</td>
                        <td className="px-4 py-3 text-sm text-slate-800">{row.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>
      </div>
    );
  }

  // Fallback
  return null;
};

export default App;
