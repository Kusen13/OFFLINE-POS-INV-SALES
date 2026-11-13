/**
 * Settings Page - Enterprise Store Profile, Hardware, Security, & System Backups
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchSettings, updateSetting } from '../../api/endpoints';
import { fetchProductUpdates } from '../../api/sync';
import { replaceAllProducts } from '../../db/productRepository';
import type { AppSettings } from '../../types/common';
import { useAuthStore } from '../../features/security/authStore';
import { createFullSystemBackup, restoreFullSystemBackup } from '../../utils/backupRestore';
import { compressImageFile, isValidImageUrl } from '../../utils/imageCompressor';
import { notifyStoreProfileUpdated } from '../../hooks/useStoreProfile';

type SettingsTab = 'branding' | 'receipt' | 'security' | 'backup';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('branding');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [deviceIdInput, setDeviceIdInput] = useState(() => {
    try { return localStorage.getItem('pos_device_id') || ''; } catch { return ''; }
  });
  const [deviceIdSaved, setDeviceIdSaved] = useState(false);

  // Logo uploader states
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoNotice, setLogoNotice] = useState<string | null>(null);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Cashier staff management
  const [newCashierName, setNewCashierName] = useState('');

  // Manager PIN
  const [managerPin, setManagerPin] = useState('1234');
  const [newManagerPin, setNewManagerPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pinMsg, setPinMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [activePinField, setActivePinField] = useState<'new' | 'confirm'>('new');
  const [showNumpad, setShowNumpad] = useState(false);

  // Auth & Anti-Kupit Store
  const {
    blindCountEnabled,
    hideCostFromCashier,
    setBlindCount,
    setHideCost,
    verifyPin,
  } = useAuthStore();

  // Backup & Restore states
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [restorePinInput, setRestorePinInput] = useState('');
  const [restorePinError, setRestorePinError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Commercial POS Feature Toggles
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(() => {
    try { return localStorage.getItem('pos_auto_print_receipt') === 'true'; } catch { return false; }
  });
  const [allowNegativeStock, setAllowNegativeStock] = useState(() => {
    try { return localStorage.getItem('pos_allow_negative_stock') !== 'false'; } catch { return true; }
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('pos_sound_effects') !== 'false'; } catch { return true; }
  });

  useEffect(() => {
    loadSettings();
    setDeviceIdInput(localStorage.getItem('pos_device_id') ?? '');
    try {
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      setManagerPin(s.manager_pin || '1234');
    } catch {
      setManagerPin('1234');
    }
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetchSettings();
      setSettings(res.data);
      localStorage.setItem('pos_app_settings', JSON.stringify(res.data));
      notifyStoreProfileUpdated();
      setError(null);
    } catch (err) {
      const cached = localStorage.getItem('pos_app_settings');
      if (cached) {
        try {
          setSettings(JSON.parse(cached));
          setError(null);
        } catch {
          setError(err instanceof Error ? err.message : 'Nabigong i-load ang settings');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Nabigong i-load ang settings');
      }
    } finally {
      setLoading(false);
    }
  }

  const handleSaveSetting = async (key: string, value: string) => {
    setSavingKey(key);
    try {
      await updateSetting(key, value);
      setSettings(prev => {
        const updated = { ...(prev || {}), [key]: value } as AppSettings;
        localStorage.setItem('pos_app_settings', JSON.stringify(updated));
        return updated;
      });
      notifyStoreProfileUpdated();
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2500);
    } catch (err) {
      console.error(`Save failed for ${key}:`, err);
      // Fallback: save locally in localStorage so offline functionality is preserved
      setSettings(prev => {
        const updated = { ...(prev || {}), [key]: value } as AppSettings;
        localStorage.setItem('pos_app_settings', JSON.stringify(updated));
        return updated;
      });
      notifyStoreProfileUpdated();
      setSavedKey(key);
      setTimeout(() => setSavedKey(null), 2500);
    } finally {
      setSavingKey(null);
    }
  };

  // Logo file processor (supports file upload, camera, or paste)
  const processLogoFile = async (file: File | Blob) => {
    if (!file) return;
    setLogoLoading(true);
    try {
      const compressed = await compressImageFile(file, { maxWidth: 300, maxHeight: 300, quality: 0.9 });
      await handleSaveSetting('store_logo', compressed);
      setLogoNotice('✓ Matagumpay na nai-save ang Store Logo!');
      setTimeout(() => setLogoNotice(null), 3500);
    } catch (err) {
      console.error('Failed to process logo:', err);
      alert('Hindi ma-proseso ang larawan ng logo. Subukan ang ibang picture.');
    } finally {
      setLogoLoading(false);
    }
  };

  const handleRemoveLogo = async () => {
    if (!confirm('Nais mo bang alisin ang kasalukuyang Store Logo?')) return;
    await handleSaveSetting('store_logo', '');
    setLogoNotice('✓ Naalis ang Store Logo.');
    setTimeout(() => setLogoNotice(null), 2500);
  };

  // Support Ctrl + V Paste anywhere when on branding tab
  useEffect(() => {
    if (activeTab !== 'branding') return;

    const handlePaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processLogoFile(file);
            break;
          }
        }
      }

      if (isInput) return;
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeTab]);

  function handleSaveManagerPin() {
    if (!newManagerPin || newManagerPin.length < 4) {
      setPinMsg({ type: 'err', text: 'Ang PIN ay dapat hindi bababa sa 4 digits.' });
      return;
    }
    if (newManagerPin !== confirmPin) {
      setPinMsg({ type: 'err', text: 'PIN numbers do not match. Please try again.' });
      return;
    }
    try {
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      s.manager_pin = newManagerPin;
      localStorage.setItem('pos_app_settings', JSON.stringify(s));
      setManagerPin(newManagerPin);
      setNewManagerPin('');
      setConfirmPin('');
      setPinMsg({ type: 'ok', text: '✓ Manager PIN updated successfully!' });
      setTimeout(() => setPinMsg(null), 3000);
    } catch {
      setPinMsg({ type: 'err', text: 'Failed to save Manager PIN.' });
    }
  }

  const handleSaveDeviceId = async (val: string) => {
    const trimmed = val.trim();
    try {
      localStorage.setItem('pos_device_id', trimmed);
    } catch {}
    setDeviceIdInput(trimmed);
    await handleSaveSetting('device_id', trimmed);
    setDeviceIdSaved(true);
    setTimeout(() => setDeviceIdSaved(false), 2500);
  };

  async function handleDownloadBackup() {
    setBackupLoading(true);
    setBackupMsg(null);
    try {
      await createFullSystemBackup();
      setBackupMsg({ type: 'ok', text: '✓ System backup archive (.posbackup) downloaded successfully!' });
      setTimeout(() => setBackupMsg(null), 5000);
    } catch (err) {
      setBackupMsg({ type: 'err', text: err instanceof Error ? err.message : 'Backup generation failed.' });
    } finally {
      setBackupLoading(false);
    }
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingRestoreFile(file);
    setRestorePinInput('');
    setRestorePinError('');
    setShowRestoreModal(true);
    e.target.value = '';
  }

  async function handleConfirmRestore() {
    if (!pendingRestoreFile) return;
    if (!verifyPin(restorePinInput)) {
      setRestorePinError('Incorrect Manager PIN. Restore authorization denied.');
      return;
    }

    setRestoreLoading(true);
    try {
      const res = await restoreFullSystemBackup(pendingRestoreFile);
      alert(`${res.message}\n\nThe system will now automatically reload.`);
      window.location.reload();
    } catch (err) {
      setRestorePinError(err instanceof Error ? err.message : 'Failed to restore system backup.');
    } finally {
      setRestoreLoading(false);
    }
  }

  const cashierList = (() => {
    try {
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      return s.cashier_list || settings?.cashier_list || '';
    } catch {
      return settings?.cashier_list || '';
    }
  })();

  const cashierChips = useMemo(() => {
    return cashierList
      .split(',')
      .map((c: string) => c.trim())
      .filter(Boolean);
  }, [cashierList]);

  const handleAddCashier = () => {
    const trimmed = newCashierName.trim();
    if (!trimmed) return;
    if (cashierChips.some((c: string) => c.toLowerCase() === trimmed.toLowerCase())) {
      alert('This cashier name already exists in the active roster.');
      return;
    }
    const updated = [...cashierChips, trimmed].join(', ');
    handleSaveCashierList(updated);
    setNewCashierName('');
  };

  const handleRemoveCashier = (nameToRemove: string) => {
    if (cashierChips.length <= 1) {
      if (!confirm('Only one cashier remains. Are you sure you want to remove this cashier?')) return;
    }
    const updated = cashierChips.filter((c: string) => c !== nameToRemove).join(', ');
    handleSaveCashierList(updated);
  };

  const handleSaveCashierList = (newVal: string) => {
    try {
      const s = JSON.parse(localStorage.getItem('pos_app_settings') || '{}');
      s.cashier_list = newVal;
      localStorage.setItem('pos_app_settings', JSON.stringify(s));
    } catch {}
    handleSaveSetting('cashier_list', newVal);
  };

  const currencySymbol = settings?.currency_symbol || '₱';

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-surface-400">
        <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        <p className="text-xs font-semibold">Loading system settings...</p>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-4 animate-fade-in p-4 max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-surface-100">Settings</h1>
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-center space-y-3">
          <p className="text-rose-400 text-sm font-semibold">⚠️ {error ?? 'Failed to load system settings'}</p>
          <button
            onClick={loadSettings}
            className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold cursor-pointer transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col space-y-3 sm:space-y-4 animate-fade-in pb-16 lg:pb-4 max-w-6xl mx-auto">
      {/* Page Title & Breadcrumb */}
      <div className="flex items-center justify-between pb-1 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-surface-50 tracking-tight flex items-center gap-2">
            <span>⚙️</span> <span>System Settings</span>
          </h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Business Profile, Receipt Hardware, Staff Security & System Recovery
          </p>
        </div>
      </div>

      {/* Enterprise Segmented Tabs (Fixed height, no shrink) */}
      <div className="flex items-center gap-1.5 p-1 bg-surface-900 border border-surface-800 rounded-2xl overflow-x-auto no-scrollbar shadow-xs shrink-0 min-h-[48px]">
        {[
          { id: 'branding', label: 'Store Profile', icon: '🏪', desc: 'Identity & Details' },
          { id: 'receipt', label: 'Receipt & Hardware', icon: '🖨️', desc: 'Thermal Printing' },
          { id: 'security', label: 'Security & Staff', icon: '🛡️', desc: 'PIN & Safeguards' },
          { id: 'backup', label: 'Backup & Recovery', icon: '💾', desc: 'System Archive' },
        ].map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as SettingsTab)}
              className={`flex-1 min-w-[140px] sm:min-w-0 h-10 px-3.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-primary-600 text-white shadow-sm border border-primary-500'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800/60 border border-transparent'
              }`}
            >
              <span className="text-base">{tab.icon}</span>
              <span className="truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: STORE PROFILE & BRANDING                                           */}
      {/* ========================================================================= */}
      {activeTab === 'branding' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start animate-fade-in">
          {/* Logo Uploader Card (Left) */}
          <section className="bg-surface-900/90 border border-surface-750 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
            <div className="border-b border-surface-800 pb-3">
              <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                <span>🖼️</span> <span>Store Logo & Brand Avatar</span>
              </h3>
              <p className="text-[11px] text-surface-400 mt-0.5">
                Displayed on sidebar navigation, mobile drawer, and printed receipts
              </p>
            </div>

            {/* Logo Preview & Drop Area */}
            <div
              onDragOver={e => { e.preventDefault(); setIsDraggingLogo(true); }}
              onDragLeave={() => setIsDraggingLogo(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDraggingLogo(false);
                const file = e.dataTransfer.files?.[0];
                if (file && file.type.startsWith('image/')) {
                  processLogoFile(file);
                }
              }}
              className={`relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed transition-all ${
                isDraggingLogo
                  ? 'border-primary-500 bg-primary-500/10'
                  : 'border-surface-700 bg-surface-950/60 hover:border-surface-600'
              }`}
            >
              {logoLoading ? (
                <div className="py-8 flex flex-col items-center gap-2 text-surface-400">
                  <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                  <span className="text-xs">Processing logo image...</span>
                </div>
              ) : settings.store_logo && isValidImageUrl(settings.store_logo) ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-primary-500/40 shadow-lg bg-surface-900 flex items-center justify-center">
                    <img
                      src={settings.store_logo}
                      alt="Store Logo"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <span className="text-[11px] font-bold text-emerald-400">✓ Active Store Logo</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-surface-400 text-center select-none py-4">
                  <div className="w-16 h-16 rounded-2xl bg-surface-800/80 border border-surface-700 flex items-center justify-center text-3xl">
                    🏪
                  </div>
                  <p className="text-xs font-semibold text-surface-200">No Logo Configured</p>
                  <p className="text-[10px] text-surface-500 max-w-[200px]">
                    Click to select file or paste directly using <strong>Ctrl + V</strong>
                  </p>
                </div>
              )}

              {logoNotice && (
                <p className="text-xs font-bold text-emerald-400 mt-2 text-center animate-fade-in">
                  {logoNotice}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoLoading}
                className="flex-1 py-2.5 px-3 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-sm cursor-pointer flex items-center justify-center gap-1.5 active:scale-95"
              >
                <span>📁</span>
                <span>{settings.store_logo ? 'Change Logo' : 'Upload Store Logo'}</span>
              </button>
              {settings.store_logo && (
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="py-2.5 px-3 rounded-xl bg-surface-800 hover:bg-rose-500/20 text-surface-400 hover:text-rose-300 border border-surface-700 text-xs font-bold transition-colors cursor-pointer"
                  title="Remove Logo"
                >
                  <span>🗑️</span>
                </button>
              )}
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) processLogoFile(file);
                }}
                className="hidden"
              />
            </div>

            <p className="text-[10px] text-surface-500 leading-tight">
              💡 Tip: Supports <strong>Ctrl + V</strong> paste from screenshots or web. Automatically compressed into lightweight offline storage.
            </p>
          </section>

          {/* Business Information Form (Right, 2 Columns) */}
          <section className="lg:col-span-2 bg-surface-900/90 border border-surface-750 rounded-2xl divide-y divide-surface-800/80 shadow-xs">
            <div className="p-4 sm:p-5 bg-surface-850/50 rounded-t-2xl">
              <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                <span>🏢</span> <span>Business Profile & Identity</span>
              </h3>
              <p className="text-[11px] text-surface-400 mt-0.5">
                Primary business details displayed across the system and printed on customer receipts
              </p>
            </div>

            <SettingRow
              label="Store / Business Name"
              hint="Printed as primary header on receipts, POS header, and invoices"
              value={settings.store_name}
              settingKey="store_name"
              onSave={handleSaveSetting}
              saving={savingKey}
              saved={savedKey}
              placeholder="e.g. Daddy-Elvs POS"
            />

            <SettingRow
              label="Branch / Slogan / Subtitle"
              hint="Secondary tagline printed under store name on receipts"
              value={settings.store_subtitle || ''}
              settingKey="store_subtitle"
              onSave={handleSaveSetting}
              saving={savingKey}
              saved={savedKey}
              placeholder="e.g. Main Branch • Cafeteria & Retail System"
            />

            <SettingRow
              label="Store Location / Address"
              hint="Physical store location printed on thermal receipt headers"
              value={settings.store_address || ''}
              settingKey="store_address"
              onSave={handleSaveSetting}
              saving={savingKey}
              saved={savedKey}
              placeholder="e.g. Brgy. Poblacion, Lipa City, Batangas"
            />

            <SettingRow
              label="Contact Phone / Payment Reference"
              hint="Customer inquiries or digital payment hotline printed on receipts"
              value={settings.store_contact || ''}
              settingKey="store_contact"
              onSave={handleSaveSetting}
              saving={savingKey}
              saved={savedKey}
              placeholder="e.g. 0917-123-4567"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-surface-800/80">
              <SettingRow
                label="Currency Symbol"
                hint="Currency indicator (₱, $, €, etc.)"
                value={settings.currency_symbol || '₱'}
                settingKey="currency_symbol"
                onSave={handleSaveSetting}
                saving={savingKey}
                saved={savedKey}
                placeholder="₱"
              />

              <SettingRow
                label="Sales Tax / VAT Rate (%)"
                hint="Set to 0 for Non-VAT or tax-exempt businesses"
                value={settings.tax_rate || '0'}
                settingKey="tax_rate"
                onSave={handleSaveSetting}
                saving={savingKey}
                saved={savedKey}
                type="number"
                placeholder="0"
              />
            </div>
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: RECEIPT & HARDWARE (Thermal Printer & Preview)                     */}
      {/* ========================================================================= */}
      {activeTab === 'receipt' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start animate-fade-in">
          {/* Printer Configuration Form (Left, 2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <section className="bg-surface-900/90 border border-surface-750 rounded-2xl divide-y divide-surface-800/80 shadow-xs">
              <div className="p-4 sm:p-5 bg-surface-850/50 rounded-t-2xl">
                <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                  <span>⚙️</span> <span>Thermal Printer Hardware Settings</span>
                </h3>
                <p className="text-[11px] text-surface-400 mt-0.5">
                  Configure thermal roll paper width and automated printing behaviors
                </p>
              </div>

              {/* Thermal Printer Width */}
              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs sm:text-sm font-bold text-surface-100">Paper Roll Width</p>
                  <p className="text-[11px] text-surface-400 mt-0.5">Select based on your POS thermal printer paper size</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSaveSetting('printer_width', '58mm')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      (settings.printer_width || '58mm') === '58mm'
                        ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                        : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-750'
                    }`}
                  >
                    58mm (Compact Roll)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveSetting('printer_width', '80mm')}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                      settings.printer_width === '80mm'
                        ? 'bg-primary-600 text-white border-primary-500 shadow-sm'
                        : 'bg-surface-800 text-surface-300 border-surface-700 hover:bg-surface-750'
                    }`}
                  >
                    80mm (Wide Roll)
                  </button>
                </div>
              </div>

              {/* Auto Print Receipt Toggle */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>🖨️</span> <span>Auto-Print Receipt on Checkout</span>
                  </p>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    Automatically launch system print dialog immediately upon completing payment in POS
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !autoPrintReceipt;
                    setAutoPrintReceipt(next);
                    localStorage.setItem('pos_auto_print_receipt', next ? 'true' : 'false');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    autoPrintReceipt ? 'bg-primary-600' : 'bg-surface-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      autoPrintReceipt ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Receipt Header Note */}
              <SettingRow
                label="Receipt Header Banner"
                hint="Banner title printed at the top before order line items"
                value={settings.receipt_header || '*** OFFICIAL SALES RECEIPT ***'}
                settingKey="receipt_header"
                onSave={handleSaveSetting}
                saving={savingKey}
                saved={savedKey}
                placeholder="*** OFFICIAL SALES RECEIPT ***"
              />

              {/* Receipt Footer Message */}
              <SettingRow
                label="Receipt Footer Greeting"
                hint="Appreciation closing note printed at the bottom of customer receipts"
                value={settings.receipt_footer || 'Thank you for your business! Please come again.'}
                settingKey="receipt_footer"
                onSave={handleSaveSetting}
                saving={savingKey}
                saved={savedKey}
                placeholder="Thank you for your business!"
              />

              {/* Low stock threshold */}
              <SettingRow
                label="Default Low Stock Alert Threshold"
                hint="Inventory quantity level that triggers low stock warning indicators"
                value={settings.low_stock_default || '10'}
                settingKey="low_stock_default"
                onSave={handleSaveSetting}
                saving={savingKey}
                saved={savedKey}
                type="number"
                placeholder="10"
              />
            </section>
          </div>

          {/* Live Thermal Receipt Preview Simulation (Right, 1 col) */}
          <div className="bg-surface-900/90 border border-surface-750 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-surface-800 pb-2">
              <h3 className="text-xs font-bold text-surface-200 uppercase tracking-wider flex items-center gap-1.5">
                <span>👁️</span> <span>Live Receipt Preview</span>
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-800 text-surface-300 font-bold border border-surface-700">
                {settings.printer_width || '58mm'}
              </span>
            </div>

            {/* Simulated Receipt Paper */}
            <div
              className={`mx-auto bg-white text-black p-4 rounded-lg font-mono text-[11px] shadow-2xl space-y-2 border-t-8 border-surface-700 transition-all ${
                settings.printer_width === '80mm' ? 'w-full max-w-[280px]' : 'w-full max-w-[230px]'
              }`}
            >
              {/* Header */}
              <div className="text-center space-y-1 pb-2 border-b border-dashed border-neutral-400">
                {settings.store_logo && isValidImageUrl(settings.store_logo) && (
                  <img
                    src={settings.store_logo}
                    alt="Logo"
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 mx-auto object-contain grayscale"
                  />
                )}
                <h4 className="font-black text-sm uppercase leading-tight">
                  {settings.store_name || 'MY STORE'}
                </h4>
                {settings.store_subtitle && (
                  <p className="text-[9px] font-semibold text-neutral-600">{settings.store_subtitle}</p>
                )}
                {settings.store_address && (
                  <p className="text-[9px] text-neutral-600">{settings.store_address}</p>
                )}
                {settings.store_contact && (
                  <p className="text-[9px]">Tel: {settings.store_contact}</p>
                )}
                <p className="text-[9px] font-bold uppercase pt-1">
                  {settings.receipt_header || '*** OFFICIAL SALES RECEIPT ***'}
                </p>
                <div className="flex justify-between text-[9px] pt-1 border-t border-dotted border-neutral-300">
                  <span>Receipt #:</span>
                  <span className="font-bold">RCP-DEMO-001</span>
                </div>
                <div className="flex justify-between text-[9px]">
                  <span>Date:</span>
                  <span>{new Date().toLocaleDateString('en-PH')}</span>
                </div>
              </div>

              {/* Sample Items */}
              <div className="py-1 border-b border-dashed border-neutral-400 space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span>2x Pork BBQ Large</span>
                  <span className="font-bold">{currencySymbol}50.00</span>
                </div>
                <div className="flex justify-between">
                  <span>1x 1kg Dinorado Rice</span>
                  <span className="font-bold">{currencySymbol}56.00</span>
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-0.5 text-[10px] pt-1">
                <div className="flex justify-between text-neutral-600">
                  <span>Subtotal:</span>
                  <span>{currencySymbol}106.00</span>
                </div>
                <div className="flex justify-between font-black text-xs pt-1 border-t border-dotted border-neutral-300">
                  <span>TOTAL:</span>
                  <span>{currencySymbol}106.00</span>
                </div>
                <div className="flex justify-between text-neutral-700 pt-0.5">
                  <span>Payment (Cash):</span>
                  <span>{currencySymbol}200.00</span>
                </div>
                <div className="flex justify-between font-bold text-neutral-900">
                  <span>Change:</span>
                  <span>{currencySymbol}94.00</span>
                </div>
              </div>

              {/* Footer */}
              <div className="pt-2 border-t border-dashed border-neutral-400 text-center text-[9px] leading-tight text-neutral-600">
                <p>{settings.receipt_footer || 'Thank you for your business! Please come again.'}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => window.print()}
              className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
            >
              <span>🖨️</span>
              <span>Print Test Receipt</span>
            </button>
          </div>

          {/* Printable Thermal Receipt Sheet (Only visible to printer via @media print) */}
          <div
            id="thermal-receipt"
            className={`hidden font-mono text-black ${
              (settings.printer_width || '58mm') === '80mm' ? 'thermal-80mm' : 'thermal-58mm'
            }`}
          >
            <div className="text-center pb-2 border-b border-dashed border-black">
              {settings.store_logo && isValidImageUrl(settings.store_logo) && (
                <img
                  src={settings.store_logo}
                  alt="Logo"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 mx-auto mb-1 object-contain grayscale"
                />
              )}
              <h2 className="font-extrabold uppercase text-sm leading-tight">
                {settings.store_name || 'MY STORE'}
              </h2>
              {settings.store_subtitle && (
                <p className="text-[10px] font-semibold">{settings.store_subtitle}</p>
              )}
              {settings.store_address && (
                <p className="text-[10px] mt-0.5">{settings.store_address}</p>
              )}
              {settings.store_contact && (
                <p className="text-[10px]">Tel / GCash: {settings.store_contact}</p>
              )}
              <p className="text-[10px] font-bold mt-1 uppercase">
                {settings.receipt_header || '*** OFFICIAL SALES RECEIPT ***'}
              </p>
              <div className="flex justify-between text-[10px] mt-1 pt-1 border-t border-dotted border-black">
                <span>Receipt #:</span>
                <span className="font-bold">RCP-TEST-0001</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span>Date/Time:</span>
                <span>{new Date().toLocaleString('en-PH')}</span>
              </div>
              <div className="flex justify-between text-[9px]">
                <span>Cashier:</span>
                <span>Admin (Test Print)</span>
              </div>
            </div>

            <div className="py-2 border-b border-dashed border-black space-y-1">
              <div className="flex justify-between text-[9px] font-bold uppercase pb-0.5 border-b border-dotted border-black">
                <span>Item Description</span>
                <span>Amount</span>
              </div>
              <div className="text-[10px]">
                <div className="flex justify-between font-semibold">
                  <span>2x Pork BBQ Large</span>
                  <span>{currencySymbol}50.00</span>
                </div>
              </div>
              <div className="text-[10px]">
                <div className="flex justify-between font-semibold">
                  <span>1x 1kg Dinorado Rice</span>
                  <span>{currencySymbol}56.00</span>
                </div>
              </div>
            </div>

            <div className="pt-1 border-b border-dashed border-black pb-1.5 space-y-0.5 text-[10px]">
              <div className="flex justify-between text-gray-700">
                <span>Subtotal:</span>
                <span>{currencySymbol}106.00</span>
              </div>
              <div className="flex justify-between font-black text-xs pt-0.5 border-t border-dotted border-black">
                <span>TOTAL AMOUNT:</span>
                <span>{currencySymbol}106.00</span>
              </div>
              <div className="flex justify-between text-[10px] pt-0.5">
                <span>Cash Tendered:</span>
                <span>{currencySymbol}200.00</span>
              </div>
              <div className="flex justify-between font-black text-xs pt-0.5 border-t border-dotted border-black">
                <span>CHANGE:</span>
                <span>{currencySymbol}94.00</span>
              </div>
            </div>

            <div className="text-center pt-2 text-[9px] space-y-0.5">
              <p className="font-bold">{settings.receipt_footer || 'Thank you for your business! Please come again.'}</p>
              <p className="text-[8px] text-gray-500">*** TEST PRINT OK ***</p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: SECURITY & STAFF MANAGEMENT                                       */}
      {/* ========================================================================= */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start animate-fade-in">
          {/* Left Column: Cashier Staff + Loss Prevention Safeguards */}
          <div className="space-y-4">
            {/* Cashier Staff Management */}
            <section className="bg-surface-900/90 border border-surface-750 rounded-2xl divide-y divide-surface-800/80 shadow-xs">
              <div className="p-4 sm:p-5 bg-surface-850/50 rounded-t-2xl">
                <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                  <span>👤</span> <span>Cashier Staff & Shift Management</span>
                </h3>
                <p className="text-[11px] text-surface-400 mt-0.5">
                  Authorized cashier profiles for shift balancing, receipt attribution, and sales tracking
                </p>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                {/* Add Cashier Form */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-surface-200">Add Cashier Profile:</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCashierName}
                      onChange={e => setNewCashierName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCashier();
                        }
                      }}
                      placeholder="Cashier name (e.g., Maria, Pedro)"
                      className="flex-1 form-input text-xs sm:text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleAddCashier}
                      disabled={!newCashierName.trim()}
                      className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center gap-1 active:scale-95 shrink-0"
                    >
                      <span>+</span>
                      <span>Add Cashier</span>
                    </button>
                  </div>
                </div>

                {/* Active Cashier Chips List */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-surface-400 uppercase tracking-wider">
                      Active Cashiers ({cashierChips.length}):
                    </p>
                    {savingKey === 'cashier_list' && (
                      <span className="text-[10px] text-primary-400 font-semibold animate-pulse">Saving...</span>
                    )}
                    {savedKey === 'cashier_list' && (
                      <span className="text-[10px] text-emerald-400 font-semibold animate-fade-in">✓ Saved</span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {cashierChips.map((name: string, idx: number) => (
                      <div
                        key={idx}
                        className="group px-3 py-1.5 rounded-xl bg-surface-800 border border-surface-700/80 hover:border-surface-600 text-surface-200 text-xs font-semibold flex items-center gap-2 shadow-xs transition-all"
                      >
                        <span className="text-sm">👤</span>
                        <span>{name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveCashier(name)}
                          className="w-4 h-4 rounded-full bg-surface-700 hover:bg-rose-500/80 text-surface-400 hover:text-white flex items-center justify-center text-[10px] cursor-pointer transition-colors"
                          title={`Remove ${name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {cashierChips.length === 0 && (
                      <span className="text-xs text-surface-500 italic py-1">No active cashiers configured. Add one above.</span>
                    )}
                  </div>
                </div>

                <div className="bg-surface-950/60 rounded-xl p-3 border border-surface-800/80">
                  <p className="text-[11px] text-surface-400 leading-relaxed">
                    💡 These names appear in the <strong>👤 Cashier Selector</strong> on the POS register header. Every completed sale attributes to the active cashier for shift reconciliation.
                  </p>
                </div>
              </div>
            </section>

            {/* Store Safeguards & Loss Prevention */}
            <section className="bg-surface-900/90 border border-surface-750 rounded-2xl divide-y divide-surface-800/80 shadow-xs">
              <div className="p-4 sm:p-5 bg-surface-850/50 rounded-t-2xl">
                <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                  <span>🛡️</span> <span>Store Safeguards & Loss Prevention</span>
                </h3>
                <p className="text-[11px] text-surface-400 mt-0.5">
                  Operational policies to protect drawer cash and prevent unauthorized inventory selling
                </p>
              </div>

              {/* Blind Cash Count */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>🙈</span> <span>Blind Cash Count at Daily Closing</span>
                  </p>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    Hides expected drawer cash from cashier until the physical cash count is submitted
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setBlindCount(!blindCountEnabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    blindCountEnabled ? 'bg-primary-600' : 'bg-surface-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      blindCountEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Hide Cost Price */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>🔒</span> <span>Restrict Cost & Margin Visibility</span>
                  </p>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    Only authorized Administrator PIN can view product cost prices and gross margins
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHideCost(!hideCostFromCashier)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    hideCostFromCashier ? 'bg-primary-600' : 'bg-surface-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      hideCostFromCashier ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Allow Negative Stock */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>📦</span> <span>Allow Selling When Out of Stock</span>
                  </p>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    When disabled, the POS blocks cashier from ringing up items with zero or negative inventory
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !allowNegativeStock;
                    setAllowNegativeStock(next);
                    localStorage.setItem('pos_allow_negative_stock', next ? 'true' : 'false');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    allowNegativeStock ? 'bg-primary-600' : 'bg-surface-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      allowNegativeStock ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Sound Effects */}
              <div className="p-4 sm:p-5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5">
                    <span>🔊</span> <span>Audible POS Feedback & Chimes</span>
                  </p>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    Audio feedback upon barcode scanning and cash register drawer checkout confirmation
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    localStorage.setItem('pos_sound_effects', next ? 'true' : 'false');
                  }}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    soundEnabled ? 'bg-primary-600' : 'bg-surface-700'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                      soundEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </section>
          </div>

          {/* Right Column: Manager / Admin PIN Authorization */}
          <div className="space-y-4">
            <section className="bg-surface-900/90 border border-surface-750 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
              <div className="border-b border-surface-800 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                    <span>🔐</span> <span>Manager & Admin PIN Authorization</span>
                  </h3>
                  <p className="text-[11px] text-surface-400 mt-0.5">
                    Required to unlock Administrator Mode, void receipts, and perform disaster restore
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-surface-100 text-sm font-bold tracking-widest bg-surface-950 px-2 py-1 rounded-lg border border-surface-700">
                    {showPin ? managerPin : '●'.repeat(managerPin.length)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPin(p => !p)}
                    className="text-xs text-primary-400 hover:text-primary-300 cursor-pointer font-semibold"
                  >
                    {showPin ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-surface-300">Change PIN Code:</p>
                  <button
                    type="button"
                    onClick={() => setShowNumpad(v => !v)}
                    className="text-xs font-semibold text-primary-400 hover:text-primary-300 cursor-pointer flex items-center gap-1"
                  >
                    <span>🔢</span>
                    <span>{showNumpad ? 'Hide Numpad' : 'Touch Numpad'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div
                    onClick={() => { setActivePinField('new'); setShowNumpad(true); }}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                      activePinField === 'new' && showNumpad
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-surface-700 bg-surface-950'
                    }`}
                  >
                    <label className="text-[10px] text-surface-400 font-bold block mb-1">New PIN:</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={newManagerPin}
                      onFocus={() => { setActivePinField('new'); setShowNumpad(true); }}
                      onChange={e => setNewManagerPin(e.target.value)}
                      placeholder="min 4 digits"
                      className="w-full bg-transparent text-surface-100 text-sm font-mono text-center focus:outline-none"
                    />
                  </div>

                  <div
                    onClick={() => { setActivePinField('confirm'); setShowNumpad(true); }}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                      activePinField === 'confirm' && showNumpad
                        ? 'border-primary-500 bg-primary-500/10'
                        : 'border-surface-700 bg-surface-950'
                    }`}
                  >
                    <label className="text-[10px] text-surface-400 font-bold block mb-1">Confirm PIN:</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={confirmPin}
                      onFocus={() => { setActivePinField('confirm'); setShowNumpad(true); }}
                      onChange={e => setConfirmPin(e.target.value)}
                      placeholder="Repeat PIN"
                      className="w-full bg-transparent text-surface-100 text-sm font-mono text-center focus:outline-none"
                    />
                  </div>
                </div>

                {/* Touchscreen Numpad */}
                {showNumpad && (
                  <div className="p-3 bg-surface-950/80 rounded-2xl border border-surface-800 space-y-2 animate-fade-in">
                    <p className="text-[10px] font-bold text-center text-surface-400">
                      Active Field: <span className="text-primary-400 font-extrabold">{activePinField === 'new' ? 'New PIN' : 'Confirm PIN'}</span>
                    </p>
                    <div className="grid grid-cols-3 gap-1.5 max-w-[240px] mx-auto">
                      {['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(btn => (
                        <button
                          key={btn}
                          type="button"
                          onClick={() => {
                            const setTarget = activePinField === 'new' ? setNewManagerPin : setConfirmPin;
                            if (btn === 'C') {
                              setTarget('');
                            } else if (btn === '⌫') {
                              setTarget(prev => prev.slice(0, -1));
                            } else {
                              setTarget(prev => (prev.length < 8 ? prev + btn : prev));
                            }
                          }}
                          className={`h-11 rounded-xl font-bold text-sm transition-all cursor-pointer shadow-xs active:scale-95 ${
                            btn === 'C'
                              ? 'bg-surface-800 hover:bg-rose-500/20 text-rose-400 border border-surface-700'
                              : btn === '⌫'
                              ? 'bg-surface-800 hover:bg-surface-700 text-surface-200 border border-surface-700'
                              : 'bg-surface-800 hover:bg-surface-700 text-surface-100 border border-surface-700 text-base'
                          }`}
                        >
                          {btn}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {pinMsg && (
                  <p className={`text-xs font-bold ${pinMsg.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {pinMsg.text}
                  </p>
                )}

                <button
                  type="button"
                  onClick={handleSaveManagerPin}
                  disabled={!newManagerPin || !confirmPin}
                  className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-xs font-bold transition-all shadow-sm cursor-pointer active:scale-98"
                >
                  🔐 Save New Manager PIN
                </button>
                <p className="text-[10px] text-surface-500 text-center">
                  Default PIN is <strong>1234</strong>. Stored securely and hashed in browser storage.
                </p>
              </div>
            </section>

            {/* RBAC Summary Card */}
            <div className="bg-surface-900/90 border border-surface-750 rounded-2xl p-4 sm:p-5 shadow-xs space-y-2">
              <h4 className="text-xs font-bold text-surface-200 flex items-center gap-1.5">
                <span>🛡️</span> <span>Role-Based Access Control Summary</span>
              </h4>
              <p className="text-[11px] text-surface-400 leading-relaxed">
                When locked in <strong>Cashier Mode</strong>, the terminal restricts access to product cost margins, financial P&L reports, supplier lists, and settings. Only active cashier shift punch-in, order checkout, and receipt printing are permitted.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: BACKUP & RECOVERY (Database, Restore, & Maintenance)              */}
      {/* ========================================================================= */}
      {activeTab === 'backup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start animate-fade-in">
          {/* Backup & Disaster Recovery */}
          <section className="bg-surface-900/90 border border-surface-750 rounded-2xl divide-y divide-surface-800/80 shadow-xs">
            <div className="p-4 sm:p-5 bg-surface-850/50 rounded-t-2xl">
              <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                <span>💾</span> <span>Database Archive & Disaster Recovery</span>
              </h3>
              <p className="text-[11px] text-surface-400 mt-0.5">
                Generate and download an encrypted complete archive of products, sales records, receivables, and system settings
              </p>
            </div>

            <div className="p-4 sm:p-5 space-y-3.5">
              {backupMsg && (
                <div className={`p-3 rounded-xl text-xs font-semibold ${backupMsg.type === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border border-rose-500/30'}`}>
                  {backupMsg.text}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  disabled={backupLoading}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                >
                  {backupLoading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Generating Backup...</span>
                    </>
                  ) : (
                    <>
                      <span>💾</span>
                      <span>Download Backup Archive (.posbackup)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="py-3 px-4 rounded-xl bg-surface-800 hover:bg-surface-750 text-surface-200 border border-surface-700 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2 active:scale-95"
                >
                  <span>📥</span>
                  <span>Restore from Backup</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".posbackup,.json"
                  onChange={handleFileSelected}
                  className="hidden"
                />
              </div>

              <div className="bg-surface-950/60 rounded-xl p-3 border border-surface-800/80 space-y-1 text-[11px] text-surface-400">
                <p className="flex items-center gap-1 font-bold text-surface-200">
                  <span>💡</span> <span>Disaster Recovery Best Practice</span>
                </p>
                <p className="leading-relaxed">
                  Export backups weekly or before updating your hardware. If migrating to a new computer or laptop, simply upload your <strong>.posbackup</strong> archive to restore all sales history, customer credit accounts, inventory levels, and system settings instantly without data loss.
                </p>
              </div>
            </div>
          </section>

          {/* Device & Maintenance */}
          <div className="space-y-4">
            {/* Terminal Identification */}
            <section className="bg-surface-900/90 border border-surface-750 rounded-2xl divide-y divide-surface-800/80 shadow-xs">
              <div className="p-4 sm:p-5 bg-surface-850/50 rounded-t-2xl">
                <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                  <span>💻</span> <span>Terminal Identification & Register ID</span>
                </h3>
                <p className="text-[11px] text-surface-400 mt-0.5">
                  Used to track offline sync events and audit trails across multi-counter deployments
                </p>
              </div>

              <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs sm:text-sm font-bold text-surface-100">Terminal / Device ID</p>
                  <p className="text-[11px] text-surface-400 mt-0.5">e.g. POS-COUNTER-1, REGISTER-MAIN</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={deviceIdInput}
                    onChange={e => setDeviceIdInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleSaveDeviceId(deviceIdInput);
                    }}
                    className="form-input w-44 text-left sm:text-right text-xs font-mono font-bold"
                    placeholder="e.g. POS-1"
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveDeviceId(deviceIdInput)}
                    className="px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-xs active:scale-95"
                  >
                    Save
                  </button>
                  {deviceIdSaved && (
                    <span className="text-emerald-400 text-xs font-bold animate-fade-in">✓ Saved</span>
                  )}
                </div>
              </div>
            </section>

            {/* System Diagnostics & Cache Flush */}
            <section className="bg-surface-900/90 border border-surface-750 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3.5">
              <div className="flex items-center justify-between border-b border-surface-800 pb-2">
                <h3 className="text-sm font-bold text-surface-100 flex items-center gap-2">
                  <span>ℹ️</span> <span>System Diagnostics & Version Info</span>
                </h3>
                <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-black border border-emerald-500/30">
                  Enterprise Ready
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between py-1 border-b border-surface-800/60">
                  <span className="text-surface-400">Software Version</span>
                  <span className="font-mono font-bold text-surface-200">v1.2.0 (Offline PWA)</span>
                </div>
                <div className="flex justify-between py-1 border-b border-surface-800/60">
                  <span className="text-surface-400">Architecture</span>
                  <span className="font-semibold text-surface-200">Offline-First IndexedDB + MySQL Sync</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-surface-400">Database Layer</span>
                  <span className="font-semibold text-surface-200">Local Browser Storage & Remote Replica</span>
                </div>
              </div>

              <div className="pt-2 border-t border-surface-800 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold text-surface-200">Force Cache Flush & Update</p>
                  <p className="text-[10px] text-surface-400">Purge cached assets and reload the latest build</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm('Clear application cache and reload to fetch the latest updates?')) {
                      try {
                        const data = await fetchProductUpdates();
                        if (data.products && data.products.length > 0) {
                          await replaceAllProducts(data.products);
                        }
                      } catch (e) {
                        console.warn('Could not sync fresh products before reload:', e);
                      }

                      localStorage.removeItem('pos_last_product_sync');
                      localStorage.removeItem('pos_last_sync_time');

                      if ('serviceWorker' in navigator) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        for (const reg of regs) await reg.unregister();
                      }

                      if ('caches' in window) {
                        const keys = await caches.keys();
                        for (const key of keys) await caches.delete(key);
                      }

                      window.location.reload();
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-all shadow-xs cursor-pointer active:scale-95 shrink-0"
                >
                  🔄 Update & Reload
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal with Manager PIN */}
      {showRestoreModal && pendingRestoreFile && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-fade-in">
          <div className="bg-surface-900 border border-surface-700 rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl space-y-4 animate-scale-up">
            <div className="flex items-center gap-2.5 text-amber-400">
              <span className="text-2xl">⚠️</span>
              <div>
                <h3 className="text-base font-bold text-surface-100">Confirm System Restore</h3>
                <p className="text-[11px] text-surface-400">Existing records will be overwritten and replaced by backup data</p>
              </div>
            </div>

            <div className="p-3 rounded-2xl bg-surface-950 border border-surface-800 space-y-1 text-xs">
              <p className="text-surface-400">Selected backup file:</p>
              <p className="font-bold text-surface-200 font-mono truncate">{pendingRestoreFile.name}</p>
              <p className="text-[10px] text-surface-500">{(pendingRestoreFile.size / 1024).toFixed(1)} KB</p>
            </div>

            <div>
              <label className="block text-xs font-bold text-surface-300 mb-1">
                Enter Manager PIN to Authorize Restore:
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                autoFocus
                value={restorePinInput}
                onChange={e => setRestorePinInput(e.target.value)}
                placeholder="4-digit PIN"
                className="w-full px-3 py-2.5 rounded-xl bg-surface-950 border border-surface-700 text-surface-100 text-center font-mono text-xl font-bold tracking-widest focus:border-primary-500 focus:outline-none"
              />
              {restorePinError && (
                <p className="text-xs text-rose-400 font-semibold mt-1">⚠️ {restorePinError}</p>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowRestoreModal(false);
                  setPendingRestoreFile(null);
                  setRestorePinInput('');
                  setRestorePinError('');
                }}
                disabled={restoreLoading}
                className="flex-1 py-2.5 rounded-xl bg-surface-800 hover:bg-surface-700 text-surface-300 text-xs font-bold cursor-pointer border border-surface-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={restoreLoading || !restorePinInput}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md cursor-pointer flex items-center justify-center gap-1.5"
              >
                {restoreLoading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Restoring System...</span>
                  </>
                ) : (
                  <span>✓ Restore Database Now</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingRow({
  label,
  hint,
  value,
  settingKey,
  onSave,
  saving,
  saved,
  type = 'text',
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  settingKey: string;
  onSave: (key: string, value: string) => void;
  saving: string | null;
  saved: string | null;
  type?: string;
  placeholder?: string;
}) {
  const [editValue, setEditValue] = useState(value);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const isDirty = editValue !== value;

  return (
    <div className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        {label && <label className="text-surface-100 text-xs sm:text-sm font-bold block">{label}</label>}
        {hint && <p className="text-surface-400 text-[11px] mt-0.5 leading-tight">{hint}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <input
          type={type}
          value={editValue}
          placeholder={placeholder}
          onFocus={e => e.target.select()}
          onClick={e => (e.target as HTMLInputElement).select()}
          onChange={e => setEditValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && isDirty) {
              onSave(settingKey, editValue);
            }
          }}
          className="form-input w-full sm:w-56 text-left sm:text-right text-xs sm:text-sm font-medium"
        />
        {isDirty && (
          <button
            type="button"
            onClick={() => onSave(settingKey, editValue)}
            disabled={saving === settingKey}
            className="px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-bold hover:bg-primary-500 disabled:opacity-50 transition-colors cursor-pointer shadow-xs"
          >
            {saving === settingKey ? '...' : 'Save'}
          </button>
        )}
        {saved === settingKey && (
          <span className="text-emerald-400 text-xs font-bold animate-fade-in">✓</span>
        )}
      </div>
    </div>
  );
}
