import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateSpeech } from './services/geminiService';
import { decodeBase64Audio, exportAudio, concatAudioBuffers, mixAudioBuffers, extractPeaks } from './utils/audioUtils';
import { GeneratedAudio, VoiceName, AudioQuality, ScriptLine } from './types';
import WaveformVisualizer from './components/WaveformVisualizer';
import { Spinner } from './components/Spinner';
import { saveHistoryItem, loadHistoryFromDB, clearAllHistoryDB, loadAudioBufferFromDB, deleteHistoryItemDB } from './utils/dbUtils';

// Icons
const PlayIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" /></svg>;
const PauseIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>;
const DownloadIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>;
const SparklesIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>;
const TrashIcon = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>;

const VOICES: VoiceName[] = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'];

const STYLES = [
  "Cheerfully",
  "Sadly",
  "Like a pirate",
  "Whispering",
  "Professionally",
  "Robotically",
  "Urgently",
  "Calmly"
];

const chunkTextForTTS = (text: string, maxLength: number = 300): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)+|[^.!?]+$/g) || [text];
  
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    
    if (currentChunk.length + s.length + 1 > maxLength && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = s;
    } else {
      currentChunk = currentChunk ? `${currentChunk} ${s}` : s;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
};

function App() {
  const [mode, setMode] = useState<'single' | 'conversation'>('single');
  const [scriptLines, setScriptLines] = useState<ScriptLine[]>([
    { id: crypto.randomUUID(), voice: 'Kore', style: '', text: '' }
  ]);
  const [text, setText] = useState('');
  const [style, setStyle] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [voice, setVoice] = useState<VoiceName>('Kore');
  const [isGenerating, setIsGenerating] = useState(false);
  const [history, setHistory] = useState<GeneratedAudio[]>([]);
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Background Audio State
  const [bgMusicBuffer, setBgMusicBuffer] = useState<AudioBuffer | null>(null);
  const [bgMusicName, setBgMusicName] = useState<string | null>(null);
  const [bgMusicVolume, setBgMusicVolume] = useState<number>(0.15); // Default to 15%

  // Audio Context Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Initialize Audio Context on user interaction (or first render, but best lazily)
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume();
    }
    return audioContextRef.current;
  }, []);

  useEffect(() => {
    // Load history on mount
    loadHistoryFromDB(null, false).then(savedHistory => {
      setHistory(savedHistory);
    }).catch(err => console.error("Failed to load history from DB", err));
  }, []);

  const handleGenerate = async () => {
    if (mode === 'single' && !text.trim()) return;
    const validLines = scriptLines.filter(l => l.text.trim());
    if (mode === 'conversation' && validLines.length === 0) return;

    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const ctx = getAudioContext();
      
      let finalAudioBuffer: AudioBuffer;
      let finalLabel = "";
      
      if (mode === 'single') {
        const finalStyle = customStyle.trim() || style;
        const chunks = chunkTextForTTS(text, 500);
        const buffers: AudioBuffer[] = [];
        for (const chunk of chunks) {
           const base64Audio = await generateSpeech(chunk, finalStyle, voice);
           const buf = await decodeBase64Audio(base64Audio, ctx);
           buffers.push(buf);
        }
        finalAudioBuffer = concatAudioBuffers(buffers, ctx);
        finalLabel = text;
      } else {
        const buffers: AudioBuffer[] = [];
        for (const line of validLines) {
           const chunks = chunkTextForTTS(line.text, 500);
           for (const chunk of chunks) {
              const base64Audio = await generateSpeech(chunk, line.style.trim(), line.voice);
              const buf = await decodeBase64Audio(base64Audio, ctx);
              buffers.push(buf);
           }
        }
        finalAudioBuffer = concatAudioBuffers(buffers, ctx);
        finalLabel = validLines.map(l => `${l.voice}: ${l.text}`).join(' -> ');
      }

      // Mix background audio if present
      if (bgMusicBuffer) {
         finalAudioBuffer = mixAudioBuffers(finalAudioBuffer, bgMusicBuffer, ctx, bgMusicVolume);
      }

      const peaks = extractPeaks(finalAudioBuffer);

      const newEntry: GeneratedAudio = {
        id: crypto.randomUUID(),
        text: finalLabel,
        style: mode === 'single' ? (customStyle.trim() || style) : 'Conversation',
        voice: mode === 'single' ? voice : 'Mixed',
        timestamp: Date.now(),
        buffer: finalAudioBuffer,
        peaks,
      };

      try {
         await saveHistoryItem(newEntry);
      } catch (err) {
         console.error("Failed to save to IDB", err);
      }

      setHistory(prev => [newEntry, ...prev]);
      
      // Auto-play the newest generation
      playAudio(newEntry);

    } catch (error: any) {
      const msg = error?.message || "Failed to generate speech.";
      setErrorMessage(msg);
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const playAudio = async (item: GeneratedAudio) => {
    const ctx = getAudioContext();
    
    // Stop currently playing
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch (e) { /* ignore */ }
    }

    if (currentPlayingId === item.id) {
      // Toggle pause/stop logic essentially
      setCurrentPlayingId(null);
      return;
    }

    let bufferToPlay = item.buffer;
    if (!bufferToPlay) {
       bufferToPlay = await loadAudioBufferFromDB(item.id, ctx);
       if (!bufferToPlay) {
          setErrorMessage("Failed to load audio data for this item.");
          return;
       }
       // Update state so we don't have to load it again if played multiple times
       setHistory(prev => prev.map(h => h.id === item.id ? { ...h, buffer: bufferToPlay } : h));
    }

    const source = ctx.createBufferSource();
    source.buffer = bufferToPlay;
    
    // Create analyser
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyser.connect(ctx.destination);
    
    analyserRef.current = analyser;
    sourceNodeRef.current = source;
    
    source.onended = () => {
      setCurrentPlayingId(null);
    };

    source.start();
    setCurrentPlayingId(item.id);
  };

  const stopAudio = () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.stop();
      } catch(e) {/* ignore */}
      sourceNodeRef.current = null;
    }
    setCurrentPlayingId(null);
  };

  const clearHistory = async () => {
    stopAudio();
    await clearAllHistoryDB();
    setHistory([]);
  };

  const removeHistoryItem = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentPlayingId === id) stopAudio();
    await deleteHistoryItemDB(id);
    setHistory(prev => prev.filter(h => h.id !== id));
  };

  const addScriptLine = () => {
    setScriptLines(prev => [
      ...prev,
      { id: crypto.randomUUID(), voice: prev[prev.length - 1]?.voice || 'Kore', style: '', text: '' }
    ]);
  };

  const updateScriptLine = (id: string, field: keyof ScriptLine, value: string) => {
    setScriptLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  };

  const removeScriptLine = (id: string) => {
    if (scriptLines.length <= 1) return;
    setScriptLines(prev => prev.filter(l => l.id !== id));
  };

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setBgMusicName(file.name);
    // Decode audio file to AudioBuffer
    try {
      const ctx = getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      setBgMusicBuffer(audioBuffer);
    } catch (error) {
      console.error("Failed to load background music:", error);
      setErrorMessage("Failed to load background music file.");
    }
  };

  const downloadAudio = async (item: GeneratedAudio, quality: AudioQuality) => {
    let bufferToExport = item.buffer;
    if (!bufferToExport) {
       const ctx = getAudioContext();
       bufferToExport = await loadAudioBufferFromDB(item.id, ctx);
       if (!bufferToExport) {
          setErrorMessage("Failed to load audio data for download.");
          return;
       }
    }
    const { blob, filename } = await exportAudio(bufferToExport, quality);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex flex-col items-center">
      
      {/* Header */}
      <header className="max-w-4xl w-full mb-8 flex flex-col md:flex-row items-center md:items-start space-y-4 md:space-y-0 md:space-x-6">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-lime-500 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          <div className="relative p-1 bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
            <img src="/midnight_pickle_logo.png" alt="Logo" className="w-20 h-20 object-cover rounded-xl" />
          </div>
        </div>
        <div className="text-center md:text-left">
          <h1 className="text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r from-lime-400 via-cyan-400 to-purple-500 tracking-tighter">
            MIDNIGHT PICKLE VOX
          </h1>
          <p className="text-slate-400 text-sm font-medium tracking-wide uppercase">Professional AI Text-to-Speech Generation</p>
        </div>
      </header>

      <main className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Controls Section */}
        <div className="space-y-6">
          <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700/50 backdrop-blur-sm">
            
            {/* Mode Selection */}
            <div className="flex bg-slate-950 rounded-lg p-1 mb-6 border border-slate-800">
              <button
                onClick={() => setMode('single')}
                className={`flex-1 text-sm font-bold py-2 rounded-md transition-all ${
                  mode === 'single' ? 'bg-lime-600 text-slate-950 shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                SOLO
              </button>
              <button
                onClick={() => setMode('conversation')}
                className={`flex-1 text-sm font-bold py-2 rounded-md transition-all ${
                  mode === 'conversation' ? 'bg-lime-600 text-slate-950 shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                DUO
              </button>
            </div>

            {mode === 'single' ? (
              <>
                {/* Voice Selection */}
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Voice Model</label>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                    {VOICES.map(v => (
                      <button
                        key={v}
                        onClick={() => setVoice(v)}
                        className={`px-3 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-tighter ${
                          voice === v 
                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/25 ring-2 ring-purple-400' 
                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style Selection */}
                <div className="mb-6">
                   <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Speaking Style</label>
                   <div className="flex flex-wrap gap-2 mb-3">
                     {STYLES.map(s => (
                       <button
                        key={s}
                        onClick={() => { setStyle(s); setCustomStyle(''); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                          style === s && !customStyle
                            ? 'bg-cyan-600 text-white' 
                            : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700 hover:text-slate-200'
                        }`}
                       >
                         {s}
                       </button>
                     ))}
                   </div>
                   <input
                    type="text"
                    placeholder="Or describe a custom style (e.g., 'Like a newscaster from the 1950s')"
                    value={customStyle}
                    onChange={(e) => setCustomStyle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all placeholder-slate-600"
                   />
                </div>

                {/* Text Input */}
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Script</label>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Enter the text you want the voice to speak..."
                    rows={5}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 text-base focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all resize-none placeholder-slate-600"
                  />
                </div>
              </>
            ) : (
              <div className="mb-6 space-y-4">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Conversation Script</label>
                {scriptLines.map((line, index) => (
                  <div key={line.id} className="bg-slate-900/50 p-4 rounded-xl border border-slate-700/80 relative group">
                    {scriptLines.length > 1 && (
                      <button 
                        onClick={() => removeScriptLine(line.id)}
                        className="absolute right-3 top-3 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <TrashIcon />
                      </button>
                    )}
                    <div className="flex flex-wrap gap-2 mb-3 pr-8">
                      <select 
                        value={line.voice}
                        onChange={(e) => updateScriptLine(line.id, 'voice', e.target.value)}
                        className="bg-slate-800 border border-slate-600 rounded-md text-sm px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none"
                      >
                        {VOICES.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <select
                        value={line.style}
                        onChange={(e) => updateScriptLine(line.id, 'style', e.target.value)}
                        className="bg-slate-800 border border-slate-600 rounded-md text-sm px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 outline-none flex-1 min-w-[120px]"
                      >
                        <option value="">Default Style</option>
                        {STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <textarea
                      value={line.text}
                      onChange={(e) => updateScriptLine(line.id, 'text', e.target.value)}
                      placeholder={`Speaker ${index + 1} text...`}
                      rows={2}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none placeholder-slate-500"
                    />
                  </div>
                ))}
                
                <button
                  onClick={addScriptLine}
                  className="w-full py-2.5 rounded-lg border-2 border-dashed border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-indigo-400 transition-colors text-sm font-medium flex items-center justify-center space-x-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                  <span>Add Next Line</span>
                </button>
              </div>
            )}

            {/* Background Audio */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Background Music (Optional)</label>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex flex-col space-y-3">
                <div className="flex items-center space-x-3">
                  <label className="flex-1 cursor-pointer bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-sm text-center text-slate-300 transition-colors">
                    <span>{bgMusicName || "Upload Audio File..."}</span>
                    <input 
                      type="file" 
                      accept="audio/*" 
                      onChange={handleBgUpload} 
                      className="hidden" 
                    />
                  </label>
                  {bgMusicBuffer && (
                    <button 
                      onClick={() => { setBgMusicBuffer(null); setBgMusicName(null); }}
                      className="p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-md transition-colors"
                      title="Remove background music"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
                
                {bgMusicBuffer && (
                  <div className="flex items-center space-x-3 px-1">
                    <span className="text-xs text-slate-500">Volume</span>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.05" 
                      value={bgMusicVolume} 
                      onChange={(e) => setBgMusicVolume(parseFloat(e.target.value))}
                      className="flex-1 accent-indigo-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="text-xs text-slate-400 font-mono w-8 text-right">
                      {Math.round(bgMusicVolume * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Action Button */}
            <div className="space-y-3">
              <button
                onClick={handleGenerate}
                disabled={isGenerating || (mode === 'single' ? !text.trim() : scriptLines.every(l => !l.text.trim()))}
                className={`w-full py-4 rounded-xl font-black text-slate-950 uppercase tracking-widest shadow-2xl transition-all flex items-center justify-center space-x-2 ${
                  isGenerating || (mode === 'single' ? !text.trim() : scriptLines.every(l => !l.text.trim()))
                    ? 'bg-slate-700 cursor-not-allowed text-slate-500'
                    : 'bg-gradient-to-r from-lime-500 to-lime-400 hover:from-lime-400 hover:to-lime-300 shadow-lime-500/20 active:scale-[0.98]'
                }`}
              >
                {isGenerating ? <><Spinner /> <span>Synthesizing...</span></> : <><span>Synthesize</span> <SparklesIcon /></>}
              </button>
              
              {errorMessage && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-200 text-center animate-pulse">
                  {errorMessage}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-200 flex items-center">
              Recent Generations <span className="ml-2 text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-400">{history.length}</span>
            </h2>
            {history.length > 0 && (
              <button 
                onClick={clearHistory}
                className="text-xs text-slate-400 hover:text-red-300 flex items-center space-x-1 transition-colors"
              >
                <TrashIcon /> <span>Clear All</span>
              </button>
            )}
          </div>
          
          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {history.length === 0 && (
              <div className="text-center py-12 text-slate-500 border-2 border-dashed border-slate-800 rounded-2xl">
                <p>No audio generated yet.</p>
                <p className="text-sm mt-1">Fill in the script and click generate.</p>
              </div>
            )}

            {history.map((item) => {
              const isPlaying = currentPlayingId === item.id;
              
              return (
                <div key={item.id} className={`bg-slate-800/80 backdrop-blur-sm rounded-xl p-4 border transition-all ${isPlaying ? 'border-lime-500/50 shadow-lg shadow-lime-900/20' : 'border-slate-700/50 hover:border-slate-600'}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-xs font-black text-lime-400 bg-lime-400/10 px-1.5 py-0.5 rounded uppercase tracking-wider">{item.voice}</span>
                        {item.style && <span className="text-xs text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded italic truncate max-w-[150px]">{item.style}</span>}
                      </div>
                      <p className="text-sm text-slate-300 line-clamp-2 leading-relaxed font-medium">{item.text}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                         onClick={(e) => removeHistoryItem(item.id, e)}
                         className="p-2.5 rounded-full text-slate-500 hover:text-red-400 hover:bg-slate-700/50 transition-colors flex-shrink-0"
                         title="Delete generation"
                      >
                         <TrashIcon />
                      </button>
                      <button
                        onClick={() => isPlaying ? stopAudio() : playAudio(item)}
                        className={`p-2.5 rounded-full transition-all flex-shrink-0 shadow-lg ${
                          isPlaying ? 'bg-lime-500 text-slate-950 scale-110' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        }`}
                      >
                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                      </button>
                    </div>
                  </div>

                  {/* Visualizer Area */}
                  <div className="h-16 w-full mb-3 rounded-lg overflow-hidden bg-slate-900/30 relative">
                     <WaveformVisualizer 
                        buffer={item.buffer} 
                        peaks={item.peaks}
                        isPlaying={isPlaying}
                        audioContext={audioContextRef.current}
                        analyser={analyserRef.current}
                        color={isPlaying ? "#84cc16" : "#334155"}
                     />
                  </div>

                  {/* Download Options */}
                  <div className="flex items-center justify-between border-t border-slate-700/50 pt-3 mt-1">
                    <span className="text-xs text-slate-500 font-medium">Download Format</span>
                    <div className="flex space-x-2">
                      <button 
                        onClick={() => downloadAudio(item, AudioQuality.HIGH_MP3)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-slate-300 transition-colors"
                        title="128kbps MP3"
                      >
                         <DownloadIcon /> <span>MP3 HQ</span>
                      </button>
                      <button 
                        onClick={() => downloadAudio(item, AudioQuality.LOW_MP3)}
                        className="flex items-center space-x-1 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700/80 rounded text-xs font-medium text-slate-400 transition-colors"
                        title="64kbps MP3"
                      >
                         <span>MP3 LQ</span>
                      </button>
                      <button 
                         onClick={() => downloadAudio(item, AudioQuality.HIGH_WAV)}
                         className="flex items-center space-x-1 px-3 py-1.5 bg-slate-700/50 hover:bg-slate-700/80 rounded text-xs font-medium text-slate-400 transition-colors"
                         title="Lossless WAV"
                      >
                         <span>WAV</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </main>
    </div>
  );
}

export default App;