const fs = require('fs');
const html = fs.readFileSync('scripts/sheets_page.html', 'utf8');

// Search for each tab name in the html and see surrounding text
const tabNames = ['PRODUCT COSTING', 'OCT 2026', 'RE-ORDER', ' MONTHLY REPORT', 'EXPENSES', 'MONTHLY BILLS'];
for (const name of tabNames) {
  let pos = 0;
  while ((pos = html.indexOf(name, pos)) !== -1) {
    // print 100 chars before and 100 chars after
    console.log(`=== ${name} at pos ${pos} ===`);
    console.log(html.slice(Math.max(0, pos - 150), pos + 250));
    pos += name.length + 1;
  }
}
