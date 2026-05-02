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
  User as UserIcon,
  Zap,
  Volume2,
  VolumeX
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
  const [audioEnabled, setAudioEnabled] = useState(true);

  const triggerSound = useCallback((type: Parameters<typeof sounds.play>[0]) => {
    if (audioEnabled) sounds.play(type);
  }, [audioEnabled]);

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
        colors: ['#2563eb', '#ffffff', '#60a5fa']
      });
    }
  }, [textSvgs.length, uploadedFiles.length, isProcessing]);

  const allAssets = [...textSvgs, ...uploadedFiles];
  const visibleAssets = allAssets.filter(asset => !completedIds.has(asset.id));

  const clearAll = useCallback(() => {
    triggerSound('error');
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
    triggerSound('success');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownload = async (asZip: boolean = false) => {
    if (visibleAssets.length === 0) return;

    triggerSound('click');
    setIsProcessing(true);
    setDownloadProgress(0);
    setCompletedIds(new Set());
    setZipBlob(null);
    abortRef.current = false;
    
    triggerSound('powerup');

    const zip = asZip ? new JSZip() : null;
    const lastTick = { current: 0 };
    let processedCount = 0;
    const totalCount = visibleAssets.length;

    try {
      const currentBatch = [...visibleAssets];
      const concurrencyLimit = 10; 
      
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
            
            // Per-file progress update
            processedCount++;
            const nextProgress = Math.round((processedCount / totalCount) * 100);
            setDownloadProgress(nextProgress);
            
            if (nextProgress >= 25 && lastTick.current < 25) { triggerSound('tick'); lastTick.current = 25; }
            if (nextProgress >= 50 && lastTick.current < 50) { triggerSound('tick'); lastTick.current = 50; }
            if (nextProgress >= 75 && lastTick.current < 75) { triggerSound('tick'); lastTick.current = 75; }
          } catch (err) {
            console.error(`Unit processing failed [${item.name}]:`, err);
          }
        }));
      }

      if (!abortRef.current) {
        if (zip) {
          const content = await zip.generateAsync({ type: 'blob' });
          setZipBlob(content);
          saveAs(content, `dr_svg_batch_${Date.now()}.zip`);
        }
        
        triggerSound('chime');
        setShowSuccess(true);
        confetti({
          particleCount: 200,
          spread: 120,
          origin: { y: 0.5 },
          colors: ['#2563eb', '#ffffff', '#60a5fa', '#1d4ed8']
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
      className="flex flex-col min-h-screen bg-bg-main text-slate-600 font-sans selection:bg-brand/10 selection:text-brand"
    >


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
              className="w-full max-w-sm bg-white border border-brand/20 rounded-3xl p-6 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-brand to-transparent opacity-50" />
              
              <div className="flex items-center justify-between mb-8">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black text-brand uppercase tracking-widest">Dimension Matrix</span>
                  <span className="text-[8px] text-slate-400 font-bold uppercase">Manual Resolution Override</span>
                </div>
                <motion.button 
                  whileHover={{ rotate: 90, scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    triggerSound('click');
                    setIsResizeOpen(false);
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-50 border border-slate-200 text-slate-400 hover:text-brand transition-colors"
                >
                  <X size={16} />
                </motion.button>
              </div>

              <div className="space-y-6">
                {/* Custom Resolution */}
                <div className="space-y-3">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Pixel Density</label>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1">
                      <span className="text-[8px] text-slate-400 font-bold uppercase ml-1">Width</span>
                      <input 
                        type="number" 
                        value={resolution.width}
                        onChange={(e) => updateWidth(parseInt(e.target.value) || 0)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-900 focus:border-brand outline-none transition-all font-mono"
                      />
                    </div>
                    <div className="pt-6 flex flex-col items-center gap-1">
                      <motion.button
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                        onClick={() => {
                          triggerSound('click');
                          setIsLocked(!isLocked);
                        }}
                        className={`p-2 rounded-lg transition-colors ${isLocked ? 'text-brand bg-brand/10' : 'text-slate-300 bg-slate-100'}`}
                      >
                        {isLocked ? <LinkIcon size={14} /> : <Link2Off size={14} />}
                      </motion.button>
                    </div>
                    <div className="flex-1 space-y-1">
                      <span className="text-[8px] text-slate-400 font-bold uppercase ml-1">Height</span>
                      <input 
                        type="number" 
                        value={resolution.height}
                        onChange={(e) => updateHeight(parseInt(e.target.value) || 0)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-900 focus:border-brand outline-none transition-all font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Mass Scale */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Target Mass Scale</label>
                    <motion.button 
                      onClick={() => setUseTargetSize(!useTargetSize)}
                      className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${useTargetSize ? 'bg-brand/10 text-brand' : 'bg-slate-100 text-slate-400'}`}
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
                      className="w-full h-1 bg-slate-100 rounded-full appearance-none accent-brand cursor-pointer"
                    />
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 5, 10].map(s => (
                        <motion.button 
                          key={s}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => setTargetSize(s)}
                          className={`flex-1 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all ${targetSize === s ? 'bg-brand/10 border-brand/30 text-brand' : 'bg-white border-slate-100 text-slate-400'}`}
                        >
                          {s}MB
                        </motion.button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <motion.button 
                whileHover={{ scale: 1.02, backgroundColor: '#1d4ed8' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  triggerSound('success');
                  setIsResizeOpen(false);
                }}
                className="w-full mt-8 py-4 bg-brand text-white font-black uppercase tracking-widest text-[11px] rounded-2xl transition-all shadow-lg shadow-brand/20"
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
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-3xl bg-slate-900/40"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 30, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.9, y: 30, opacity: 0 }}
              className="glass-panel p-8 rounded-[2rem] max-w-sm w-full text-center shadow-[0_0_100px_rgba(37,99,235,0.1)] ring-1 ring-slate-200/50 relative overflow-hidden"
            >
              <div className="absolute top-4 left-4 flex flex-col gap-0.5 items-start">
                <span className="text-[8px] font-black text-brand italic uppercase">CONVERTER LOADED</span>
                <span className="text-[7px] font-bold text-slate-400 tracking-[0.2em]">{appStatus}</span>
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
              <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">System Purge Complete</h3>
              <p className="text-slate-500 text-[12px] mb-8 font-medium leading-relaxed italic">The synthetic rasterization of your data units has reached equilibrium. All assets exported.</p>
              
              <div className="flex flex-col gap-2">
                {zipBlob && (
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      triggerSound('success');
                      saveAs(zipBlob, `dr_svg_batch_${Date.now()}.zip`);
                    }}
                    className="w-full py-3 bg-slate-50 border border-slate-200 text-slate-900 font-black uppercase tracking-widest rounded-xl hover:bg-slate-100 transition-all flex items-center justify-center gap-2 text-[10px]"
                  >
                    <Archive size={14} />
                    Download ZIP Again
                  </motion.button>
                )}
                <motion.button 
                  whileHover={{ scale: 1.02, backgroundColor: '#1d4ed8' }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    triggerSound('click');
                    setShowSuccess(false);
                    setRawInput('');
                    setUploadedFiles([]);
                    setCompletedIds(new Set());
                    setZipBlob(null);
                  }}
                  className="w-full py-4 bg-brand text-white font-black uppercase tracking-widest rounded-xl shadow-xl shadow-brand/20 text-[11px]"
                >
                  Reset Workload
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <nav className="h-14 border-b border-slate-200 flex items-center justify-between px-6 sm:px-10 bg-white/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <motion.div 
            whileHover={{ rotate: 15, scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => triggerSound('hover')}
            className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.2)] shrink-0 cursor-pointer"
          >
            <Stethoscope size={18} className="text-white" strokeWidth={2.5} />
          </motion.div>
          <div className="flex flex-col leading-none">
            <span className="text-lg font-black tracking-tighter text-slate-900 uppercase italic">DR. <span className="text-brand">SVG</span></span>
            <span className="text-[8px] text-slate-400 font-bold tracking-[0.3em] uppercase mt-1">Unified Synthesis Hub</span>
          </div>
        </div>
        
          <div className="flex items-center gap-2 sm:gap-4">
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              onClick={() => setAudioEnabled(!audioEnabled)}
              className={`p-2 rounded-full transition-all ${audioEnabled ? 'text-brand bg-brand/5' : 'text-slate-300 bg-slate-50'}`}
            >
              {audioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </motion.button>

            {user ? (
            <div className="flex items-center gap-3 sm:gap-4 pl-4 border-l border-slate-200">
              <div className="flex flex-col items-end leading-none hidden sm:flex">
                <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight">{user.displayName}</span>
                <span className="text-[7px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Verified Operator</span>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  triggerSound('click');
                  logout();
                }}
                className="w-8 h-8 rounded-full border border-slate-200 overflow-hidden relative group cursor-pointer"
              >
                <img src={user.photoURL || ''} alt="Profile" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <LogOut size={12} className="text-slate-900" />
                </div>
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                triggerSound('click');
                signInWithGoogle();
              }}
              className="px-4 py-1.5 bg-brand text-white text-[10px] font-black uppercase tracking-widest rounded-full hover:shadow-[0_0_15px_rgba(37,99,235,0.4)] flex items-center gap-2"
            >
              <LogIn size={12} strokeWidth={3} />
              <span>Sign In</span>
            </motion.button>
          )}

          <div className="hidden md:flex items-center gap-3 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-100">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${isProcessing ? 'bg-orange-500 animate-pulse' : 'bg-brand'} shadow-[0_0_8px_rgba(37,99,235,0.3)]`} />
              <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">
                {isProcessing ? 'Synthesis engaged' : 'Engine Ready'}
              </span>
            </div>
          </div>
          <span className="px-2 py-1 rounded bg-slate-100 border border-slate-200 text-[7px] text-slate-400 tracking-widest font-black hidden sm:block uppercase">v2.5_QUANTUM</span>
        </div>
      </nav>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Main Input Section */}
        <section className="w-full lg:w-[360px] border-b lg:border-b-0 lg:border-r border-slate-200 bg-bg-sub/30 flex flex-col h-[300px] lg:h-auto overflow-hidden">
          <div className="p-4 px-6 border-b border-slate-200 flex items-center justify-between bg-slate-100/10">
            <h2 className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] flex items-center gap-2">
              <Plus size={10} className="text-brand" />
              Source Stream
            </h2>
            {visibleAssets.length > 0 && (
              <motion.div 
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="text-[8px] font-black text-brand bg-brand/5 border border-brand/10 px-2 py-0.5 rounded-full uppercase italic"
              >
                {visibleAssets.length} Units
              </motion.div>
            )}
          </div>
          
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4">
               <motion.button 
                whileHover={{ scale: 1.02, borderColor: 'rgba(37,99,235,0.4)', backgroundColor: 'rgba(37,99,235,0.02)' }}
                whileTap={{ scale: 0.98 }}
                onClick={() => {
                  triggerSound('click');
                  fileInputRef.current?.click();
                }}
                className="w-full py-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-2 group relative overflow-hidden transition-all shadow-inner"
               >
                 <Upload size={18} className="text-slate-400 transition-transform group-hover:-translate-y-0.5 group-hover:text-brand" />
                 <div className="flex flex-col items-center">
                    <span className="text-[10px] font-black uppercase text-slate-500 group-hover:text-slate-700 mb-0.5">Ingest Local Assets</span>
                    <span className="text-[7px] text-slate-300 uppercase font-black tracking-[0.3em]">LOAD STREAM</span>
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
              <div className="text-[8px] font-black text-slate-300 uppercase tracking-[0.3em] mb-1.5 ml-1">TERMINAL: RAW_BUFFER</div>
              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste code streams here..."
                spellCheck={false}
                className="flex-1 w-full bg-slate-50 rounded-xl border border-slate-200 p-4 text-[10px] font-mono text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand/20 resize-none transition-all placeholder:text-slate-300 custom-scrollbar leading-relaxed"
              />
            </div>
          </div>
        </section>

        {/* Dynamic Preview Section */}
        <section className="flex-1 flex flex-col p-4 sm:p-8 bg-bg-main overflow-hidden relative">
          <div className="flex flex-col sm:flex-row items-baseline sm:items-center justify-between gap-4 mb-6">
            <div className="flex flex-col">
              <h2 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] mb-1.5 flex items-center gap-2.5">
                <ImageIcon size={12} className="text-brand" />
                Synthesis Surface
              </h2>
              <p className="text-[11px] text-slate-400 font-bold tracking-tight italic">Localized assets ready for conversion.</p>
            </div>
            <div className="flex bg-slate-50 rounded-lg p-0.5 border border-slate-200 shadow-inner">
               <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  triggerSound('click');
                  setViewMode('grid');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${viewMode === 'grid' ? 'bg-brand text-white font-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
               >
                 <LayoutGrid size={12} />
                 <span className="text-[8px] uppercase font-black">Nexus</span>
               </motion.button>
               <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  triggerSound('click');
                  setViewMode('list');
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${viewMode === 'list' ? 'bg-brand text-white font-black shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
               >
                 <List size={12} />
                 <span className="text-[8px] uppercase font-black">Stream</span>
               </motion.button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-32 sm:pb-64">
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
                    } bg-white border border-slate-200 rounded-2xl flex items-center justify-center relative overflow-hidden group/card hover:border-brand/40 hover:bg-slate-50 transition-all cursor-default shadow-sm p-3`}
                  >
                    <div className="absolute top-2 left-2 text-[7px] font-black bg-slate-50 text-slate-400 px-1.5 py-0.5 rounded-full uppercase z-10 border border-slate-100 italic">
                      ID_{String(i + 1).padStart(3, '0')}
                    </div>
                    
                    <div className={`${viewMode === 'grid' ? 'w-4/5 h-4/5' : 'w-12 h-12 sm:w-16 sm:h-16'} flex items-center justify-center transform group-hover/card:scale-110 transition-transform duration-700 pointer-events-none shrink-0`}>
                      {item.type === 'svg' && (item.code || item.file) ? (
                        <div className="w-full h-full flex flex-col items-center justify-center overflow-hidden">
                          {item.code ? (
                            <SvgPreview code={item.code} />
                          ) : (
                            <div className="text-[9px] text-slate-300 font-black animate-pulse uppercase italic">Analyzing...</div>
                          )}
                          {(item.originalWidth || item.originalHeight) && (
                            <div className="absolute bottom-2 left-0 right-0 px-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
                              <div className="bg-white/95 backdrop-blur-md rounded-lg py-1 text-[7px] font-mono text-brand border border-slate-100 shadow-xl text-center uppercase tracking-[0.2em]">
                                {Math.round(item.originalWidth || 0)} × {Math.round(item.originalHeight || 0)}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-full h-full bg-slate-50 rounded-2xl flex items-center justify-center overflow-hidden p-1.5">
                           {item.file ? (
                             <img 
                               src={URL.createObjectURL(item.file)} 
                               className="w-full h-full object-contain opacity-60 group-hover:opacity-100 transition-opacity" 
                               onLoad={(e) => URL.revokeObjectURL((e.target as any).src)}
                              />
                           ) : (
                             <ImageIcon size={20} className="text-slate-200" />
                           )}
                        </div>
                      )}
                    </div>

                    {viewMode === 'list' && (
                      <div className="flex-1 ml-6 flex flex-col justify-center">
                         <div className="text-[12px] font-black text-slate-900 uppercase tracking-wider mb-1 flex items-center gap-3">
                           {item.name}
                           <span className="text-[8px] px-2 py-0.5 bg-brand/5 text-brand rounded-full border border-brand/10 italic font-black uppercase tracking-widest">{item.type} SOURCE</span>
                         </div>
                         <div className="text-[9px] text-slate-400 font-bold flex gap-6 italic">
                           {item.originalWidth && item.originalHeight ? (
                             <span className="flex items-center gap-2"><div className="w-1 h-1 bg-brand/40 rounded-full" />SOURCE RES: {Math.round(item.originalWidth)} × {Math.round(item.originalHeight)}</span>
                           ) : (
                             <span className="text-slate-200 italic border-l border-slate-100 pl-3">PENDING_METRICS</span>
                           )}
                           <span className="flex items-center gap-2"><div className="w-1 h-1 bg-green-500/40 rounded-full" />RASTER_READY</span>
                         </div>
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-brand/[0.02] opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none" />
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
          <section className="bg-bg-main/60 backdrop-blur-2xl border-t border-slate-200 p-3 sm:p-5 relative z-30">
            <div className="max-w-screen-xl mx-auto flex flex-col lg:flex-row items-center gap-4 sm:gap-6">
              
              <div className="flex-1 flex items-center justify-center lg:justify-start gap-4 sm:gap-8 w-full">
                {/* Active Parameters HUD */}
                <div className="flex items-center gap-4 sm:gap-6">
                  <div className="flex flex-col">
                    <span className="text-[7px] sm:text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Current Matrix</span>
                    <span className="text-[9px] sm:text-[10px] font-mono text-slate-900/80">{resolution.width} × {resolution.height}</span>
                  </div>
                  <div className="w-px h-5 sm:h-6 bg-slate-200" />
                  <div className="flex flex-col">
                    <span className="text-[7px] sm:text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Mass Scale</span>
                    <span className="text-[9px] sm:text-[10px] font-mono text-slate-900/80">{useTargetSize ? `${targetSize?.toFixed(1)}MB` : 'BYPASS'}</span>
                  </div>
                </div>

                {/* Central Resize Trigger */}
                <motion.button 
                  whileHover={{ scale: 1.05, backgroundColor: 'rgba(37,99,235,0.05)' }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    triggerSound('click');
                    setIsResizeOpen(true);
                  }}
                  disabled={isProcessing}
                  className="px-4 sm:px-6 py-1.5 sm:py-2 bg-slate-50 border border-brand/20 rounded-xl flex items-center gap-2 transition-all group shadow-sm disabled:opacity-30"
                >
                  <Maximize2 size={12} className="text-brand group-hover:rotate-90 transition-transform sm:size-14" />
                  <span className="text-[8px] sm:text-[9px] font-black uppercase text-slate-900 tracking-[0.1em] sm:tracking-[0.2em]">Resize Matrix</span>
                </motion.button>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 w-full lg:w-auto">
                {isProcessing ? (
                  <div className="flex flex-col sm:flex-row items-center gap-3 w-full bg-slate-100/50 border border-slate-200 p-2 sm:p-3 rounded-2xl relative overflow-hidden">
                    {/* Progress Fill Background */}
                    <div className="absolute inset-0 bg-slate-200/50" />
                    
                    <div className="relative flex items-center gap-2 sm:gap-3 w-full">
                       <motion.button 
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          triggerSound('error');
                          abortRef.current = true;
                        }}
                        className="h-8 sm:h-10 px-4 rounded-xl bg-slate-900 text-slate-100 transition-all flex items-center justify-center gap-2 group shrink-0 shadow-xl border border-slate-700"
                       >
                         <X size={14} strokeWidth={3} className="text-red-400 group-hover:rotate-90 transition-transform" />
                         <span className="text-[9px] font-black uppercase tracking-widest hidden sm:inline">Abort Operation</span>
                         <span className="text-[9px] font-black uppercase tracking-widest sm:hidden">Abort</span>
                       </motion.button>

                       {/* Batch Progress Tracker */}
                       <div className="flex-1 h-8 sm:h-10 bg-slate-900/10 rounded-xl relative overflow-hidden border border-slate-300/50 flex items-center px-4">
                          {/* Neon Liquid Fill */}
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${downloadProgress}%` }}
                            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
                            className={`absolute inset-y-0 left-0 transition-colors duration-500 ${downloadProgress === 100 ? 'bg-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.5)]' : 'bg-[#00f2ff] shadow-[0_0_25px_rgba(0,242,255,0.6)]'}`}
                          >
                            <motion.div 
                              animate={{ x: ['-200%', '200%'] }}
                              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[-25deg]"
                            />
                            <div className="absolute right-0 top-0 bottom-0 w-3 bg-white/30 blur-[4px]" />
                          </motion.div>

                          <div className="relative z-10 flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <motion.div
                                animate={{ 
                                  scale: downloadProgress === 100 ? 1 : [1, 1.3, 1],
                                  filter: downloadProgress === 100 ? 'none' : ['drop-shadow(0 0 10px #00f2ff)']
                                }}
                                transition={{ duration: 0.8, repeat: Infinity }}
                                className="text-white flex items-center justify-center"
                              >
                                {downloadProgress === 100 ? <CheckCircle2 size={16} strokeWidth={3} /> : <Zap size={14} fill="currentColor" />}
                              </motion.div>
                              <span className="text-[10px] font-black text-white uppercase tracking-widest drop-shadow-md">
                                {downloadProgress === 100 ? 'TASK_FULFILLED' : 'BATCH_PROGRESS'}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-1">
                              <motion.span 
                                key={downloadProgress}
                                initial={{ y: 8, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                className="text-base font-mono font-black text-white drop-shadow-md"
                              >
                                {downloadProgress}
                              </motion.span>
                              <span className="text-[10px] font-bold text-white/80">%</span>
                            </div>
                          </div>
                       </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <motion.button 
                      whileHover={{ scale: 1.02, backgroundColor: 'rgba(0,0,0,0.02)' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleDownload(true)}
                      disabled={isProcessing || visibleAssets.length === 0}
                      className="flex-1 lg:w-36 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all font-black text-[9px] uppercase tracking-widest bg-slate-50 border border-slate-200 text-slate-900 disabled:opacity-20 disabled:grayscale"
                    >
                      <Archive size={14} strokeWidth={2.5} />
                      <span>ZIP BATCH</span>
                    </motion.button>

                    <motion.button 
                      whileHover={{ scale: 1.02, backgroundColor: '#1d4ed8' }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => handleDownload(false)}
                      disabled={isProcessing || visibleAssets.length === 0}
                      className={`flex-[2] lg:w-48 py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all font-black text-[10px] uppercase tracking-widest shrink-0 ${
                        isProcessing || visibleAssets.length === 0
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
                        : 'bg-brand text-white shadow-lg shadow-brand/20'
                      }`}
                    >
                      <Download size={14} strokeWidth={2.5} />
                      <span>EXPORT UNITS</span>
                    </motion.button>
                  </>
                )}
              </div>
            </div>
          </section>
        </section>
      </main>

      {/* Global Status Footer */}
      <footer className="h-10 border-t border-slate-200 flex items-center justify-between px-8 bg-slate-50 text-[8px] uppercase tracking-[0.3em] font-black text-slate-400">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse shadow-[0_0_5px_rgba(37,99,235,0.5)]" />
            SYNTH_ENGINE_ACTIVE
          </div>
          <div className="hidden sm:block">LOCAL_LATENCY: 0.04ms</div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-300 font-bold hidden lg:inline select-none tracking-widest">AUTHORIZED_TERMINAL_ACCESS_ONLY</span>
        </div>
      </footer>
    </motion.div>
  );
}

