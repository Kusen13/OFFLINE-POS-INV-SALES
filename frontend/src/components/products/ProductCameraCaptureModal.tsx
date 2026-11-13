/**
 * ProductCameraCaptureModal - Live WebCam / Phone Camera viewfinder for taking product photos
 * 
 * Features:
 * - Real live camera stream using navigator.mediaDevices.getUserMedia (works on PC webcam and mobile)
 * - Environment / User facingMode toggle
 * - Shutter click audio feedback
 * - 1:1 square crop capture
 * - Clean hardware release on close
 */

import { useEffect, useRef, useState } from 'react';

interface ProductCameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}

export function ProductCameraCaptureModal({ isOpen, onClose, onCapture }: ProductCameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Play a quick camera shutter click sound
  const playShutterSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch (_) {}
  };

  // Check if multiple cameras are available
  useEffect(() => {
    if (!isOpen) return;
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setHasMultipleCameras(videoDevices.length > 1);
      }).catch(() => {});
    }
  }, [isOpen]);

  // Start or restart camera stream
  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;
    setIsStarting(true);
    setCameraError(null);

    const startCamera = async () => {
      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Hindi suportado ang Camera sa browser o device na ito.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingMode,
            width: { ideal: 1280 },
            height: { ideal: 1280 },
          },
          audio: false,
        });

        if (isCancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Camera access error:', err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setCameraError('Kailangang payagan ang Camera Permission sa browser para makakuha ng picture.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setCameraError('Walang nahanap na camera o webcam sa device na ito.');
        } else {
          // If environment failed, retry with basic video: true
          try {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            if (isCancelled) {
              fallbackStream.getTracks().forEach(track => track.stop());
              return;
            }
            streamRef.current = fallbackStream;
            if (videoRef.current) {
              videoRef.current.srcObject = fallbackStream;
              await videoRef.current.play().catch(() => {});
            }
            return;
          } catch (fallbackErr) {
            setCameraError('Hindi mabuksan ang camera. Subukang i-restart ang browser o gamitin ang file upload.');
          }
        }
      } finally {
        if (!isCancelled) setIsStarting(false);
      }
    };

    startCamera();

    return () => {
      isCancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isOpen, facingMode]);

  // Capture frame to 1:1 canvas
  const handleSnap = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    // Determine square dimensions
    const minDim = Math.min(width, height);
    const startX = (width - minDim) / 2;
    const startY = (height - minDim) / 2;

    const canvas = document.createElement('canvas');
    canvas.width = minDim;
    canvas.height = minDim;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw square cropped frame
    ctx.drawImage(video, startX, startY, minDim, minDim, 0, 0, minDim, minDim);

    playShutterSound();

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `product-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      
      // Stop camera before closing
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      onCapture(file);
      onClose();
    }, 'image/jpeg', 0.92);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="bg-surface-900 border border-surface-700 rounded-3xl max-w-sm w-full overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-surface-850 border-b border-surface-750 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📸</span>
            <div>
              <h3 className="text-sm font-bold text-surface-50">Kunan ng Litrato</h3>
              <p className="text-[10px] text-surface-400">Live Camera para sa Produkto</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-surface-800 text-surface-400 hover:text-white hover:bg-surface-700 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Viewfinder View */}
        <div className="relative w-full aspect-square bg-black overflow-hidden flex items-center justify-center">
          {cameraError ? (
            <div className="p-6 text-center space-y-3">
              <span className="text-4xl">⚠️</span>
              <p className="text-xs text-rose-400 font-semibold leading-relaxed">{cameraError}</p>
              <button
                type="button"
                onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
                className="px-4 py-2 rounded-xl bg-surface-800 text-surface-200 text-xs font-bold border border-surface-700 hover:bg-surface-750 cursor-pointer"
              >
                Subukan ang Ibang Camera
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />

              {isStarting && (
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-2 text-surface-300">
                  <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                  <p className="text-xs font-semibold">Binubuksan ang camera...</p>
                </div>
              )}

              {/* Square framing overlay */}
              <div className="absolute inset-4 sm:inset-6 pointer-events-none border border-white/40 rounded-2xl flex flex-col justify-between p-2 shadow-2xl">
                <div className="flex justify-between">
                  <span className="w-4 h-4 border-t-2 border-l-2 border-primary-400" />
                  <span className="w-4 h-4 border-t-2 border-r-2 border-primary-400" />
                </div>
                <div className="flex justify-between">
                  <span className="w-4 h-4 border-b-2 border-l-2 border-primary-400" />
                  <span className="w-4 h-4 border-b-2 border-r-2 border-primary-400" />
                </div>
              </div>

              {/* Camera Switcher Button (if multiple cameras exist) */}
              {hasMultipleCameras && (
                <button
                  type="button"
                  onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/60 backdrop-blur-md text-white border border-white/20 hover:bg-black/80 transition-all cursor-pointer shadow-lg active:scale-95"
                  title="Palitan ang camera (Front / Back)"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer Shutter Controls */}
        <div className="p-4 bg-surface-850 border-t border-surface-750 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-surface-800 hover:bg-surface-750 text-surface-300 text-xs font-bold transition-colors cursor-pointer"
          >
            Kanselahin
          </button>

          <button
            type="button"
            disabled={!!cameraError || isStarting}
            onClick={handleSnap}
            className="flex-2 py-3.5 rounded-2xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-black transition-all shadow-xl shadow-primary-950/50 flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <span className="text-base">📸</span>
            <span>Kunan ng Litrato</span>
          </button>
        </div>
      </div>
    </div>
  );
}

