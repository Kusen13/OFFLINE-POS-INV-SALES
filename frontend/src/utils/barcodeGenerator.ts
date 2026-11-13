/**
 * Pure SVG Barcode Generator (Code 128 & Code 39)
 * Generates crisp, high-resolution SVG barcodes for thermal printing,
 * shelf tags, and product labels without any external library dependencies.
 */

// Code 128 Patterns (Subset B for standard alphanumeric SKUs and UPCs)
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', // 0-9
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', // 10-19
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', // 20-29
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 30-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', // 40-49
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', // 50-59
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', // 60-69
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 70-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', // 80-89
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', // 90-99
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112' // 100-106 (104=StartB, 106=Stop)
];

const START_B = 104;
const STOP = 106;

/**
 * Encode an alphanumeric string into Code 128 bar widths
 */
export function encodeCode128(text: string): string {
  const clean = text.trim();
  if (!clean) return '';

  const codes: number[] = [START_B];
  let checksum = START_B;

  for (let i = 0; i < clean.length; i++) {
    const charCode = clean.charCodeAt(i);
    const code128Val = charCode - 32; // ASCII to Code 128 Subset B
    if (code128Val >= 0 && code128Val <= 95) {
      codes.push(code128Val);
      checksum += code128Val * (i + 1);
    }
  }

  const checkDigit = checksum % 103;
  codes.push(checkDigit);
  codes.push(STOP);

  return codes.map(c => CODE128_PATTERNS[c] || '').join('');
}

/**
 * Generate an inline SVG string for a given barcode
 */
export function generateBarcodeSVG(text: string, options?: { height?: number; barWidth?: number; showText?: boolean }): string {
  const pattern = encodeCode128(text);
  if (!pattern) return '';

  const barWidth = options?.barWidth ?? 1.5;
  const height = options?.height ?? 40;
  const showText = options?.showText ?? true;

  let totalModules = 0;
  for (let i = 0; i < pattern.length; i++) {
    totalModules += parseInt(pattern[i], 10);
  }

  const svgWidth = totalModules * barWidth + 20; // 10px quiet zone on each side
  const svgHeight = showText ? height + 16 : height;

  let currentX = 10;
  const rects: string[] = [];

  for (let i = 0; i < pattern.length; i++) {
    const w = parseInt(pattern[i], 10) * barWidth;
    const isBar = i % 2 === 0;
    if (isBar) {
      rects.push(`<rect x="${currentX.toFixed(2)}" y="2" width="${w.toFixed(2)}" height="${height}" fill="#000000" style="fill:#000000 !important; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important;" />`);
    }
    currentX += w;
  }

  const textElement = showText
    ? `<text x="${(svgWidth / 2).toFixed(2)}" y="${(height + 13).toFixed(2)}" text-anchor="middle" font-family="monospace" font-size="10" font-weight="bold" fill="#000000">${text}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="print-color-adjust:exact !important; -webkit-print-color-adjust:exact !important; display:block;">
    <rect width="${svgWidth}" height="${svgHeight}" fill="#FFFFFF" />
    ${rects.join('\n    ')}
    ${textElement}
  </svg>`;
}

