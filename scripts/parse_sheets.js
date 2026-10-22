const fs = require('fs');

async function main() {
  const html = fs.readFileSync('scripts/sheets_page.html', 'utf8');

  // Google Sheets tab names are usually in bootstrap data array like: [gid, "Sheet Name", ...]
  // Or in a wj_ or _docs_flag_initialData block
  // Let's search for all occurrences of strings matching tab-like patterns
  // Or search for "Monthly Bills", "Bills", "OCT", "Sales", "Inventory", etc.
  
  // Let's find all gids in the file
  const matches = [...html.matchAll(/(\d{6,11})/g)].map(m => m[1]);
  const uniqueGids = [...new Set(matches)];
  console.log(`Found ${uniqueGids.length} potential gids.`);

  const validSheets = [];

  for (const gid of uniqueGids) {
    try {
      const url = `https://docs.google.com/spreadsheets/d/1QKqcW_pMvRP46L9XK4KVGyLlWm_Q1D6ihfEfNE0ryzM/export?format=csv&gid=${gid}`;
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (text.length > 30 && !text.includes('<!DOCTYPE html>')) {
          validSheets.push({ gid, size: text.length, preview: text.slice(0, 120).replace(/\r?\n/g, ' ') });
          fs.writeFileSync(`scripts/sheet_${gid}.csv`, text);
        }
      }
    } catch (e) {}
  }

  console.log('Valid sheets found:', validSheets);
}

main().catch(console.error);
