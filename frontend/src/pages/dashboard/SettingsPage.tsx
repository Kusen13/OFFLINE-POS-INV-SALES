/**
 * Settings Page - App configuration
 */

import { useState, useEffect } from 'react';
import { fetchSettings, updateSetting } from '../../api/endpoints';
import type { AppSettings } from '../../types/common';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    loadSettings();
    setDeviceId(localStorage.getItem('pos_device_id') ?? '');
  }, []);

  async function loadSettings() {
    setLoading(true);
    try {
      const res = await fetchSettings();
      setSettings(res.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(key: string, value: string) {
    setSaving(key);
    try {
      await updateSetting(key, value);
      setSaved(key);
      setTimeout(() => setSaved(null), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }

  function handleDeviceId(id: string) {
    setDeviceId(id);
    localStorage.setItem('pos_device_id', id);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12"><div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" /></div>
    );
  }

  if (error || !settings) {
    return (
      <div className="space-y-4 animate-fade-in">
        <h1 className="text-2xl font-bold text-surface-50">Settings</h1>
        <div className="bg-danger-500/10 border border-danger-500/30 rounded-xl p-6 text-center">
          <p className="text-danger-500 mb-3">⚠️ {error ?? 'Failed to load settings'}</p>
          <button onClick={loadSettings} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20 lg:pb-0 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-surface-50">Settings</h1>
        <p className="text-surface-400 mt-1">Configure your POS system</p>
      </div>

      {/* Store Settings */}
      <section className="bg-surface-800/50 rounded-xl border border-surface-700/50 divide-y divide-surface-700/30">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Store Information</h3>
        </div>
        <SettingRow label="Store Name" value={settings.store_name} settingKey="store_name" onSave={handleSave} saving={saving} saved={saved} />
        <SettingRow label="Currency Symbol" value={settings.currency_symbol} settingKey="currency_symbol" onSave={handleSave} saving={saving} saved={saved} />
        <SettingRow label="Tax Rate (%)" value={settings.tax_rate} settingKey="tax_rate" onSave={handleSave} saving={saving} saved={saved} type="number" />
        <SettingRow label="Receipt Footer" value={settings.receipt_footer} settingKey="receipt_footer" onSave={handleSave} saving={saving} saved={saved} />
        <SettingRow label="Low Stock Threshold" value={settings.low_stock_default} settingKey="low_stock_default" onSave={handleSave} saving={saving} saved={saved} type="number" />
      </section>

      {/* Device Settings */}
      <section className="bg-surface-800/50 rounded-xl border border-surface-700/50 divide-y divide-surface-700/30">
        <div className="px-5 py-4">
          <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">Device</h3>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-surface-200 text-sm font-medium">Device ID</p>
              <p className="text-surface-500 text-xs mt-0.5">Used to identify this device in sync logs</p>
            </div>
            <input
              type="text"
              value={deviceId}
              onChange={e => handleDeviceId(e.target.value)}
              className="form-input w-40 text-right text-sm"
              placeholder="e.g., POS-1"
            />
          </div>
        </div>
      </section>

      {/* About */}
      <section className="bg-surface-800/50 rounded-xl border border-surface-700/50 p-5">
        <h3 className="text-sm font-semibold text-surface-300 uppercase tracking-wider mb-3">About</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-400">Version</span>
            <span className="text-surface-200">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-400">Mode</span>
            <span className="text-surface-200">Offline-First PWA</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-400">Storage</span>
            <span className="text-surface-200">IndexedDB + MariaDB</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingRow({ label, value, settingKey, onSave, saving, saved, type = 'text' }: {
  label: string;
  value: string;
  settingKey: string;
  onSave: (key: string, value: string) => void;
  saving: string | null;
  saved: string | null;
  type?: string;
}) {
  const [editValue, setEditValue] = useState(value);
  const isDirty = editValue !== value;

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <label className="text-surface-200 text-sm font-medium flex-shrink-0">{label}</label>
        <div className="flex items-center gap-2">
          <input
            type={type}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            className="form-input w-48 text-right text-sm"
          />
          {isDirty && (
            <button
              onClick={() => onSave(settingKey, editValue)}
              disabled={saving === settingKey}
              className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium hover:bg-primary-500 disabled:opacity-50 transition-colors"
            >
              {saving === settingKey ? '...' : 'Save'}
            </button>
          )}
          {saved === settingKey && (
            <span className="text-success-500 text-xs">✓</span>
          )}
        </div>
      </div>
    </div>
  );
}
