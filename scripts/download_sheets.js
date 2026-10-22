const fs = require('fs');

const sheets = [
  { name: 'product_costing', gid: '428990875' },
  { name: 'oct_2026', gid: '627374354' },
  { name: 're_order', gid: '1144427705' },
  { name: 'monthly_report', gid: '1816728018' },
  { name: 'expenses', gid: '2092636052' },
  { name: 'monthly_bills', gid: '820823208' }
];

async function downloadAll() {
  for (const s of sheets) {
    const url = `https://docs.google.com/spreadsheets/d/1QKqcW_pMvRP46L9XK4KVGyLlWm_Q1D6ihfEfNE0ryzM/export?format=csv&gid=${s.gid}`;
    const res = await fetch(url);
    const csv = await res.text();
    fs.writeFileSync(`scripts/${s.name}.csv`, csv);
    console.log(`Saved ${s.name}.csv (${csv.length} bytes)`);
  }
}

downloadAll().catch(console.error);
