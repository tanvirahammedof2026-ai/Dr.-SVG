/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Download, 
  Trash2, 
  Image as ImageIcon, 
  Settings2, 
  CheckCircle2, 
  AlertCircle,
  Copy,
  Plus,
  Upload,
  Layers,
  LayoutGrid,
  List,
  Check,
  X,
  Link as LinkIcon,
  Link2Off,
  Monitor,
  Maximize2,
  Stethoscope,
  Archive,
  LogIn,
  LogOut,
  User as UserIcon
} from 'lucide-react';
import confetti from 'canvas-confetti';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { svgToJpg, imageToJpg } from './lib/svg-utils';
import { sounds } from './lib/sounds';
import { auth, signInWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';

interface AssetSlot {
  id: string;
  type: 'svg' | 'image';
  code?: string;
  file?: File;
  name: string;
  originalWidth?: number;
  originalHeight?: number;
}

function SvgPreview({ code }: { code: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(code.trim(), 'image/svg+xml');
      const svgTag = doc.querySelector('svg');
      if (svgTag && !svgTag.getAttribute('xmlns')) {
        svgTag.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }
      const serialized = new XMLSerializer().serializeToString(doc);
      const blob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      setUrl(blobUrl);
      return () => URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Preview parsing failed', e);
    }
  }, [code]);

  if (!url) return null;

  return (
    <img 
      src={url} 
      alt="SVG Preview" 
      className="w-full h-full object-contain pointer-events-none drop-shadow-2xl"
    />
  );
}

export default function App() {
  const [rawInput, setRawInput] = useState('');
  const [resolution, setResolution] = useState(() => {
    const saved = localStorage.getItem('svg-flux-resolution');
    return saved ? JSON.parse(saved) : { width: 2048, height: 2048 };
  });
  const [showDimensions, setShowDimensions] = useState(true);
  const [targetSize, setTargetSize] = useState<number | null>(4); 
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);
  const [appStatus, setAppStatus] = useState('BOOTING...');
  const [isResizeOpen, setIsResizeOpen] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [aspectRatio, setAspectRatio] = useState(1);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem('svg-flux-resolution', JSON.stringify(resolution));
  }, [resolution]);

  const updateWidth = (w: number) => {
    if (isLocked) {
      setResolution({ width: w, height: Math.round(w / aspectRatio) });
    } else {
      setResolution(p => ({ ...p, width: w }));
    }
  };

  const updateHeight = (h: number) => {
    if (isLocked) {
      setResolution({ width: Math.round(h * aspectRatio), height: h });
    } else {
      setResolution(p => ({ ...p, height: h }));
    }
  };

  useEffect(() => {
    if (!isLocked) {
      setAspectRatio(resolution.width / resolution.height);
    }
  }, [resolution, isLocked]);

  useEffect(() => {
    const timer = setTimeout(() => setAppStatus('READY'), 2000);
    return () => clearTimeout(timer);
  }, []);
  const [useTargetSize, setUseTargetSize] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showSuccess, setShowSuccess] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<AssetSlot[]>([]);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presets = [
    { name: '4K', w: 3840, h: 2160 },
    { name: '2K', w: 2048, h: 2048 },
    { name: 'HD', w: 1920, h: 1080 },
    { name: 'SQ', w: 1024, h: 1024 },
  ];

  const handlePreset = (w: number, h: number) => {
    setResolution({ width: w, height: h });
    setAspectRatio(w / h);
  };

  // Extract SVG from text
  const textSvgs = React.useMemo(() => {
    if (!rawInput.trim()) return [];
    const svgRegex = /<svg[\s\S]*?<\/svg>/gi;
    const matches = rawInput.match(svgRegex) || [];
    return matches.map((code, index) => {
      let originalWidth = 0;
      let originalHeight = 0;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(code.trim(), 'image/svg+xml');
        const svgTag = doc.querySelector('svg');
        if (svgTag) {
          originalWidth = parseFloat(svgTag.getAttribute('width') || '0');
          originalHeight = parseFloat(svgTag.getAttribute('height') || '0');
          if (!originalWidth && !originalHeight && svgTag.viewBox.baseVal) {
            originalWidth = svgTag.viewBox.baseVal.width;
            originalHeight = svgTag.viewBox.baseVal.height;
          }
        }
      } catch (e) {}

      return {
        id: `text-svg-${index}`,
        type: 'svg' as const,
        code: code.trim(),
        name: `extracted_svg_${index + 1}`,
        originalWidth,
        originalHeight
      };
    });
  }, [rawInput]);

  useEffect(() => {
    if (textSvgs.length > 0 && uploadedFiles.length === 0) {
      const first = textSvgs[0];
      if (first.originalWidth && first.originalHeight) {
        setResolution({ width: Math.round(first.originalWidth * 2), height: Math.round(first.originalHeight * 2) });
        setAspectRatio(first.originalWidth / first.originalHeight);
      }
    }
  }, [textSvgs]);

  useEffect(() => {
    if ((textSvgs.length > 0 || uploadedFiles.length > 0) && !isProcessing) {
      // Trigger confetti when assets are detected/uploaded
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#ffffff', '#22d3ee']
      });
    }
  }, [textSvgs.length, uploadedFiles.length, isProcessing]);

  const allAssets = [...textSvgs, ...uploadedFiles];
  const visibleAssets = allAssets.filter(asset => !completedIds.has(asset.id));

  const clearAll = useCallback(() => {
    sounds.play('error');
    setRawInput('');
    setUploadedFiles([]);
    setCompletedIds(new Set());
    setDownloadProgress(0);
    setZipBlob(null);
    
    // Red confetti for "purge" action
    confetti({
      particleCount: 150,
      spread: 120,
      origin: { y: 0.6 },
      colors: ['#ef4444', '#7f1d1d', '#000000']
    });
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const newAssets: AssetSlot[] = files.map((file, i) => ({
      id: `file-${Date.now()}-${i}`,
      type: (file.type.includes('svg') || file.name.endsWith('.svg')) ? 'svg' : 'image',
      file: file,
      name: file.name.split('.')[0].replace(/\s+/g, '_'), // Clean filenames
      code: (file.type.includes('svg') || file.name.endsWith('.svg')) ? '' : undefined,
      originalWidth: 0,
      originalHeight: 0
    }));

    // Detect dimensions
    newAssets.forEach(asset => {
      if (asset.file) {
        if (asset.type === 'svg') {
          const reader = new FileReader();
          reader.onload = (event) => {
            const code = event.target?.result as string;
            let ow = 0, oh = 0;
            try {
              const parser = new DOMParser();
              const doc = parser.parseFromString(code.trim(), 'image/svg+xml');
              const svgTag = doc.querySelector('svg');
              if (svgTag) {
                ow = parseFloat(svgTag.getAttribute('width') || '0');
                oh = parseFloat(svgTag.getAttribute('height') || '0');
                if (!ow && !oh && svgTag.viewBox.baseVal) {
                  ow = svgTag.viewBox.baseVal.width;
                  oh = svgTag.viewBox.baseVal.height;
                }
              }
            } catch (e) {}
            setUploadedFiles(prev => prev.map(a => a.id === asset.id ? { ...a, code, originalWidth: ow, originalHeight: oh } : a));
            
            // Auto-set resolution and aspect ratio
            if (ow > 100 && oh > 100) {
              setResolution({ width: Math.round(ow * 2), height: Math.round(oh * 2) });
              setAspectRatio(ow / oh);
            }
          };
          reader.readAsText(asset.file);
        } else {
          const img = new Image();
          const url = URL.createObjectURL(asset.file);
          img.onload = () => {
            setUploadedFiles(prev => prev.map(a => a.id === asset.id ? { ...a, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight } : a));
            if (img.naturalWidth > 100) {
              setResolution({ width: img.naturalWidth, height: img.naturalHeight });
              setAspectRatio(img.naturalWidth / img.naturalHeight);
            }
            URL.revokeObjectURL(url);
          };
          img.src = url;
        }
      }
    });

    setUploadedFiles(prev => [...prev, ...newAssets]);
    sounds.play('success');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (asZip: boolean = false) => {
    if (visibleAssets.length === 0) return;

    sounds.play('click');
    setIsProcessing(true);
    setDownloadProgress(0);
    setCompletedIds(new Set());
    setZipBlob(null);
    abortRef.current = false;

    const zip = asZip ? new JSZip() : null;

    try {
      const currentBatch = [...visibleAssets];
      const concurrencyLimit = 40; // Increased concurrency for turbo speed
      
      for (let i = 0; i < currentBatch.length; i += concurrencyLimit) {
        if (abortRef.current) break;

        const chunk = currentBatch.slice(i, i + concurrencyLimit);
        
        await Promise.all(chunk.map(async (item) => {
          if (abortRef.current) return;
          
          let blob: Blob;
          
          try {
            if (item.type === 'svg' && item.code) {
              blob = await svgToJpg(
                item.code, 
                resolution.width, 
                resolution.height,
                useTargetSize ? (targetSize || 4) : undefined
              );
            } else if (item.file) {
              blob = await imageToJpg(
                item.file,
                resolution.width,
                resolution.height,
                useTargetSize ? (targetSize || 4) : undefined
              );
            } else {
              return;
            }

            if (zip) {
              zip.file(`${item.name}.jpg`, blob);
            } else {
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${item.name}.jpg`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              setTimeout(() => URL.revokeObjectURL(url), 10000);
            }

            setCompletedIds(prev => new Set(prev).add(item.id));
          } catch (err) {
            console.error(`Unit processing failed [${item.name}]:`, err);
          }
        }));

        setDownloadProgress(Math.round(((i + chunk.length) / currentBatch.length) * 100));
        // Removed artificial delay for 100x speed
      }

      if (!abortRef.current) {
        if (zip) {
          const content = await zip.generateAsync({ type: 'blob' });
          setZipBlob(content);
          saveAs(content, `dr_svg_batch_${Date.now()}.zip`);
        }
        
        sounds.play('success');
        setShowSuccess(true);
        confetti({
          particleCount: 200,
          spread: 120,
          origin: { y: 0.5 },
          colors: ['#06b6d4', '#ffffff', '#22d3ee', '#083344']
        });
      }
    } catch (error) {
      console.error('Batch processing failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const stopProcessing = () => {
    abortRef.current = true;
    setIsProcessing(false);
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      className="flex flex-col min-h-screen bg-bg-main text-slate-400 font-sans selection:bg-brand/30 selection:text-white"
    >
      {/* Global Status HUD */}
      <AnimatePresence>
        {isProcessing && (
          <motion.div 
            initial={{ y: 50, opacity: 0, x: '-50%' }}
            animate={{ y: 0, opacity: 1, x: '-50%' }}
            exit={{ y: 50, opacity: 0, x: '-50%' }}
            className="fixed bottom-10 left-1/2 -translate-x-1/2 h-14 w-[95%] max-w-md bg-zinc-950/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-[0_30px_90px_rgba(0,0,0,1),0_0_20px_rgba(6,182,212,0.1)] z-[200] flex items-center px-6 gap-5 overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-brand/50 to-transparent" />
            
            <div className="flex flex-col shrink-0 min-w-[60px]">
               <span className="text-[7px] font-black text-brand uppercase tracking-[0.3em] leading-none mb-1.5 animate-pulse">Processing</span>
               <span className="text-[12px] text-white font-mono font-bold leading-none">{downloadProgress}%</span>
            </div>
            
            <div className="flex-1 h-1.5 bg-zinc-900/50 rounded-full overflow-hidden relative border border-white/5">
              <motion.div 
                className="absolute inset-y-0 left-0 bg-brand shadow-[0_0_15px_rgba(6,182,212,0.8)]"
                initial={{ width: 0 }}
                animate={{ width: `${downloadProgress}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>

            <motion.button 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                sounds.play('error');
                abortRef.current = true;
              }}
              className="text-red-500/50 hover:text-red-500 text-[9px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 px-3 py-1.5 bg-red-500/5 rounded-lg border border-red-500/10"
            >
              <X size={10} strokeWidth={4} />
              Abort
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Resize Configuration Portal */}
      <AnimatePresence>
        {isResizeOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-zinc-950 border border-brand/30 rounded-3xl p-6 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand to-transparent opacity-50" />
              
              <div className="flex items-center justify-between mb-8">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-brand uppercase tracking-widest">Dimension Matrix</span>
                  <span className="text-[8px] text-zinc-500 font-bold uppercase">Manual Resolution Override</span>
                </div>
                <motion.button 
                  whileHover={{ rotate: 90, scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    sounds.play('click');
                    setIsResizeOpen(false);
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={16} />
                </motion.button>
              </div>

              <div className="space-y-6">
                {/* Custom Resolution */}
                <div className="space-y-3">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Pixel Density</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <span className="text-[8px] text-zinc-600 font-bold uppercase ml-1">Width</span>
                      <input 
                        type="number" 
                        value={resolution.width}
                        onChange={(e) => updateWidth(parseInt(e.target.value) || 0)}
                        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:border-brand outline-none transition-all font-mono"
                      />
                    </div>
                    <div className="pt-6 flex flex-col items-center gap-1">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          sounds.play('click');
                          setIsLocked(!isLocked);
                        }}
                        className={`p-2 rounded-lg transition-colors ${isLocked ? 'text-brand bg-brand/10' : 'text-zinc-600 bg-zinc-900'}`}
                      >
                        {isLocked ? <LinkIcon size={14} /> : <Link2Off size={14} />}
                      </motion.button>
                    </div>
                    <div className="flex-1 space-y-1">
                      <span className="text-[8px] text-zinc-600 font-bold uppercase ml-1">Height</span>
                      <input 
                        type="number" 
                        value={resolution.height}
                        onChange={(e) => updateHeight(parseInt(e.target.value) || 0)}
                        className="w-full bg-black border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white focus:border-brand outline-none transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Mass Scale */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Target Mass Scale</label>
                    <motion.button 
                      onClick={() => setUseTargetSize(!useTargetSize)}
                      className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${useTargetSize ? 'bg-brand/20 text-brand' : 'bg-zinc-900 text-zinc-600'}`}
                    >
                      {useTargetSize ? 'Active' : 'Bypass'}
                    </motion.button>
                  </div>
                  <div className={`space-y-4 transition-all ${!useTargetSize ? 'opacity-20 pointer-events-none grayscale' : ''}`}>
                    <input 
                      type="range"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={targetSize || 4}
                      onChange={(e) => setTargetSize(parseFloat(e.target.value))}
                      className="w-full h-1 bg-zinc-900 rounded-full appearance-none accent-brand cursor-pointer"
                    />
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 5, 10].map(s => (
                        <motion.button 
                          key={s}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setTargetSize(s)}
                          className={`flex-1 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all ${targetSize === s ? 'bg-brand/10 border-brand/50 text-brand' : 'bg-black/40 border-white/5 text-zinc-600'}`}
                        >
                          {s}MB
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <motion.button 
                whileHover={{ scale: 1.02, backgroundColor: 'rgba(6,182,212,1)', color: '#000' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  sounds.play('success');
                  setIsResizeOpen(false);
                }}
                className="w-full mt-8 py-4 bg-zinc-900 border border-brand/40 text-brand font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all"
              >
                Engage Matrix Settings
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-3xl bg-black/90"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              className="glass-panel p-8 rounded-[2rem] max-w-sm w-full text-center shadow-[0_0_100px_rgba(6,182,212,0.15)] ring-1 ring-white/10 relative overflow-hidden"
            >
              <div className="absolute top-4 left-4 flex flex-col gap-0.5 items-start">
                <span className="text-[8px] font-black text-brand italic uppercase">CONVERTER LOADED</span>
                <span className="text-[7px] font-bold text-zinc-600 tracking-[0.2em]">{appStatus}</span>
              </div>
              
              <div className="w-16 h-16 bg-brand/10 text-brand rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-inner shadow-brand/20">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1, rotate: 360 }}
                  transition={{ type: 'spring', damping: 10, stiffness: 100 }}
                >
                  <Check size={32} strokeWidth={3} />
                </motion.div>
              </div>
              <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">System Purge Complete</h3>
              <p className="text-slate-500 text-[12px] mb-8 font-medium leading-relaxed italic">The synthetic rasterization of your data units has reached equilibrium. All assets exported.</p>
              
              <div className="flex flex-col gap-2">
                {zipBlob && (
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      sounds.play('success');
                      saveAs(zipBlob, `dr_svg_batch_${Date.now()}.zip`);
                    }}
                    className="w-full py-3 bg-white/5 border border-white/10 text-white font-black uppercase tracking-widest rounded-xl hover:bg-white/10 transition-all flex items-center justify-center gap-2 text-[10px]"
                  >
                    <Archive size={14} />
                    Download ZIP Again
                  </motion.button>
                )}
                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    sounds.play('click');
                    setShowSuccess(false);
                    setRawInput('');
                    setUploadedFiles([]);
                    setCompletedIds(new Set());
                    setZipBlob(null);
                  }}
                  className="w-full py-4 bg-brand text-black font-black uppercase tracking-widest rounded-xl hover:bg-cyan-400 shadow-xl shadow-brand/20 text-[11px]"
                >
                  Reset Workload
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <nav className="h-14 border-b border-white/5 flex items-center justify-between px-6 sm:px-10 bg-bg-main/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <motion.div 
            whileHover={{ rotate: 15, scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => sounds.play('hover')}
            className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.3)] shrink-0 cursor-pointer"
          >
            <Stethoscope size={18} className="text-black" strokeWidth={2.5} />
          </motion.div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-black tracking-tighter text-white uppercase italic">DR. <span className="text-brand">SVG</span></span>
            <span className="text-[8px] text-zinc-600 font-bold tracking-[0.3em] uppercase mt-1">Unified Synthesis Hub</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 sm:gap-6">
          {user ? (
            <div className="flex items-center gap-3 sm:gap-4 pl-4 border-l border-white/5">
              <div className="flex flex-col items-end leading-none hidden sm:flex">
                <span className="text-[10px] font-black text-white uppercase tracking-tight">{user.displayName}</span>
                <span className="text-[7px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">Verified Operator</span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  sounds.play('click');
                  logout();
                }}
                className="w-8 h-8 rounded-full border border-white/10 overflow-hidden relative group cursor-pointer"
              >
                <img src={user.photoURL || ''} alt="Profile" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <LogOut size={12} className="text-white" />
                </div>
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                sounds.play('click');
                signInWithGoogle();
              }}
              className="px-4 py-1.5 bg-brand text-black text-[10px] font-black uppercase tracking-widest rounded-full hover:shadow-[0_0_15px_rgba(6,182,212,0.4)] flex items-center gap-2"
            >
              <LogIn size={12} strokeWidth={3} />
              <span>Sign In</span>
            </motion.button>
          )}

          <div className="hidden md:flex items-center gap-3 px-3 py-1.5 bg-white/5 rounded-full border border-white/5">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isProcessing ? 'bg-orange-500 animate-pulse' : 'bg-brand'} shadow-[0_0_8px_rgba(6,182,212,0.5)]`} />
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">
                {isProcessing ? 'Synthesis engaged' : 'Engine Ready'}
              </span>
            </div>
          </div>
          <span className="px-2 py-1 rounded bg-zinc-900 border border-white/5 text-[7px] text-zinc-600 tracking-widest font-black hidden sm:block uppercase">v2.5_QUANTUM</span>
        </div>
      </nav>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Main Input Section */}
        <section className="w-full lg:w-[360px] border-b lg:border-b-0 lg:border-r border-white/5 bg-bg-sub/30 flex flex-col h-[300px] lg:h-auto overflow-hidden">
          <div className="p-4 px-6 border-b border-white/5 flex items-center justify-between bg-white/[0.01]">
            <h2 className="text-[9px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-2">
              <Plus size={10} className="text-brand" />
              Source Stream
            </h2>
            {visibleAssets.length > 0 && (
              <motion.div 
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="text-[8px] font-black text-brand bg-brand/5 border border-brand/20 px-2 py-0.5 rounded-full uppercase italic"
              >
                {visibleAssets.length} Units
              </motion.div>
            )}
          </div>
          
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4">
               <motion.button 
                whileHover={{ scale: 1.02, borderColor: 'rgba(6,182,212,0.4)', backgroundColor: 'rgba(6,182,212,0.02)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  sounds.play('click');
                  fileInputRef.current?.click();
                }}
                className="w-full py-6 bg-zinc-950/40 border-2 border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center gap-2 group relative overflow-hidden transition-all shadow-inner"
               >
                 <Upload size={18} className="text-zinc-600 transition-transform group-hover:-translate-y-0.5 group-hover:text-brand" />
                 <div className="flex flex-col items-center">
                    <span className="text-[10px] font-black uppercase text-slate-400 group-hover:text-white mb-0.5">Ingest Local Assets</span>
                    <span className="text-[7px] text-zinc-700 uppercase font-black tracking-[0.3em]">LOAD STREAM</span>
                 </div>
               </motion.button>
               <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                className="hidden" 
                multiple 
                accept=".svg,.png,.jpg,.jpeg,.webp" 
               />
            </div>
            <div className="px-4 pb-4 flex-1 flex flex-col relative overflow-hidden">
              <div className="text-[8px] font-black text-zinc-700 uppercase tracking-[0.3em] mb-1.5 ml-1">TERMINAL: RAW_BUFFER</div>
              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste code streams here..."
                spellCheck={false}
                className="flex-1 w-full bg-black/60 rounded-xl border border-white/5 p-4 text-[10px] font-mono text-zinc-600 focus:outline-none focus:ring-1 focus:ring-brand/20 resize-none transition-all placeholder:text-zinc-800 custom-scrollbar leading-relaxed"
              />
            </div>
          </div>
        </section>

        {/* Dynamic Preview Section */}
        <section className="flex-1 flex flex-col p-4 sm:p-8 bg-bg-main overflow-hidden relative">
          <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between gap-4 mb-6">
            <div className="flex flex-col">
              <h2 className="text-[10px] font-black text-white/40 uppercase tracking-[0.4em] mb-1.5 flex items-center gap-2.5">
                <ImageIcon size={12} className="text-brand" />
                Synthesis Surface
              </h2>
              <p className="text-[11px] text-zinc-600 font-bold tracking-tight italic">Localized assets ready for conversion.</p>
            </div>
            <div className="flex bg-black/40 rounded-lg p-0.5 border border-white/5 shadow-inner ring-1 ring-white/5">
               <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  sounds.play('click');
                  setViewMode('grid');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${viewMode === 'grid' ? 'bg-brand text-black font-black' : 'text-zinc-600 hover:text-zinc-400'}`}
               >
                 <LayoutGrid size={12} />
                 <span className="text-[8px] uppercase font-black">Nexus</span>
               </motion.button>
               <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  sounds.play('click');
                  setViewMode('list');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${viewMode === 'list' ? 'bg-brand text-black font-black' : 'text-zinc-600 hover:text-zinc-400'}`}
               >
                 <List size={12} />
                 <span className="text-[8px] uppercase font-black">Stream</span>
               </motion.button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-64">
            <div className="flex items-center justify-between mb-4 px-1">
               <div className="flex items-center gap-2">
                 <span className="text-[8px] font-black text-zinc-800 uppercase tracking-[0.3em]">WORK_AREA_PROTOCOL</span>
                 <div className="h-[1px] w-8 bg-white/5" />
                 <span className="text-[9px] font-bold text-zinc-700 italic uppercase">{visibleAssets.length} Detection Hits</span>
               </div>
               {allAssets.length > 0 && (
                 <motion.button 
                  whileHover={{ scale: 1.02, backgroundColor: 'rgba(239, 68, 68, 0.2)' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={clearAll}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500/80 transition-all border border-red-500/20 group hover:text-white"
                 >
                   <Trash2 size={12} className="group-hover:rotate-12 transition-transform" />
                   <span className="text-[8px] font-black uppercase tracking-widest">Purge</span>
                 </motion.button>
               )}
            </div>

            <div className={viewMode === 'grid' 
              ? "grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 xl:grid-cols-8 gap-3" 
              : "flex flex-col gap-2.5"
            }>
              <AnimatePresence mode="popLayout" initial={false}>
                {visibleAssets.map((item, i) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8, y: 20 }}
                    animate={{ 
                      opacity: 1, 
                      scale: 1,
                      y: 0,
                      transition: { delay: i * 0.015, duration: 0.25 }
                    }}
                    exit={{ 
                      opacity: 0, 
                      scale: 0.85, 
                      transition: { duration: 0.15 } 
                    }}
                    className={`${
                      viewMode === 'grid' 
                      ? 'aspect-square flex-col' 
                      : 'w-full h-16 sm:h-20 flex-row'
                    } bg-zinc-950/40 border border-white/5 rounded-2xl flex items-center justify-center relative overflow-hidden group/card hover:border-brand/40 hover:bg-zinc-900/60 transition-all cursor-default shadow-lg p-3`}
                  >
                    <div className="absolute top-2 left-2 text-[7px] font-black bg-zinc-950/90 text-zinc-600 px-1.5 py-0.5 rounded-full uppercase z-10 border border-white/5 italic">
                      ID_{String(i + 1).padStart(3, '0')}
                    </div>
                    
                    <div className={`${viewMode === 'grid' ? 'w-4/5 h-4/5' : 'w-12 h-12 sm:w-16 sm:h-16'} flex items-center justify-center transform group-hover/card:scale-110 transition-transform duration-700 pointer-events-none shrink-0`}>
                      {item.type === 'svg' && (item.code || item.file) ? (
                        <div className="w-full h-full flex flex-col items-center justify-center overflow-hidden">
                          {item.code ? (
                            <SvgPreview code={item.code} />
                          ) : (
                            <div className="text-[9px] text-zinc-700 font-black animate-pulse uppercase italic">Analyzing...</div>
                          )}
                          {(item.originalWidth || item.originalHeight) && (
                            <div className="absolute bottom-2 left-0 right-0 px-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
                              <div className="bg-black/95 backdrop-blur-md rounded-lg py-1 text-[7px] font-mono text-brand border border-white/10 shadow-2xl text-center uppercase tracking-[0.2em]">
                                {Math.round(item.originalWidth || 0)} × {Math.round(item.originalHeight || 0)}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-full h-full glass-panel rounded-2xl flex items-center justify-center overflow-hidden p-1.5">
                           {item.file ? (
                             <img 
                               src={URL.createObjectURL(item.file)} 
                               className="w-full h-full object-contain opacity-40 group-hover:opacity-100 transition-opacity" 
                               onLoad={(e) => URL.revokeObjectURL((e.target as any).src)}
                              />
                           ) : (
                             <ImageIcon size={20} className="text-zinc-800" />
                           )}
                        </div>
                      )}
                    </div>

                    {viewMode === 'list' && (
                      <div className="flex-1 ml-6 flex flex-col justify-center">
                         <div className="text-[12px] font-black text-white uppercase tracking-wider mb-1 flex items-center gap-3">
                           {item.name}
                           <span className="text-[8px] px-2 py-0.5 bg-brand/10 text-brand rounded-full border border-brand/20 italic font-black uppercase tracking-widest">{item.type} SOURCE</span>
                         </div>
                         <div className="text-[9px] text-slate-500 font-bold flex gap-6 italic">
                           {item.originalWidth && item.originalHeight ? (
                             <span className="flex items-center gap-2"><div className="w-1 h-1 bg-brand/40 rounded-full" />SOURCE RES: {Math.round(item.originalWidth)} × {Math.round(item.originalHeight)}</span>
                           ) : (
                             <span className="text-zinc-700 italic border-l border-zinc-800 pl-3">PENDING_METRICS</span>
                           )}
                           <span className="flex items-center gap-2"><div className="w-1 h-1 bg-green-500/40 rounded-full" />RASTER_READY</span>
                         </div>
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-brand/5 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none" />
                  </motion.div>
                ))}
                               {visibleAssets.length === 0 && !isProcessing && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="col-span-full py-32 flex flex-col items-center justify-center text-center p-6 border-2 border-dashed border-zinc-900 rounded-[2.5rem]"
                  >
                     <div className="w-16 h-16 rounded-full bg-zinc-900/50 flex items-center justify-center mb-6 border border-white/5 shadow-inner">
                        <Monitor size={24} className="text-zinc-800" />
                     </div>
                     <h3 className="text-zinc-700 font-black uppercase tracking-[0.3em] mb-2 text-[11px] italic">Synthesis Pending</h3>
                     <p className="text-[9px] text-zinc-800 font-bold uppercase max-w-[200px] leading-relaxed">System awaiting source unit ingestion into the streaming buffer.</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* HUD Controller */}
          <section className="bg-bg-main/60 backdrop-blur-2xl border-t border-white/5 p-5 relative z-30">
            <div className="max-w-screen-xl mx-auto flex flex-col lg:flex-row items-center gap-6">
              
              <div className="flex-1 flex items-center justify-center lg:justify-start gap-8">
                {/* Active Parameters HUD */}
                <div className="flex items-center gap-6">
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1">Current Matrix</span>
                    <span className="text-[10px] font-mono text-white/80">{resolution.width} × {resolution.height}</span>
                  </div>
                  <div className="w-px h-6 bg-zinc-900" />
                  <div className="flex flex-col">
                    <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1">Mass Scale</span>
                    <span className="text-[10px] font-mono text-white/80">{useTargetSize ? `${targetSize?.toFixed(1)}MB` : 'BYPASS'}</span>
                  </div>
                </div>

                {/* Central Resize Trigger */}
                <motion.button 
                  whileHover={{ scale: 1.05, backgroundColor: 'rgba(6,182,212,0.1)' }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    sounds.play('click');
                    setIsResizeOpen(true);
                  }}
                  className="px-6 py-2 bg-zinc-900 border border-brand/30 rounded-xl flex items-center gap-2.5 transition-all group shadow-xl"
                >
                  <Maximize2 size={14} className="text-brand group-hover:rotate-90 transition-transform" />
                  <span className="text-[9px] font-black uppercase text-white tracking-[0.2em]">Resize Matrix</span>
                </motion.button>
              </div>

              <div className="flex gap-2 w-full lg:w-auto">
                <motion.button 
                  whileHover={{ scale: 1.02, backgroundColor: 'rgba(255,255,255,0.06)' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleDownload(true)}
                  disabled={isProcessing || visibleAssets.length === 0}
                  className="flex-1 lg:w-36 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all font-black text-[9px] uppercase tracking-widest bg-white/5 border border-white/10 text-white disabled:opacity-20 disabled:grayscale"
                >
                  <Archive size={14} strokeWidth={2.5} />
                  <span>ZIP BATCH</span>
                </motion.button>

                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => handleDownload(false)}
                  disabled={isProcessing || visibleAssets.length === 0}
                  className={`flex-[2] lg:w-48 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all font-black text-[10px] uppercase tracking-widest shrink-0 ${
                    isProcessing || visibleAssets.length === 0
                    ? 'bg-zinc-900 text-zinc-700 cursor-not-allowed border border-white/5'
                    : 'bg-brand text-black hover:shadow-[0_0_20px_rgba(6,182,212,0.4)] shadow-lg'
                  }`}
                >
                  {isProcessing ? (
                    <div className="flex items-center gap-2">
                       <div className="w-2.5 h-2.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                       <span>PROCESSING</span>
                    </div>
                  ) : (
                    <>
                      <Download size={14} strokeWidth={2.5} />
                      <span>EXPORT UNITS</span>
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </section>
        </section>
      </main>

      {/* Global Status Footer */}
      <footer className="h-10 border-t border-white/10 flex items-center justify-between px-8 bg-zinc-950/80 text-[8px] uppercase tracking-[0.3em] font-black text-zinc-600">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse shadow-[0_0_5px_rgba(6,182,212,0.5)]" />
            SYNTH_ENGINE_ACTIVE
          </div>
          <div className="hidden sm:block">LOCAL_LATENCY: 0.04ms</div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-zinc-800 font-bold hidden lg:inline select-none tracking-widest">AUTHORIZED_TERMINAL_ACCESS_ONLY</span>
        </div>
      </footer>
    </motion.div>
  );
}

