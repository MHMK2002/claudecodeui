import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_RATIO = 4.5;

function parseHsl(value) {
  const match = String(value).match(/^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i);
  if (!match) throw new Error(`Unsupported color token: ${value}`);
  return [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
}

function hslToRgb([hue, saturation, lightness]) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const section = ((hue % 360) + 360) % 360 / 60;
  const intermediate = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] = section < 1 ? [chroma, intermediate, 0]
    : section < 2 ? [intermediate, chroma, 0]
      : section < 3 ? [0, chroma, intermediate]
        : section < 4 ? [0, intermediate, chroma]
          : section < 5 ? [intermediate, 0, chroma]
            : [chroma, 0, intermediate];
  const match = lightness - chroma / 2;
  return [red + match, green + match, blue + match];
}

function luminance(value) {
  return hslToRgb(parseHsl(value))
    .map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

export function contrastRatio(first, second) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

export async function validateTokenContrast() {
  const tokens = JSON.parse(await readFile(path.join(root, 'tokens.json'), 'utf8'));
  const pairs = [
    ['foreground', 'background'],
    ['cardForeground', 'card'],
    ['popoverForeground', 'popover'],
    ['primaryForeground', 'primary'],
    ['primary', 'background'],
    ['messageUserForeground', 'messageUser'],
    ['secondaryForeground', 'secondary'],
    ['mutedForeground', 'background'],
    ['mutedForeground', 'muted'],
    ['accentForeground', 'accent'],
    ['destructiveForeground', 'destructive'],
    ['destructive', 'background'],
  ];
  const failures = [];
  for (const mode of ['light', 'dark']) {
    const palette = tokens.color?.[mode] ?? {};
    for (const [foreground, background] of pairs) {
      const ratio = contrastRatio(palette[foreground]?.$value, palette[background]?.$value);
      if (ratio + Number.EPSILON < REQUIRED_RATIO) {
        failures.push(`${mode}.${foreground} on ${background}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Useful text token contrast must be at least ${REQUIRED_RATIO}:1:\n- ${failures.join('\n- ')}`);
  }
  return pairs.length * 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const checked = await validateTokenContrast();
  console.log(`Contrast check passed for ${checked} light/dark semantic token pairs.`);
}
