/**
 * Mobile Camera Barcode Scanner Modal
 * Uses html5-qrcode for fast, offline camera-based 1D & 2D barcode scanning.
 * Includes pleasant synth beep, haptic vibration, and manual barcode entry fallback.
 */

import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

function playBeep() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (_) {}
}

export function BarcodeScannerModal({ isOpen, onClose, onScan }: BarcodeScannerModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const elementId = 'pos-camera-barcode-reader';

  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    setError(null);
    setScanning(true);

    const initScanner = async () => {
      try {
        const scanner = new Html5Qrcode(elementId, {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.QR_CODE,
          ],
          verbose: false,
        });

        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            qrbox: { width: 260, height: 180 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            if (!mounted) return;
            playBeep();
            if (navigator.vibrate) {
              navigator.vibrate(80);
            }
            onScan(decodedText);
            handleClose();
          },
          () => {
            // Frame scan miss, normal during movement
          }
        );
      } catch (err: any) {
        if (!mounted) return;
        console.warn('Barcode camera start error:', err);
        setError('Hindi ma-access ang camera. Siguraduhing pinayagan ang camera permission o gamitin ang manual input sa ibaba.');
        setScanning(false);
      }
    };

    // Small delay to ensure DOM container is rendered
    const timer = setTimeout(initScanner, 150);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (scannerRef.current) {
        try {
          if (scannerRef.current.isScanning) {
            scannerRef.current.stop().catch(() => {}).then(() => {
              scannerRef.current?.clear();
            });
          } else {
            scannerRef.current.clear();
          }
        } catch (_) {}
        scannerRef.current = null;
      }
    };
  }, [isOpen]);

  const handleClose = async () => {
    if (scannerRef.current && scannerRef.current.isScanning) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (_) {}
    }
    scannerRef.current = null;
    onClose();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    playBeep();
    onScan(manualCode.trim());
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-sm bg-surface-900 border border-surface-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 bg-surface-850 border-b border-surface-700/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">📷</span>
            <div>
              <h3 className="text-sm font-bold text-surface-50">Camera Barcode Scanner</h3>
              <p className="text-[10px] text-surface-400">Itapat ang camera sa barcode ng paninda</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-xl bg-surface-800 text-surface-400 hover:text-white transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Viewfinder Area */}
        <div className="relative bg-black flex items-center justify-center min-h-[280px]">
          <div id={elementId} className="w-full aspect-square max-h-[320px] overflow-hidden" />

          {error ? (
            <div className="absolute inset-0 p-6 flex flex-col items-center justify-center text-center bg-surface-950/95 space-y-3">
              <span className="text-4xl">⚠️</span>
              <p className="text-xs text-rose-300 font-medium">{error}</p>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-xl bg-surface-800 text-surface-200 text-xs font-bold hover:bg-surface-700"
              >
                Subukan Muli
              </button>
            </div>
          ) : scanning ? (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-56 h-36 border-2 border-emerald-400 rounded-2xl relative shadow-[0_0_20px_rgba(52,211,153,0.3)]">
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-emerald-400 shadow-[0_0_10px_#34d399] animate-pulse" />
              </div>
            </div>
          ) : null}
        </div>

        {/* Manual Input Fallback */}
        <div className="p-4 bg-surface-900 border-t border-surface-700/60 space-y-3">
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              placeholder="O i-type ang Barcode / SKU dito..."
              className="flex-1 py-2 px-3 rounded-xl bg-surface-800 border border-surface-700 text-surface-100 text-xs font-mono placeholder:text-surface-500 focus:outline-none focus:border-primary-500"
            />
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs disabled:opacity-40 transition-colors cursor-pointer"
            >
              Enter
            </button>
          </form>

          <p className="text-[11px] text-surface-500 text-center">
            Pwedeng gamitin ang camera sa phone, tablet, o webcam ng laptop.
          </p>
        </div>
      </div>
    </div>
  );
}
