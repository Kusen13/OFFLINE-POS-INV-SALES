import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  getAllSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
} from '../../db/supplierRepository';
import type { Supplier, SupplierFormData } from '../../types/supplier';

// ============================================================
// Suppliers Page
// ============================================================

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllSuppliers();
      setSuppliers(data);
    } catch {
      showToast('Hindi ma-load ang suppliers.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() =>
    suppliers.filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.contact_person.toLowerCase().includes(search.toLowerCase()) ||
      s.phone.includes(search)
    ),
    [suppliers, search]
  );

  const activeCount = useMemo(() => suppliers.filter(s => s.is_active).length, [suppliers]);

  const handleSave = async (data: SupplierFormData) => {
    try {
      if (editing) {
        await updateSupplier(editing.id, data);
        showToast(`✅ Na-update si "${data.name}"!`);
      } else {
        await createSupplier(data);
        showToast(`✅ Naidagdag si "${data.name}"!`);
      }
      await load();
      setShowForm(false);
      setEditing(null);
    } catch {
      showToast('Save failed. Subukan ulit.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSupplier(id);
      showToast('🗑️ Natanggal na ang supplier.');
      setDeletingId(null);
      await load();
    } catch {
      showToast('Delete failed.', 'error');
    }
  };

  const openNew = () => { setEditing(null); setShowForm(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setShowForm(true); };

  const [viewMode, setViewMode] = useState<'cards' | 'table'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1024 ? 'cards' : 'table'
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 sm:space-y-3.5 animate-fade-in pb-16 lg:pb-0">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-2.5 rounded-xl text-sm font-semibold shadow-xl animate-fade-in border
          ${toast.type === 'success' ? 'bg-emerald-900/90 border-emerald-500/50 text-emerald-200' : 'bg-red-900/90 border-red-500/50 text-red-200'}`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between gap-2">
        <div className="hidden lg:block">
          <h1 className="text-xl sm:text-2xl font-bold text-surface-50 tracking-tight">
            Supplier Management
          </h1>
          <p className="text-surface-400 mt-0.5 text-xs sm:text-sm">
            Listahan ng mga supplier at reseller — puwede i-filter sa Re-order sheet
          </p>
        </div>

        <div className="flex items-center gap-1.5 w-full lg:w-auto justify-end">
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs sm:text-sm font-semibold shadow-xs shadow-primary-600/20 transition-all cursor-pointer whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>+ Add Supplier</span>
          </button>
        </div>
      </div>

      {/* Compact KPI Summary Cards */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-1.5 sm:gap-2">
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Total Suppliers</span>
            <span className="text-xs sm:text-base font-extrabold text-surface-100 block truncate">{suppliers.length}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">tindahan</span>
        </div>
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Active</span>
            <span className="text-xs sm:text-base font-extrabold text-emerald-400 block truncate">{activeCount}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">aktibo</span>
        </div>
        <div className="p-1.5 sm:p-2.5 rounded-xl bg-surface-800/90 border border-surface-700/60 shadow-xs flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-[9px] sm:text-[10px] font-bold text-surface-400 uppercase tracking-wider block truncate">Inactive</span>
            <span className="text-xs sm:text-base font-extrabold text-surface-400 block truncate">{suppliers.length - activeCount}</span>
          </div>
          <span className="text-[9px] sm:text-[10px] text-surface-500 font-medium shrink-0 ml-1">nakatago</span>
        </div>
      </div>

      {/* Search Input */}
      <div className="flex-shrink-0 relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search supplier by name, contact, phone, or address..."
          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-surface-900 border border-surface-700 text-surface-100 text-xs placeholder:text-surface-500 focus:outline-none focus:border-primary-500 transition-colors"
        />
      </div>

      {/* Main Table / Cards Card Container */}
      <div className="flex-1 min-h-0 bg-surface-800/50 rounded-xl border border-surface-700/50 flex flex-col overflow-hidden shadow-sm">
        {/* Header Bar with View Switcher */}
        <div className="px-3 py-2 sm:px-4 sm:py-2.5 bg-surface-900/70 border-b border-surface-700/50 flex items-center justify-between gap-2 flex-nowrap shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-xs sm:text-sm font-bold text-surface-100 flex items-center gap-1.5 truncate">
              <span>🏪</span> <span>Talaan ng mga Supplier</span>
            </h3>
            <span className="text-[10px] sm:text-xs text-surface-400 hidden sm:inline whitespace-nowrap">
              ({filtered.length} total)
            </span>
          </div>

          {/* View Switcher: [ 📱 Cards | 📋 Table ] */}
          <div className="flex items-center gap-1 bg-surface-800/80 p-0.5 rounded-lg border border-surface-700/60 shrink-0">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                viewMode === 'cards'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
              title="Cards View"
            >
              <span>📱</span> <span className="hidden xs:inline">Cards</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2 py-0.5 text-xs font-medium rounded transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                viewMode === 'table'
                  ? 'bg-primary-600 text-white shadow-xs'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
              title="Table View"
            >
              <span>📋</span> <span className="hidden xs:inline">Table</span>
            </button>
          </div>
        </div>

        {/* Content Container */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex-1 min-h-0 flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-3 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <p className="text-xs text-surface-400">Kinukuha ang talaan ng mga supplier...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center py-12 text-center">
              <span className="text-3xl mb-2 block">🏪</span>
              <p className="text-surface-300 font-medium text-xs sm:text-sm">
                {search ? 'Walang nahanap na supplier' : 'Wala pang suppliers'}
              </p>
              <p className="text-surface-500 text-[11px] mt-0.5 mb-3">
                {search ? 'Subukan ang ibang keyword' : 'Mag-add ng supplier upang magamit sa BBQ Re-order'}
              </p>
              {!search && (
                <button
                  onClick={openNew}
                  className="px-3.5 py-1.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-semibold cursor-pointer shadow-xs transition-colors"
                >
                  + Add Supplier
                </button>
              )}
            </div>
          ) : viewMode === 'cards' ? (
            <div className="p-2 sm:p-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-2.5">
              {filtered.map(s => (
                <SupplierCard
                  key={s.id}
                  supplier={s}
                  onEdit={() => openEdit(s)}
                  onDelete={() => setDeletingId(s.id)}
                />
              ))}
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-surface-900/95 border-b border-surface-700/60 z-10 backdrop-blur-xs shadow-xs">
                <tr>
                  <th className="px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">Supplier Name</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden sm:table-cell">Contact Person</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap">Phone</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-surface-400 uppercase whitespace-nowrap hidden md:table-cell">Address</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-center whitespace-nowrap">Status</th>
                  <th className="px-3 py-2 text-[11px] font-bold text-surface-400 uppercase text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-700/30">
                {filtered.map(s => (
                  <tr key={s.id} className="hover:bg-surface-700/20 transition-colors">
                    <td className="px-3 py-2 text-xs font-semibold text-surface-100 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>🏪</span>
                        <span>{s.name}</span>
                      </div>
                      {s.notes && <p className="text-[10px] text-surface-500 truncate max-w-xs">{s.notes}</p>}
                    </td>
                    <td className="px-3 py-2 text-xs text-surface-300 whitespace-nowrap hidden sm:table-cell">
                      {s.contact_person || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-surface-300 whitespace-nowrap">
                      {s.phone ? (
                        <a href={`tel:${s.phone}`} className="hover:text-primary-400 text-primary-300 transition-colors">
                          {s.phone}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-surface-400 whitespace-nowrap hidden md:table-cell">
                      {s.address || '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-center whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        s.is_active
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                          : 'bg-surface-700 text-surface-400 border-surface-600'
                      }`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-surface-200 text-xs font-semibold transition-colors cursor-pointer"
                          title="Edit"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => setDeletingId(s.id)}
                          className="px-2 py-1 rounded bg-danger-500/10 hover:bg-danger-500/20 text-danger-400 text-xs font-semibold transition-colors cursor-pointer border border-danger-500/20"
                          title="Delete"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pinned Bottom Summary Footer */}
        <div className="flex-shrink-0 px-3 py-2 bg-surface-900/90 border-t border-surface-700/60 flex items-center justify-between text-xs text-surface-400">
          <span>Kabuuang mga supplier: <strong className="text-surface-100">{filtered.length}</strong></span>
          <span className="text-[11px] text-surface-500 hidden sm:inline">Puwede i-filter sa BBQ Re-order sheet</span>
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <SupplierFormModal
          supplier={editing}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {/* Delete Confirm Modal */}
      {deletingId && (() => {
        const target = suppliers.find(s => s.id === deletingId);
        return createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-surface-800 rounded-2xl p-6 max-w-sm w-full border border-surface-700 shadow-2xl animate-fade-in">
              <h3 className="text-base font-bold text-surface-100 mb-1">Tanggalin ang Supplier?</h3>
              <p className="text-sm text-surface-400 mb-5">
                Sigurado ka bang gusto mong tanggalin si <strong className="text-surface-200">"{target?.name}"</strong>?
                Hindi na ito mababawi.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeletingId(null)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 cursor-pointer transition-colors"
                >
                  Kanselahin
                </button>
                <button
                  onClick={() => handleDelete(deletingId)}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-danger-600 text-white text-sm font-semibold hover:bg-danger-500 cursor-pointer transition-colors"
                >
                  🗑️ I-delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
}

// ============================================================
// Supplier Card
// ============================================================

function SupplierCard({ supplier, onEdit, onDelete }: {
  supplier: Supplier;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`relative p-3 sm:p-4 rounded-xl border shadow-xs transition-all hover:shadow-md
      ${supplier.is_active
        ? 'bg-surface-800/90 border-surface-700/60 hover:border-primary-500/40'
        : 'bg-surface-900/70 border-surface-800 opacity-60'
      }`}>
      {/* Status pill */}
      <div className="absolute top-3 right-3">
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${supplier.is_active ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-surface-700 text-surface-500 border border-surface-600'}`}>
          {supplier.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Name */}
      <div className="flex items-start gap-2 mb-2 pr-14">
        <span className="text-xl shrink-0">🏪</span>
        <div className="min-w-0">
          <p className="font-bold text-surface-100 text-sm leading-tight truncate">{supplier.name}</p>
          {supplier.contact_person && (
            <p className="text-xs text-surface-400 truncate mt-0.5">👤 {supplier.contact_person}</p>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1 mb-3">
        {supplier.phone && (
          <div className="flex items-center gap-1.5 text-xs text-surface-300">
            <span>📞</span>
            <a href={`tel:${supplier.phone}`} className="hover:text-primary-400 transition-colors truncate">{supplier.phone}</a>
          </div>
        )}
        {supplier.address && (
          <div className="flex items-start gap-1.5 text-xs text-surface-400">
            <span className="shrink-0 mt-0.5">📍</span>
            <span className="truncate">{supplier.address}</span>
          </div>
        )}
        {supplier.email && (
          <div className="flex items-center gap-1.5 text-xs text-surface-400">
            <span>✉️</span>
            <a href={`mailto:${supplier.email}`} className="hover:text-primary-400 transition-colors truncate">{supplier.email}</a>
          </div>
        )}
        {supplier.notes && (
          <div className="flex items-start gap-1.5 text-xs text-amber-400/80 bg-amber-500/10 rounded-lg px-2 py-1 border border-amber-500/20">
            <span className="shrink-0">📝</span>
            <span className="line-clamp-2">{supplier.notes}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1.5">
        <button
          onClick={onEdit}
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-surface-200 text-xs font-semibold transition-colors cursor-pointer"
        >
          ✏️ I-edit
        </button>
        <button
          onClick={onDelete}
          className="px-2.5 py-1.5 rounded-lg bg-danger-500/10 hover:bg-danger-500/20 text-danger-400 text-xs font-semibold transition-colors cursor-pointer border border-danger-500/20"
        >
          🗑️
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Supplier Form Modal
// ============================================================

function SupplierFormModal({ supplier, onSave, onClose }: {
  supplier: Supplier | null;
  onSave: (data: SupplierFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SupplierFormData>({
    name: supplier?.name ?? '',
    contact_person: supplier?.contact_person ?? '',
    phone: supplier?.phone ?? '',
    address: supplier?.address ?? '',
    email: supplier?.email ?? '',
    notes: supplier?.notes ?? '',
    is_active: supplier?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setField = <K extends keyof SupplierFormData>(key: K, value: SupplierFormData[K]) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Pangalan ng supplier ay required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-800 rounded-2xl p-5 sm:p-6 max-w-lg w-full border border-surface-700 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-lg font-bold text-surface-100">
              {supplier ? '✏️ I-edit ang Supplier' : '➕ Bagong Supplier'}
            </h3>
            <p className="text-xs text-surface-400 mt-0.5">Punan ang mga detalye ng supplier / reseller</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-700 cursor-pointer">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-danger-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-surface-300 mb-1">
              Pangalan ng Supplier <span className="text-danger-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              className="form-input"
              placeholder="e.g. BBQ Supplier, Ate Rosa - Palengke"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Contact Person */}
            <div>
              <label className="block text-xs font-semibold text-surface-300 mb-1">Pangalan ng Contact</label>
              <input
                type="text"
                value={form.contact_person}
                onChange={e => setField('contact_person', e.target.value)}
                className="form-input"
                placeholder="e.g. Juan dela Cruz"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-xs font-semibold text-surface-300 mb-1">Phone / Mobile</label>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setField('phone', e.target.value)}
                className="form-input"
                placeholder="e.g. 09XX-XXX-XXXX"
              />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="block text-xs font-semibold text-surface-300 mb-1">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={e => setField('address', e.target.value)}
              className="form-input"
              placeholder="e.g. Brgy. Sta. Cruz, Marikina City"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-surface-300 mb-1">Email (Optional)</label>
            <input
              type="email"
              value={form.email ?? ''}
              onChange={e => setField('email', e.target.value)}
              className="form-input"
              placeholder="e.g. supplier@email.com"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-surface-300 mb-1">Notes / Tala</label>
            <textarea
              value={form.notes ?? ''}
              onChange={e => setField('notes', e.target.value)}
              className="form-input"
              rows={2}
              placeholder="e.g. Every morning, 7am delivery. Bayad linggu-linggo."
            />
          </div>

          {/* Active Toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setField('is_active', e.target.checked)}
              className="w-4 h-4 rounded bg-surface-700 border-surface-600 text-primary-600 focus:ring-primary-500/50"
            />
            <span className="text-sm text-surface-200">Active (visible sa Re-order filter)</span>
          </label>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-surface-700 text-surface-200 text-sm font-medium hover:bg-surface-600 transition-colors cursor-pointer"
            >
              Kanselahin
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-500 disabled:opacity-50 transition-colors cursor-pointer shadow-lg shadow-primary-600/20"
            >
              {saving ? 'Sine-save...' : supplier ? '✅ I-update' : '✅ I-save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
