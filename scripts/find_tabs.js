const fs = require('fs');
const html = fs.readFileSync('scripts/sheets_page.html', 'utf8');

const regex = /docs-sheet-tab-caption">([^<]+)<\/div>/g;
let m;
const tabs = [];
while ((m = regex.exec(html)) !== null) {
  tabs.push(m[1]);
}
console.log('Tabs:', tabs);

// Look around where docs-sheet-tab-caption appears to see the tab ID (data-sheet-id or id or href)
const tabBlock = html.slice(html.indexOf('docs-sheet-tab-caption') - 500, html.indexOf('docs-sheet-tab-caption') + 2000);
console.log('Tab Block:\n', tabBlock);
