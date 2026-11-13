/**
 * ProductExcelImportModal
 * ---------------------------------------------------------------------------
 * Excel / CSV import modal for Products.
 *
 * Expected Excel columns (row 1 = headers, case-insensitive):
 *   category | name | variant | unit | buying_qty | cost_price | selling_price
 *   current_stock | low_stock_threshold | reseller_price | sku | sell_by_weight
 */

import { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { createProduct, updateProduct, createCategory } from '../../api/endpoints';
import { saveLocalProduct, getAllProducts } from '../../db/productRepository';
import { addPendingMutation } from '../../db/mutationRepository';
import type { Category, ProductFormData, BusinessType, Product } from '../../types/product';
import { BUSINESS_DEPARTMENTS } from '../../types/product';

const COL_ALIASES: Record<string, string> = {
  category: 'category', kategorya: 'category', 'category name': 'category',
  name: 'name', 'item name': 'name', 'product name': 'name', pangalan: 'name', item: 'name',
  variant: 'variant', size: 'variant', flavor: 'variant', 'variant/size': 'variant', 'variant / size': 'variant',
  unit: 'unit', yunit: 'unit', 'unit of measure': 'unit', uom: 'unit',
  buying_qty: 'buying_qty', 'buying qty': 'buying_qty', 'qty per box': 'buying_qty',
  'pieces per box': 'buying_qty', 'pcs per box': 'buying_qty', 'box qty': 'buying_qty', 'case qty': 'buying_qty',
  buying_cost: 'buying_cost', 'buying cost': 'buying_cost', 'total buying cost': 'buying_cost',
  'box cost': 'buying_cost', 'case cost': 'buying_cost', 'kabuuang puhunan': 'buying_cost',
  cost_price: 'cost_price', 'cost price': 'cost_price', 'cost': 'cost_price',
  cost_per_piece: 'cost_per_piece', 'cost per piece': 'cost_per_piece', 'cost_per_pc': 'cost_per_piece',
  'cost per pc': 'cost_per_piece', 'cost (per pc)': 'cost_per_piece', 'puhunan per pc': 'cost_per_piece',
  'unit cost': 'cost_per_piece',
  selling_price: 'selling_price', 'selling price': 'selling_price',
  'selling price (per pc)': 'selling_price', 'selling price/pc': 'selling_price', 'sale price': 'selling_price',
  presyo: 'selling_price', 'retail price': 'selling_price', srp: 'selling_price',
  current_stock: 'current_stock', stock: 'current_stock', 'current stock': 'current_stock',
  'initial stock': 'current_stock', 'stock qty': 'current_stock', 'on hand': 'current_stock',
  low_stock_threshold: 'low_stock_threshold', 'low stock': 'low_stock_threshold',
  'low stock threshold': 'low_stock_threshold', 'reorder point': 'low_stock_threshold',
  reseller_price: 'reseller_price', 'reseller price': 'reseller_price',
  wholesale: 'reseller_price', 'wholesale price': 'reseller_price', 'pakyawan price': 'reseller_price',
  sku: 'sku', 'product code': 'sku', barcode: 'sku', code: 'sku', 'barcode / sku': 'sku',
  sell_by_weight: 'sell_by_weight', 'by weight': 'sell_by_weight',
  'sold by weight': 'sell_by_weight', timbang: 'sell_by_weight',
};

const VALID_UNITS = ['pcs', 'kg', 'g', 'tali', 'bundle', 'puso', 'sticks', 'bottle', 'pack', 'sako', 'lata', 'piraso', 'takal'];
const UNIT_ALIASES: Record<string, string> = {
  piece: 'pcs', pieces: 'pcs', pc: 'pcs',
  kilo: 'kg', kilos: 'kg', kilogram: 'kg',
  gram: 'g', grams: 'g',
  stick: 'sticks', bote: 'bottle', bag: 'pack', sachet: 'pack', sack: 'sako', can: 'lata',
  takal: 'takal',
};

interface ImportRow {
  rowIndex: number;
  raw: Record<string, string>;
  category: string;
  name: string;
  variant: string;
  fullName: string;
  unit: string;
  buying_qty: number | null;
  buying_cost: number | null;
  cost_price: number | null;
  selling_price: number | null;
  current_stock: number;
  low_stock_threshold: number;
  reseller_price: number | null;
  sku: string;
  previewSku?: string;
  sell_by_weight: boolean;
  status: 'ok' | 'warn' | 'error' | 'skip';
  errors: string[];
  warnings: string[];
  matched_category_id: number | null;
  isExisting?: boolean;
  existingProduct?: Product;
}

interface ImportResult {
  ok: number;
  created: number;
  updated: number;
  skipped: number;
  errored: number;
  errors: { row: number; name: string; msg: string }[];
}

function downloadTemplate() {
  const headers = [
    'Category',
    'Item Name',
    'Variant/Size',
    'Unit',
    'Buying Qty',
    'Buying Cost',
    'Cost (per pc)',
    'Selling Price (per pc)',
    'Current Stock',
    'Low Stock Threshold',
    'Reseller Price',
    'Barcode / SKU',
  ];
  const examples = [
    ['Grocery', 'Bear Brand Powder', '320g', 'pcs', 24, 1080.00, 45.00, 52.00, 100, 10, 50.00, ''],
    ['Canned Goods', 'Century Tuna Flakes in Oil', '180g', 'pcs', 48, 1440.00, 30.00, 36.00, 150, 24, 34.00, ''],
    ['Beverages', 'Coca-Cola Mismo', '290ml', 'bottle', 12, 180.00, 15.00, 20.00, 60, 12, '', ''],
    ['Bigas', 'Sinandomeng Special', '', 'kg', '', 42.00, 42.00, 50.00, 200, 50, '', ''],
    ['Snacks', 'Piattos Cheese', '85g', 'pack', 20, 560.00, 28.00, 35.00, 80, 15, 33.00, ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);
  ws['!cols'] = [
    { wch: 15 },
    { wch: 26 },
    { wch: 14 },
    { wch: 8 },
    { wch: 12 },
    { wch: 13 },
    { wch: 14 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 14 },
    { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, 'product_import_template.xlsx');
}

function normalizeHeader(h: string): string {
  const key = h.toLowerCase().trim().replace(/\s+/g,' ');
  return COL_ALIASES[key] ?? key;
}

function parseNumber(v: unknown): number | null {
  if (v===null||v===undefined||v==='') return null;
  const s = String(v).replace(/[₱,\s]/g,'').trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseBool(v: unknown): boolean {
  const s = String(v).toLowerCase().trim();
  return s==='true'||s==='1'||s==='yes'||s==='oo';
}

function normalizeUnit(v: string): string {
  const low = v.toLowerCase().trim();
  return UNIT_ALIASES[low] ?? low;
}

function generateCategorySku(catName: string, usedSkus: Set<string>): string {
  const nameUpper = (catName || '').toUpperCase().trim();
  let prefix = 'ITM';
  if (nameUpper.includes('BARBEQUE') || nameUpper.includes('BARBECUE') || nameUpper.includes('BBQ')) {
    prefix = 'BBQ';
  } else if (nameUpper.includes('DRINK') || nameUpper.includes('BEVERAGE')) {
    prefix = 'DRK';
  } else if (nameUpper.includes('SIDE') || nameUpper.includes('APPETIZER')) {
    prefix = 'SIDE';
  } else {
    const letters = nameUpper.replace(/[^A-Z]/g, '');
    prefix = letters.length >= 3 ? letters.slice(0, 3) : (nameUpper.slice(0, 3) || 'ITM');
  }

  let num = 1;
  while (usedSkus.has(`${prefix}-${String(num).padStart(5, '0')}`)) {
    num++;
  }
  const nextSku = `${prefix}-${String(num).padStart(5, '0')}`;
  usedSkus.add(nextSku);
  return nextSku;
}

export function ProductExcelImportModal({
  categories,
  existingProducts = [],
  defaultDept = 'groceries',
  onClose,
  onImportDone,
}: {
  categories: Category[];
  existingProducts?: Product[];
  defaultDept?: BusinessType;
  onClose: () => void;
  onImportDone: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localCategories, setLocalCategories] = useState<Category[]>(categories);
  const [targetDept, setTargetDept] = useState<BusinessType>(defaultDept);
  const [step, setStep] = useState<'upload'|'preview'|'importing'|'done'>('upload');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult|null>(null);
  const [previewFilter, setPreviewFilter] = useState<'all'|'ok'|'warn'|'error'>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [allExistingProducts, setAllExistingProducts] = useState<Product[]>(existingProducts);

  useEffect(() => {
    getAllProducts().then(prods => {
      if (prods && prods.length > 0) {
        setAllExistingProducts(prods);
      }
    }).catch(() => {});
  }, []);

  function parseFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data,{type:'array'});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: Record<string,unknown>[] = XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
        if (raw.length===0){alert('Walang data sa file.');return;}
        const parsed = raw.map((r,i)=>parseRow(r as Record<string,string>,i+2));

        const usedSkus = new Set<string>(allExistingProducts.map(p => (p.sku || '').trim().toUpperCase()));
        for (const r of parsed) {
          if (r.sku) usedSkus.add(r.sku.trim().toUpperCase());
        }

        for (const r of parsed) {
          // Check if product already exists by SKU first, then by clean product name
          let existingMatch: Product | undefined;
          if (r.sku) {
            existingMatch = allExistingProducts.find(p => p.sku && p.sku.trim().toUpperCase() === r.sku.trim().toUpperCase());
          }
          if (!existingMatch && r.fullName) {
            existingMatch = allExistingProducts.find(p => p.name.trim().toLowerCase() === r.fullName.trim().toLowerCase());
          }

          if (existingMatch) {
            r.isExisting = true;
            r.existingProduct = existingMatch;
            r.previewSku = existingMatch.sku;
            r.warnings.push(`Existing na sa system (${existingMatch.sku}) — mag-uupdate ang presyo at stock.`);
          } else {
            r.isExisting = false;
            if (!r.sku && r.category) {
              r.previewSku = generateCategorySku(r.category, usedSkus);
            } else {
              r.previewSku = r.sku;
            }
          }
        }
        setRows(parsed);
        setStep('preview');
      } catch(err){alert('Hindi ma-parse ang file: '+String(err));}
    };
    reader.readAsArrayBuffer(file);
  }

  function parseRow(r: Record<string,string>, rowIndex: number): ImportRow {
    const norm: Record<string,string> = {};
    for (const [k,v] of Object.entries(r)) norm[normalizeHeader(k)]=String(v??'').trim();
    const category=norm['category']??'';
    const name=norm['name']??'';
    const variant=norm['variant']??'';
    
    // Smart Variant formatting: hindi isasama ang 'regular', 'none', 'n/a' para manatiling malinis ang pangalan
    const variantNorm = variant.trim().toLowerCase();
    const shouldAppendVariant = variant && !['regular', 'none', 'n/a', '-', 'standard'].includes(variantNorm);
    const fullName = shouldAppendVariant ? `${name} ${variant}`.trim() : name.trim();

    let rawUnit = String(norm['unit'] ?? '').trim();
    let rawBuyingQty = String(norm['buying_qty'] ?? '').trim();

    // Smart Auto-Swap: If user accidentally swapped UNIT (e.g. 12) and BUYING_QTY (e.g. "pcs")
    if (!isNaN(Number(rawUnit)) && rawUnit !== '' && (VALID_UNITS.includes(normalizeUnit(rawBuyingQty)) || UNIT_ALIASES[rawBuyingQty.toLowerCase()])) {
      const temp = rawUnit;
      rawUnit = rawBuyingQty;
      rawBuyingQty = temp;
    }

    const unitRaw = normalizeUnit(rawUnit || 'pcs');
    const unit = VALID_UNITS.includes(unitRaw) ? unitRaw : 'pcs';
    const sell_by_weight = parseBool(norm['sell_by_weight'] ?? '') || unit === 'kg' || unit === 'g' || unit === 'takal';

    const buying_qty = parseNumber(rawBuyingQty);
    const cost_per_piece=parseNumber(norm['cost_per_piece']);
    const raw_cost_price=parseNumber(norm['cost_price']);
    const buying_cost=parseNumber(norm['buying_cost']) ?? (cost_per_piece !== null ? raw_cost_price : null);

    // Pinakatamang Puhunan per Piece:
    // 1. Gamitin ang cost_per_piece (Column H sa spreadsheet)
    // 2. Kung walang cost_per_piece, gamitin ang cost_price o i-divide ang buying_cost sa buying_qty
    let cost_price = cost_per_piece;
    const errors:string[]=[],warnings:string[]=[];

    if (cost_price === null) {
      if (raw_cost_price !== null && (buying_qty === null || buying_qty <= 1)) {
        cost_price = raw_cost_price;
      } else if (raw_cost_price !== null && buying_qty && buying_qty > 1) {
        cost_price = Math.round((raw_cost_price / buying_qty) * 100) / 100;
        warnings.push(`Puhunan/pc auto-computed: ₱${cost_price.toFixed(2)} (₱${raw_cost_price} ÷ ${buying_qty})`);
      } else if (buying_cost !== null && buying_qty && buying_qty > 0) {
        cost_price = Math.round((buying_cost / buying_qty) * 100) / 100;
        warnings.push(`Puhunan/pc: ₱${cost_price.toFixed(2)} (₱${buying_cost} ÷ ${buying_qty})`);
      }
    }

    const selling_price=parseNumber(norm['selling_price']);
    const current_stock=parseNumber(norm['current_stock'])??parseNumber(norm['stock'])??parseNumber(norm['buying_qty'])??0;
    const low_stock_threshold=parseNumber(norm['low_stock_threshold'])??10;
    const reseller_price=parseNumber(norm['reseller_price']);
    const sku=norm['sku']??'';

    if (!name) errors.push('Walang pangalan (NAME column)');
    if (!category) errors.push('Walang kategorya (CATEGORY column)');
    if (cost_price===null) errors.push('Walang puhunan (COST_PER_PIECE o COST_PRICE)');
    if (selling_price===null) errors.push('Walang selling price (SELLING_PRICE column)');
    if (cost_price!==null&&selling_price!==null&&selling_price<cost_price)
      warnings.push(`Selling price (₱${selling_price}) ay mas mababa sa puhunan (₱${cost_price})!`);
    if (!VALID_UNITS.includes(unitRaw))
      warnings.push(`Unit "${norm['unit']}" ay hindi kilala — ginamit ang "pcs"`);

    const matchedCat=localCategories.find(c=>c.name.toLowerCase().trim()===category.toLowerCase().trim());
    if (category&&!matchedCat) {
      warnings.push(`Category "${category}" ay awtomatikong gagawin sa system.`);
    }

    if (!name&&!category&&!norm['cost_price']&&!norm['selling_price']&&!norm['cost_per_piece'])
      return {rowIndex,raw:norm,category,name,variant,fullName,unit,buying_qty,buying_cost,cost_price,selling_price,current_stock,low_stock_threshold,reseller_price,sku,sell_by_weight,status:'skip',errors:['Blankong row'],warnings:[],matched_category_id:null};

    const status:ImportRow['status']=errors.length>0?'error':warnings.length>0?'warn':'ok';
    return {rowIndex,raw:norm,category,name,variant,fullName,unit,buying_qty,buying_cost,cost_price,selling_price,current_stock,low_stock_threshold,reseller_price,sku,sell_by_weight,status,errors,warnings,matched_category_id:matchedCat?.id??null};
  }

  async function runImport() {
    setStep('importing'); setProgress(0);
    const toImport=rows.filter(r=>r.status==='ok'||r.status==='warn');
    const res:ImportResult={ok:0,created:0,updated:0,skipped:rows.filter(r=>r.status==='skip').length,errored:0,errors:[]};

    // 1. Auto-create any missing categories seamlessly
    const categoryMap = new Map<string, number>();
    for (const c of localCategories) {
      categoryMap.set(c.name.toLowerCase().trim(), c.id);
    }

    for (const row of toImport) {
      const catKey = row.category.toLowerCase().trim();
      let catId = categoryMap.get(catKey);
      if (!catId && row.category) {
        try {
          const newCatRes = await createCategory({ name: row.category, business_type: targetDept });
          catId = newCatRes.data.id;
          categoryMap.set(catKey, catId);
          setLocalCategories(prev => [...prev, newCatRes.data]);
        } catch {
          // If already exists or cannot create, continue
        }
      }
      row.matched_category_id = catId ?? null;
    }

    // 2. Batch import products (Update if existing, Create if new)
    const usedSkus = new Set<string>(allExistingProducts.map(p => (p.sku || '').trim().toUpperCase()));
    for (const r of rows) {
      if (r.sku) usedSkus.add(r.sku.trim().toUpperCase());
    }

    for (let i=0;i<toImport.length;i++) {
      const row=toImport[i];
      setProgress(Math.round(((i+1)/toImport.length)*100));

      if (!row.matched_category_id) {
        res.errored++;
        res.errors.push({row:row.rowIndex,name:row.fullName,msg:`Hindi magawa o mahanap ang category "${row.category}"`});
        continue;
      }

      if (row.isExisting && row.existingProduct) {
        // UPDATE EXISTING PRODUCT
        const existing = row.existingProduct;
        const updatePayload: Partial<ProductFormData> = {
          name: row.fullName,
          category_id: row.matched_category_id,
          cost_price: row.cost_price ?? existing.cost_price,
          selling_price: row.selling_price ?? existing.selling_price,
          current_stock: row.current_stock,
          unit: row.unit,
          sell_by_weight: row.sell_by_weight,
          is_active: true,
        };
        if (row.sku) updatePayload.sku = row.sku.trim();
        if (row.reseller_price !== null) updatePayload.reseller_price = row.reseller_price;
        if (row.buying_qty) updatePayload.description = `Buying qty: ${row.buying_qty} per case/box`;

        try {
          const updRes = await updateProduct(existing.id, updatePayload);
          if (updRes?.data) {
            await saveLocalProduct(updRes.data);
          } else {
            await saveLocalProduct({ ...existing, ...updatePayload });
          }
          res.ok++;
          res.updated++;
        } catch {
          // Offline fallback
          await saveLocalProduct({ ...existing, ...updatePayload, is_pending: true });
          await addPendingMutation({
            entity: 'product',
            action: 'update',
            payload: updatePayload,
            entityId: existing.id,
          });
          res.ok++;
          res.updated++;
        }
      } else {
        // CREATE BRAND NEW PRODUCT
        const finalSku=row.sku ? row.sku.trim() : (row.previewSku || generateCategorySku(row.category, usedSkus));
        const data:ProductFormData={
          name:row.fullName,sku:finalSku,category_id:row.matched_category_id,item_type:'product',
          description:row.buying_qty?`Buying qty: ${row.buying_qty} per case/box`:undefined,
          cost_price:row.cost_price??0,selling_price:row.selling_price??0,
          reseller_price:row.reseller_price??undefined,
          current_stock:row.current_stock,initial_stock:row.current_stock,
          initial_stock_date:new Date().toISOString().slice(0,10),
          low_stock_threshold:row.low_stock_threshold,unit:row.unit,
          sell_by_weight:row.sell_by_weight,is_active:true,
        };

        try {
          const prodRes = await createProduct(data);
          if (prodRes?.data) {
            await saveLocalProduct(prodRes.data);
          }
          res.ok++;
          res.created++;
        } catch (err: unknown) {
          // Fallback to offline IndexedDB pending creation
          try {
            const tempId = -Date.now() - i;
            const fallbackProd: Product & { is_pending?: boolean } = {
              id: tempId,
              category_id: data.category_id,
              category_name: row.category,
              name: data.name,
              sku: data.sku,
              description: data.description ?? null,
              item_type: data.item_type ?? 'product',
              cost_price: data.cost_price,
              selling_price: data.selling_price,
              current_stock: data.current_stock ?? 0,
              initial_stock: data.initial_stock ?? 0,
              initial_stock_date: data.initial_stock_date ?? new Date().toISOString().slice(0, 10),
              low_stock_threshold: data.low_stock_threshold ?? 5,
              unit: data.unit ?? 'pcs',
              sell_by_weight: data.sell_by_weight ?? false,
              image_path: null,
              is_active: true,
              is_pending: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            await saveLocalProduct(fallbackProd);
            await addPendingMutation({
              entity: 'product',
              action: 'create',
              payload: data,
              tempId,
            });
            res.ok++;
            res.created++;
          } catch {
            res.errored++;
            const e = err as { data?: { message?: string }; message?: string };
            res.errors.push({ row: row.rowIndex, name: row.fullName, msg: e?.data?.message ?? e?.message ?? 'Error' });
          }
        }
      }
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 100));
    }
    window.dispatchEvent(new Event('pos_inventory_updated'));
    setResult(res);
    setStep('done');
    onImportDone();
  }

  const okCount=rows.filter(r=>r.status==='ok').length;
  const warnCount=rows.filter(r=>r.status==='warn').length;
  const errorCount=rows.filter(r=>r.status==='error').length;
  const skipCount=rows.filter(r=>r.status==='skip').length;
  const importableCount=okCount+warnCount;
  const filteredRows=rows.filter(r=>previewFilter==='all'?r.status!=='skip':r.status===previewFilter);

  // Financial summary ng on-hand inventory
  const totalStockCount = rows.filter(r => r.status !== 'skip').reduce((acc, r) => acc + (r.current_stock || 0), 0);
  const totalCostValue = rows.filter(r => r.status !== 'skip').reduce((acc, r) => acc + ((r.current_stock || 0) * (r.cost_price || 0)), 0);
  const totalSalesValue = rows.filter(r => r.status !== 'skip').reduce((acc, r) => acc + ((r.current_stock || 0) * (r.selling_price || 0)), 0);
  const totalEstimatedProfit = totalSalesValue - totalCostValue;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface-900 border border-surface-700 rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl max-h-[92vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-surface-700/60 flex-shrink-0">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-surface-100 flex items-center gap-2">
              <span>📊</span><span>Import Products mula sa Excel</span>
            </h2>
            <p className="text-[10px] text-surface-400 mt-0.5">Mag-upload ng .xlsx / .xls / .csv para mag-batch import</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-700 text-surface-400 hover:text-surface-100 transition-colors cursor-pointer">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* STEP 1: Upload */}
          {step==='upload'&&(
            <div className="p-4 sm:p-5 space-y-4">
              {/* Target Business Department */}
              <div className="bg-surface-800/80 border border-surface-700/60 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-surface-200 flex items-center gap-1.5">
                    <span>🏢</span>
                    <span>Piliin ang Negosyo / Department na I-iimport:</span>
                  </span>
                  <span className="text-[10px] text-surface-400">Lahat ng bagong categories ay dito mapupunta</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {BUSINESS_DEPARTMENTS.map(dept => {
                    const isSelected = targetDept === dept.id;
                    return (
                      <button
                        key={dept.id}
                        type="button"
                        onClick={() => setTargetDept(dept.id)}
                        className={`p-2.5 rounded-xl border text-left flex items-center gap-2 cursor-pointer transition-all ${
                          isSelected
                            ? `${dept.activeColor} ring-2 ring-primary-500/40 shadow-sm scale-[1.02]`
                            : 'bg-surface-900 border-surface-700/60 text-surface-300 hover:bg-surface-700/50'
                        }`}
                      >
                        <span className="text-xl shrink-0">{dept.icon}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold leading-tight truncate">{dept.label}</p>
                          <p className="text-[10px] opacity-75 truncate">{dept.name}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-primary-500/10 border border-primary-500/30 rounded-xl p-3.5 space-y-2">
                <p className="text-xs font-bold text-primary-300 flex items-center gap-1.5"><span>📋</span>Paano Gamitin:</p>
                <ol className="text-[11px] text-surface-300 space-y-1 list-decimal list-inside">
                  <li>I-create muna ang <strong className="text-primary-300">Categories</strong> sa Categories page</li>
                  <li>I-download ang <strong>Excel template</strong> sa ibaba (may mga halimbawa)</li>
                  <li>Fill-in ang Excel — ang <strong>category</strong> ay dapat <strong>exact match</strong> sa iyong categories</li>
                  <li>I-upload ang file at i-review ang preview</li>
                  <li>I-click ang <strong>I-Import</strong> para i-save lahat</li>
                </ol>
              </div>

              {/* Column reference */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                {([
                  {col:'category',req:true,note:'Exact match sa iyong Categories'},
                  {col:'name',req:true,note:'Pangalan ng produkto (e.g. Bear Brand)'},
                  {col:'cost_price',req:true,note:'Puhunan per pc o kabuuang buying_cost'},
                  {col:'selling_price',req:true,note:'Selling price per pc / retail price'},
                  {col:'unit',req:true,note:'pcs, kg, g, bottle, pack, lata, sako...'},
                  {col:'variant',req:false,note:'Size / Flavor (e.g. 320g, Spicy)'},
                  {col:'buying_qty',req:false,note:'Laman kada kahon (e.g. 24 pcs/box)'},
                  {col:'buying_cost',req:false,note:'Puhunan kada kahon (auto ÷ buying_qty)'},
                  {col:'current_stock',req:false,note:'On-hand stock ngayon (default: 0)'},
                  {col:'reseller_price',req:false,note:'Wholesale / pakyawan price'},
                  {col:'sku',req:false,note:'Barcode o auto-generate kung walang nilagay'},
                ] as {col:string;req:boolean;note:string}[]).map(({col,req,note})=>(
                  <div key={col} className="flex items-start gap-1.5 bg-surface-800/60 rounded-lg px-2.5 py-2 border border-surface-700/40">
                    <span className={`text-[9px] font-bold px-1 py-0.5 rounded mt-0.5 shrink-0 ${req?'bg-rose-500/20 text-rose-300':'bg-surface-700 text-surface-400'}`}>
                      {req?'REQ':'OPT'}
                    </span>
                    <div><p className="font-mono font-bold text-surface-200">{col}</p><p className="text-surface-500 text-[10px]">{note}</p></div>
                  </div>
                ))}
              </div>

              {/* Valid units */}
              <div className="bg-surface-800/40 rounded-lg px-3 py-2 border border-surface-700/40">
                <p className="text-[11px] text-surface-400">
                  <strong className="text-surface-300">Valid Units:</strong>{' '}
                  {VALID_UNITS.map(u=><code key={u} className="bg-surface-700 px-1 rounded text-[10px] mx-0.5 text-primary-300">{u}</code>)}
                </p>
              </div>

              {/* Template download */}
              <button type="button" onClick={downloadTemplate}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-primary-500/40 text-primary-400 hover:bg-primary-500/10 hover:border-primary-500/70 transition-all text-xs font-bold flex items-center justify-center gap-2 cursor-pointer">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                📥 I-download ang Excel Template (may 5 halimbawa)
              </button>

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${isDragging?'border-primary-500 bg-primary-500/10':'border-surface-600 hover:border-primary-500/50 hover:bg-surface-800/30'}`}
                onClick={()=>fileInputRef.current?.click()}
                onDragOver={e=>{e.preventDefault();setIsDragging(true);}}
                onDragLeave={()=>setIsDragging(false)}
                onDrop={e=>{e.preventDefault();setIsDragging(false);const f=e.dataTransfer.files[0];if(f)parseFile(f);}}>
                <span className="text-4xl block mb-2">📂</span>
                <p className="text-sm font-semibold text-surface-200 mb-1">I-drag ang Excel file dito</p>
                <p className="text-xs text-surface-500">o i-click para mag-browse (.xlsx, .xls, .csv)</p>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                  onChange={e=>{const f=e.target.files?.[0];if(f)parseFile(f);}}/>
              </div>
            </div>
          )}

          {/* STEP 2: Preview */}
          {step==='preview'&&(
            <div className="flex flex-col">
              <div className="px-4 py-2.5 border-b border-surface-700/60 flex-shrink-0 flex flex-wrap items-center gap-2">
                <span className="text-xs text-surface-400 font-medium">📄 {fileName}</span>
                <div className="flex items-center gap-1.5 ml-auto flex-wrap">
                  {([
                    {key:'all',label:'Lahat',count:rows.filter(r=>r.status!=='skip').length,color:'bg-surface-700 text-surface-300'},
                    {key:'ok',label:'✅ OK',count:okCount,color:'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'},
                    {key:'warn',label:'⚠️ Notice',count:warnCount,color:'bg-amber-500/20 text-amber-300 border border-amber-500/40'},
                    {key:'error',label:'❌ Error',count:errorCount,color:'bg-rose-500/20 text-rose-300 border border-rose-500/40'},
                  ] as {key:string;label:string;count:number;color:string}[]).map(f=>(
                    <button key={f.key} type="button" onClick={()=>setPreviewFilter(f.key as typeof previewFilter)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer transition-all ${f.color} ${previewFilter===f.key?'ring-2 ring-offset-1 ring-offset-surface-900 ring-current':''}`}>
                      {f.label} ({f.count})
                    </button>
                  ))}
                  {skipCount>0&&<span className="text-[10px] text-surface-500">{skipCount} blank rows</span>}
                </div>
              </div>

              {/* Inventory Stock & Financial Valuation Ribbon */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-2.5 bg-surface-800/80 border-b border-surface-700/60 text-xs">
                <div className="bg-surface-900/70 px-2.5 py-1.5 rounded-lg border border-surface-700/40">
                  <span className="text-[10px] text-surface-400 block font-medium">📦 Bilang ng Current Stocks</span>
                  <span className="text-sm font-bold text-surface-100">{totalStockCount.toLocaleString()} {totalStockCount === 1 ? 'pc' : 'pcs'}</span>
                </div>
                <div className="bg-surface-900/70 px-2.5 py-1.5 rounded-lg border border-surface-700/40">
                  <span className="text-[10px] text-surface-400 block font-medium">💵 Kabuuang Puhunan sa Stock</span>
                  <span className="text-sm font-bold text-amber-300">₱{totalCostValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="bg-surface-900/70 px-2.5 py-1.5 rounded-lg border border-surface-700/40">
                  <span className="text-[10px] text-surface-400 block font-medium">💰 Pera pag Nabenta Lahat</span>
                  <span className="text-sm font-bold text-emerald-400">₱{totalSalesValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="bg-surface-900/70 px-2.5 py-1.5 rounded-lg border border-surface-700/40">
                  <span className="text-[10px] text-surface-400 block font-medium">📈 Inaasahang Tubo (Gross)</span>
                  <span className="text-sm font-bold text-primary-300">₱{totalEstimatedProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              {/* Prominent Error & Validation Banner */}
              {errorCount > 0 ? (
                <div className="mx-4 my-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs">
                  <div className="flex items-center justify-between font-bold text-rose-300 mb-1.5">
                    <span className="flex items-center gap-1.5">
                      <span className="text-base">🚨</span>
                      <span>May {errorCount} {errorCount === 1 ? 'produkto' : 'mga produkto'} na may kulang o mali sa Excel file:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewFilter('error')}
                      className="px-2.5 py-1 rounded-lg bg-rose-500/25 hover:bg-rose-500/40 text-[10px] text-rose-100 border border-rose-500/40 cursor-pointer font-bold transition-colors whitespace-nowrap"
                    >
                      I-filter ang mga May Error ({errorCount}) →
                    </button>
                  </div>
                  <div className="space-y-1 max-h-32 overflow-y-auto text-[11px] text-rose-200 bg-surface-900/70 p-2 rounded-lg border border-rose-500/20">
                    {rows.filter(r => r.status === 'error').map(r => (
                      <div key={r.rowIndex} className="flex items-start gap-1.5 border-b border-rose-500/10 last:border-b-0 pb-1 last:pb-0">
                        <span className="font-mono text-rose-400 font-bold shrink-0">Row {r.rowIndex}:</span>
                        <span className="font-semibold text-surface-100 shrink-0">{r.fullName || '(Walang Pangalan)'}</span>
                        <span className="text-rose-300 font-medium">— {r.errors.join(' • ')}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-rose-300/90 mt-1.5">
                    💡 <strong>Paano ayusin:</strong> Buksan ang iyong Excel file, punan ang kulang na <code>SELLING_PRICE</code> o <code>COST_PRICE</code> sa mga row sa itaas, at i-upload muli gamit ang button na <em>"Magpalit ng File"</em> sa ibaba.
                  </p>
                </div>
              ) : warnCount > 0 ? (
                <div className="mx-4 my-2.5 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">ℹ️</span>
                    <span><strong>Paalala:</strong> May {warnCount} paunawa (hal. mga bagong kategoryang kusang gagawin o selling price mas mababa sa puhunan). Pwede na itong i-import.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewFilter('warn')}
                    className="px-2 py-0.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-[10px] text-amber-200 border border-amber-500/40 cursor-pointer font-bold whitespace-nowrap ml-2"
                  >
                    Tingnan ang {warnCount} Notises →
                  </button>
                </div>
              ) : (
                <div className="mx-4 my-2.5 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
                  <span className="text-base">🎉</span>
                  <span><strong>Perpekto!</strong> Kumpleto ang lahat ng detalye ng {okCount} produkto. Handa na itong i-import sa system nang walang error.</span>
                </div>
              )}

              {/* Detailed Preview Table */}
              <div className="overflow-auto max-h-[48vh] px-1">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="sticky top-0 bg-surface-900 border-b border-surface-700/60 z-10 shadow-xs">
                    <tr>
                      {['#','Status','Auto SKU','Category','Product Name','Unit','Puhunan','SRP (Benta)','Tubo/Margin','Stock','Mensahe / Dahilan'].map(h=>(
                        <th key={h} className={`px-2 py-2 text-surface-400 font-bold uppercase ${['Puhunan','SRP (Benta)','Tubo/Margin','Stock'].includes(h)?'text-right':''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(row=>{
                      const profit = row.selling_price !== null && row.cost_price !== null ? (row.selling_price - row.cost_price) : null;
                      const marginPct = profit !== null && row.selling_price && row.selling_price > 0 ? Math.round((profit / row.selling_price) * 100) : null;
                      return (
                        <tr key={row.rowIndex} className={`border-b border-surface-800/40 transition-colors ${row.status==='error'?'bg-rose-500/10 hover:bg-rose-500/15':row.status==='warn'?'bg-amber-500/5 hover:bg-amber-500/10':'hover:bg-surface-800/30'}`}>
                          <td className="px-2 py-2 text-surface-400 font-mono text-[10px]">{row.rowIndex}</td>
                          <td className="px-1.5 py-2 text-center whitespace-nowrap">
                            {row.status==='error' ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">❌ Error</span>
                            ) : row.isExisting ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40" title={`Existing Product (${row.existingProduct?.sku}) — Presyo at Stock ang mag-uupdate`}>🔄 Update</span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">🆕 Bago</span>
                            )}
                          </td>
                          <td className="px-2 py-2 font-mono text-primary-300 font-bold text-[10px] whitespace-nowrap">
                            {row.previewSku || '—'}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <span className={row.matched_category_id?'text-surface-200 font-medium':'text-amber-400 font-medium'}>
                              {row.category||<span className="text-rose-400 italic">Kulang Category</span>}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-surface-100 font-semibold max-w-[170px] truncate" title={row.fullName}>
                            {row.fullName||<span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/30">Kulang Pangalan</span>}
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <code className="bg-surface-800 px-1 py-0.5 rounded text-primary-300 text-[10px]">{row.unit}</code>
                            {row.sell_by_weight&&<span className="ml-1 text-[9px] text-amber-400" title="Timbang / Decimal">⚖️</span>}
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-surface-200 whitespace-nowrap">
                            {row.cost_price!==null ? (
                              `₱${row.cost_price.toFixed(2)}`
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">Kulang</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right font-mono text-primary-300 font-bold whitespace-nowrap">
                            {row.selling_price!==null ? (
                              `₱${row.selling_price.toFixed(2)}`
                            ) : (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">Kulang SRP</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            {profit!==null ? (
                              <div>
                                <span className={`font-mono font-bold text-[10px] ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {profit >= 0 ? '+' : ''}₱{profit.toFixed(2)}
                                </span>
                                {marginPct !== null && (
                                  <span className="text-[9px] text-surface-400 block font-sans">
                                    ({marginPct}%)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-surface-500 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right text-surface-300 font-mono whitespace-nowrap">
                            {row.current_stock}
                          </td>
                          <td className="px-2 py-2 max-w-[200px]">
                            {row.errors.map((e,i)=>(
                              <div key={i} className="flex items-center gap-1 text-rose-400 text-[10px] font-medium leading-tight mb-0.5">
                                <span>❌</span>
                                <span>{e}</span>
                              </div>
                            ))}
                            {row.warnings.map((w,i)=>(
                              <div key={i} className="flex items-center gap-1 text-amber-400 text-[10px] leading-tight mb-0.5">
                                <span>⚠️</span>
                                <span>{w}</span>
                              </div>
                            ))}
                            {row.errors.length===0 && row.warnings.length===0 && (
                              <span className="text-emerald-400 text-[10px] font-medium">✨ Handa nang i-save</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRows.length===0&&<div className="py-8 text-center text-surface-500 text-xs">Walang rows sa napiling filter</div>}
              </div>
            </div>
          )}

          {/* STEP 3: Importing */}
          {step==='importing'&&(
            <div className="p-6 flex flex-col items-center justify-center gap-5 min-h-[220px]">
              <div className="text-4xl animate-bounce">⬆️</div>
              <div className="w-full max-w-sm space-y-2">
                <div className="flex justify-between text-xs text-surface-400">
                  <span>Nag-iimport ng mga produkto...</span>
                  <span className="font-bold text-primary-400">{progress}%</span>
                </div>
                <div className="w-full h-3 bg-surface-800 rounded-full overflow-hidden border border-surface-700">
                  <div className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all duration-300" style={{width:`${progress}%`}}/>
                </div>
                <p className="text-[10px] text-surface-500 text-center">Huwag isara ang window habang nag-iimport</p>
              </div>
            </div>
          )}

          {/* STEP 4: Done */}
          {step==='done'&&result&&(
            <div className="p-5 space-y-4">
              <div className="text-center">
                <span className="text-5xl">{result.errored===0?'🎉':'⚠️'}</span>
                <h3 className="text-base font-bold text-surface-100 mt-2">Import Tapos Na!</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-black text-emerald-400">{result.created}</p>
                  <p className="text-[11px] text-emerald-300 font-semibold">🆕 Bagong Nalikha</p>
                  <p className="text-[10px] text-surface-500">New products</p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3 text-center">
                  <p className="text-2xl font-black text-blue-400">{result.updated}</p>
                  <p className="text-[11px] text-blue-300 font-semibold">🔄 Na-update (Existing)</p>
                  <p className="text-[10px] text-surface-500">Updated price/stock</p>
                </div>
                <div className="bg-surface-800 border border-surface-700 rounded-xl p-3 text-center">
                  <p className="text-2xl font-black text-surface-400">{result.skipped}</p>
                  <p className="text-[11px] text-surface-300 font-semibold">Nilaktawan</p>
                  <p className="text-[10px] text-surface-500">Blank rows</p>
                </div>
                <div className={`border rounded-xl p-3 text-center ${result.errored>0?'bg-rose-500/10 border-rose-500/30':'bg-surface-800 border-surface-700'}`}>
                  <p className={`text-2xl font-black ${result.errored>0?'text-rose-400':'text-surface-400'}`}>{result.errored}</p>
                  <p className={`text-[11px] font-semibold ${result.errored>0?'text-rose-300':'text-surface-300'}`}>May Error</p>
                  <p className="text-[10px] text-surface-500">Hindi na-save</p>
                </div>
              </div>

              {/* Summary ng Stocks at Pera */}
              <div className="p-3.5 bg-surface-800/80 rounded-xl border border-surface-700 flex flex-wrap items-center justify-around gap-2 text-center text-xs">
                <div>
                  <span className="text-[10px] text-surface-400 block font-medium">Kabuuang On-Hand Stocks</span>
                  <span className="font-bold text-surface-100">{totalStockCount.toLocaleString()} pcs</span>
                </div>
                <div>
                  <span className="text-[10px] text-surface-400 block font-medium">Kabuuang Puhunan</span>
                  <span className="font-bold text-amber-300">₱{totalCostValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-[10px] text-surface-400 block font-medium">Kabuuang Benta pag Naubos</span>
                  <span className="font-bold text-emerald-400">₱{totalSalesValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div>
                  <span className="text-[10px] text-surface-400 block font-medium">Kabuuang Tubo</span>
                  <span className="font-bold text-primary-300">₱{totalEstimatedProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              {result.errors.length>0&&(
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 max-h-[200px] overflow-y-auto">
                  <p className="text-xs font-bold text-rose-300 mb-2">❌ Mga Row na May Error:</p>
                  {result.errors.map((e,i)=>(
                    <div key={i} className="flex items-start gap-2 text-[11px] mb-1.5 border-b border-rose-500/10 pb-1.5">
                      <span className="text-surface-500 font-mono shrink-0">Row {e.row}</span>
                      <span className="text-surface-200 font-semibold truncate flex-1">{e.name}</span>
                      <span className="text-rose-400 shrink-0">{e.msg}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-surface-400 text-center">
                Ang mga na-import na produkto ay makikita na sa Products page.
                {result.errored>0&&' Ayusin ang mga error rows sa Excel at i-import ulit.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-surface-700/60 flex items-center justify-between gap-3 flex-shrink-0 bg-surface-900 rounded-b-2xl">
          <button type="button"
            onClick={step==='done'?onClose:()=>{setStep('upload');setRows([]);setFileName('');}}
            className="px-3.5 py-2 rounded-xl bg-surface-700 hover:bg-surface-600 text-surface-200 text-xs font-semibold transition-colors cursor-pointer">
            {step==='done'?'Isara':step==='preview'?'🔄 Magpalit ng File / Mag-upload Ulit':'← Bumalik'}
          </button>
          <div className="flex items-center gap-2">
            {step==='preview'&&(
              <>
                <span className="text-[11px] text-surface-400">
                  <strong className="text-emerald-400">{importableCount}</strong> handang i-import
                  {errorCount>0&&<span className="text-rose-400 ml-1">({errorCount} may error ay lalaktawan)</span>}
                </span>
                <button type="button" onClick={runImport} disabled={importableCount===0}
                  className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm flex items-center gap-1.5">
                  <span>⬆️</span><span>Kumpirmahin at I-Import ang {importableCount} Products</span>
                </button>
              </>
            )}
            {step==='done'&&result&&result.ok>0&&(
              <button type="button"
                onClick={()=>{setStep('upload');setRows([]);setFileName('');setResult(null);}}
                className="px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold transition-colors cursor-pointer">
                📊 Mag-import ng Isa Pa
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
