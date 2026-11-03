/**
 * WCAG 2.1 Contrast Ratio Verification (Zero External Dependencies)
 * Computes relative luminance and contrast ratios following W3C specifications.
 * Evaluates semantic color tokens and alpha-composited elements against actual CSS backgrounds.
 *
 * NOTE: This script provides mathematical verification of designed color tokens.
 * Empirical in-browser computed style checks (via getComputedStyle) are documented
 * in QA reports (docs/qa/v1-recheck.md). We do not claim universal WCAG compliance.
 */

function parseHex(hex) {
  let c = hex.replace('#', '').trim();
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const num = parseInt(c, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]) {
  const [sR, sG, sB] = [r, g, b].map(val => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(parseHex(hex1));
  const l2 = relativeLuminance(parseHex(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Composites a semi-transparent foreground color over a solid background color.
 */
function compositeAlpha(tintHex, containerBgHex, alpha) {
  const [tR, tG, tB] = parseHex(tintHex);
  const [bgR, bgG, bgB] = parseHex(containerBgHex);
  const r = Math.round(tR * alpha + bgR * (1 - alpha));
  const g = Math.round(tG * alpha + bgG * (1 - alpha));
  const b = Math.round(tB * alpha + bgB * (1 - alpha));
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Actual CSS surface backgrounds defined in styles.css
const surfaces = {
  bgPrimary: '#0a0e14',
  bgSecondary: '#121820',
  bgSurface: '#1a222d',
  bgSurfaceHover: '#222c3a',
};

// Text color tokens in styles.css
const textTokens = {
  textPrimary: '#f0f4f8',
  textSecondary: '#94a3b8',
  textMuted: '#8fa0b5',
};

let failedCount = 0;
function assertThreshold(description, ratio, threshold) {
  const passed = ratio >= threshold;
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`  ${description.padEnd(46)}: ${ratio.toFixed(2)}:1 | ${status} (min ${threshold}:1)`);
  if (!passed) failedCount++;
}

console.log('=== WCAG 2.1 AA Contrast Verification ===\n');

console.log('1. Text Tokens on CSS Surface Backgrounds (Threshold: 4.5:1 AA Normal):');
for (const [bgName, bgHex] of Object.entries(surfaces)) {
  for (const [textName, textHex] of Object.entries(textTokens)) {
    const ratio = contrastRatio(textHex, bgHex);
    assertThreshold(`${textName} on ${bgName} (${bgHex})`, ratio, 4.5);
  }
}

console.log('\n2. Primary Action Button (Threshold: 4.5:1 AA Normal):');
const btnPrimaryRatio = contrastRatio('#041019', '#38bdf8');
assertThreshold('Button text (#041019) on accent-blue (#38bdf8)', btnPrimaryRatio, 4.5);

console.log('\n3. Alpha-Composited Badges on Secondary Background (#121820) (Threshold: 4.5:1):');
const badges = [
  { name: 'failure (danger)', text: '#f87171', tint: '#f87171', alpha: 0.15 },
  { name: 'success', text: '#34d399', tint: '#34d399', alpha: 0.15 },
  { name: 'open (warning)', text: '#fbbf24', tint: '#fbbf24', alpha: 0.15 },
  { name: 'in_progress (accent)', text: '#38bdf8', tint: '#38bdf8', alpha: 0.12 },
  { name: 'closed / unclassified', text: '#94a3b8', tint: '#64748b', alpha: 0.20 },
];

for (const b of badges) {
  const effectiveBg = compositeAlpha(b.tint, surfaces.bgSecondary, b.alpha);
  const ratio = contrastRatio(b.text, effectiveBg);
  assertThreshold(`Badge ${b.name} on bgSecondary`, ratio, 4.5);
}

console.log('\n4. Alpha-Composited Badges on Card Surface (#1a222d) (Threshold: 4.5:1):');
for (const b of badges) {
  const effectiveBg = compositeAlpha(b.tint, surfaces.bgSurface, b.alpha);
  const ratio = contrastRatio(b.text, effectiveBg);
  assertThreshold(`Badge ${b.name} on bgSurface`, ratio, 4.5);
}

console.log('\n5. Modal Dialog & Error States on bgSurface (#1a222d) (Threshold: 4.5:1):');
const modalTextRatio = contrastRatio('#f0f4f8', surfaces.bgSurface);
assertThreshold('Modal heading/body text on bgSurface', modalTextRatio, 4.5);

const errorBoxBg = compositeAlpha('#f87171', surfaces.bgSurface, 0.15);
const errorTextRatio = contrastRatio('#f87171', errorBoxBg);
assertThreshold('Error text (#f87171) on error state box', errorTextRatio, 4.5);

console.log(`\nVerification finished: ${failedCount === 0 ? 'ALL CHECKS PASSED' : `${failedCount} CHECKS FAILED`}.\n`);
if (failedCount > 0) {
  process.exit(1);
}
