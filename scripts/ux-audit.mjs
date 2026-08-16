import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateTokenContrast } from './contrast-check.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = path.join(projectRoot, 'ux-baseline.json');
const sourceRoots = ['src', 'electron'];
const sourceExtensions = new Set(['.css', '.html', '.js', '.jsx', '.ts', '.tsx']);

async function validateCanonicalTokens() {
  const [tokens, css] = await Promise.all([
    readFile(path.join(projectRoot, 'tokens.json'), 'utf8').then(JSON.parse),
    readFile(path.join(projectRoot, 'src', 'index.css'), 'utf8'),
  ]);
  const lightBlock = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n\s*\}/)?.[1] || '';
  const toCssName = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

  for (const [mode, block] of [['light', lightBlock], ['dark', darkBlock]]) {
    if (!block) throw new Error(`Cannot locate the ${mode} canonical token block in src/index.css.`);
    for (const [name, token] of Object.entries(tokens.color?.[mode] || {})) {
      const components = String(token.$value || '').match(/^hsl\((.+)\)$/)?.[1];
      if (!components) throw new Error(`tokens.json color.${mode}.${name} must be an hsl() token.`);
      const declaration = `--${toCssName(name)}: ${components};`;
      if (!block.includes(declaration)) {
        throw new Error(`tokens.json drift: ${mode}.${name} does not match src/index.css (${declaration}).`);
      }
    }
  }
}

const ruleDescriptions = {
  'a11y-click-target': 'A non-semantic element has an onClick handler without complete keyboard semantics.',
  'a11y-focus-suppressed': 'An interactive control suppresses its outline without an explicit focus-visible replacement.',
  'a11y-icon-button-name': 'An icon-only button has no aria-label, aria-labelledby, or title.',
  'a11y-image-alt': 'An image has no alt attribute.',
  'a11y-touch-target': 'An icon-only control declares a target smaller than the 44px contract.',
  'feedback-browser-dialog': 'Product feedback uses window alert/confirm instead of an in-product surface.',
  'raw-color-value': 'A component contains a literal hex/rgb/hsl color outside the canonical token source.',
  'raw-modal-surface': 'A component creates a fixed full-screen modal outside shared UI primitives.',
  'raw-tailwind-color': 'A component uses a palette-specific Tailwind color instead of a semantic token.',
  'useful-text-opacity': 'Useful text is dimmed with opacity or a low-alpha text color.'
};

async function collectFiles(relativeDirectory) {
  const absoluteDirectory = path.join(projectRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      if (['assets', 'node_modules'].includes(entry.name)) continue;
      files.push(...await collectFiles(relativePath));
      continue;
    }

    if (!sourceExtensions.has(path.extname(entry.name))) continue;
    if (/\.(?:test|spec|stories)\.[^.]+$/.test(entry.name)) continue;
    files.push(relativePath);
  }

  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function normalizeSample(value) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function findAll(source, expression) {
  const matches = [];
  expression.lastIndex = 0;
  for (let match = expression.exec(source); match; match = expression.exec(source)) {
    matches.push({ index: match.index, value: match[0] });
    if (match[0].length === 0) expression.lastIndex += 1;
  }
  return matches;
}

function scanFile(file, source) {
  const findings = [];
  const addMatches = (rule, matches) => {
    for (const match of matches) {
      findings.push({
        rule,
        file,
        line: lineNumberAt(source, match.index),
        sample: normalizeSample(match.value)
      });
    }
  };

  if (file !== 'src/index.css' && file !== 'src/components/shell/constants/constants.ts') {
    addMatches('raw-color-value', findAll(source, /#[0-9a-f]{3,8}\b|rgba?\([^\n)]*\)|hsla?\([^\n)]*\)/gi));
  }

  addMatches('raw-tailwind-color', findAll(
    source,
    /\b(?:bg|text|border|ring|ring-offset|from|via|to|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00)(?:\/[0-9]{1,3})?\b/g
  ));

  addMatches('useful-text-opacity', findAll(
    source,
    /\btext-(?:foreground|muted-foreground|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00))\/(?:[0-8]?[0-9])\b|<(?:h[1-6]|label|p|span)\b[^>]*\bopacity-(?:[0-8]?[0-9])\b[^>]*>/g
  ));

  addMatches('a11y-focus-suppressed', findAll(
    source,
    /<(?:a|button|input|select|textarea)\b(?:(?!>).)*(?:focus:outline-none|\boutline-none\b)(?:(?!>).)*>/gs
  ).filter((match) => !/focus-visible:|focus:ring-|focus-visible=/.test(match.value)));

  addMatches('a11y-click-target', findAll(
    source,
    /<(?:div|span)\b(?:(?!>).)*\bonClick\s*=\s*\{(?:(?!>).)*>/gs
  ).filter((match) => !/\brole\s*=|\btabIndex\s*=|\bonKeyDown\s*=/.test(match.value)));

  addMatches('a11y-image-alt', findAll(
    source,
    /<img\b(?:(?!>).)*>/gs
  ).filter((match) => !/\balt\s*=/.test(match.value)));

  const allIconButtons = findAll(
    source,
    /<button\b(?:(?!>).)*>(?:\s|\{\/\*[\s\S]*?\*\/\})*<[A-Z][A-Za-z0-9]*(?:(?!>).)*(?:\/>|>[\s\S]*?<\/[A-Z][A-Za-z0-9]*>)(?:\s|\{\/\*[\s\S]*?\*\/\})*<\/button>/g
  );
  const iconButtons = allIconButtons.filter(
    (match) => !/\baria-label\s*=|\baria-labelledby\s*=|\btitle\s*=/.test(match.value),
  );
  addMatches('a11y-icon-button-name', iconButtons);

  addMatches('a11y-touch-target', allIconButtons.filter((match) => {
    const hasSmallSize = /\b(?:h|w)-(?:[1-9]|10)\b|\b(?:h|w)-\[(?:[1-3][0-9]|4[0-3])px\]/.test(match.value);
    const hasMinimumSize = /\bmin-(?:h|w)-11\b|\b(?:h|w)-(?:11|12|14|16)\b/.test(match.value);
    return hasSmallSize && !hasMinimumSize;
  }));

  if (!file.startsWith('src/components/ui/') && !file.startsWith('src/shared/view/ui/')) {
    addMatches('raw-modal-surface', findAll(
      source,
      /className\s*=\s*(?:"[^"]*\bfixed\b[^"]*\binset-0\b[^"]*"|'[^']*\bfixed\b[^']*\binset-0\b[^']*'|\{`[^`]*\bfixed\b[^`]*\binset-0\b[^`]*`\})/g
    ));
  }

  addMatches('feedback-browser-dialog', findAll(source, /\b(?:window\.)?(?:alert|confirm)\s*\(/g));

  return findings;
}

function summarize(findings) {
  const violations = {};
  const fingerprints = {};
  const totals = {};

  for (const rule of Object.keys(ruleDescriptions)) {
    violations[rule] = {};
    fingerprints[rule] = {};
    totals[rule] = 0;
  }

  for (const finding of findings) {
    violations[finding.rule][finding.file] = (violations[finding.rule][finding.file] ?? 0) + 1;
    const fingerprint = createHash('sha256')
      .update(`${finding.rule}\0${finding.file}\0${finding.sample}`)
      .digest('hex');
    fingerprints[finding.rule][finding.file] ??= [];
    fingerprints[finding.rule][finding.file].push(fingerprint);
    totals[finding.rule] += 1;
  }

  for (const files of Object.values(fingerprints)) {
    for (const values of Object.values(files)) values.sort();
  }

  return {
    version: 2,
    policy: 'Existing exact fingerprints are debt. CI fails for every new or replacement fingerprint; moved line numbers do not create false positives.',
    rules: ruleDescriptions,
    totals,
    violations,
    fingerprints,
  };
}

function compareWithBaseline(current, baseline, findings) {
  const regressions = [];
  for (const [rule, files] of Object.entries(current.fingerprints)) {
    for (const [file, values] of Object.entries(files)) {
      const allowedCounts = new Map();
      for (const fingerprint of baseline.fingerprints?.[rule]?.[file] ?? []) {
        allowedCounts.set(fingerprint, (allowedCounts.get(fingerprint) ?? 0) + 1);
      }
      const newFingerprints = [];
      for (const fingerprint of values) {
        const remaining = allowedCounts.get(fingerprint) ?? 0;
        if (remaining > 0) allowedCounts.set(fingerprint, remaining - 1);
        else newFingerprints.push(fingerprint);
      }
      if (newFingerprints.length === 0) continue;

      const pending = new Map();
      for (const fingerprint of newFingerprints) pending.set(fingerprint, (pending.get(fingerprint) ?? 0) + 1);
      const samples = [];
      for (const finding of findings.filter((item) => item.rule === rule && item.file === file)) {
        const fingerprint = createHash('sha256')
          .update(`${finding.rule}\0${finding.file}\0${finding.sample}`)
          .digest('hex');
        const remaining = pending.get(fingerprint) ?? 0;
        if (remaining === 0) continue;
        samples.push({ line: finding.line, sample: finding.sample });
        pending.set(fingerprint, remaining - 1);
      }
      regressions.push({
        rule,
        file,
        allowed: baseline.violations?.[rule]?.[file] ?? 0,
        count: current.violations?.[rule]?.[file] ?? 0,
        samples,
      });
    }
  }
  return regressions;
}

await validateCanonicalTokens();
await validateTokenContrast();

const files = (await Promise.all(sourceRoots.map(collectFiles))).flat().sort();
const findings = [];
for (const file of files) {
  findings.push(...scanFile(file, await readFile(path.join(projectRoot, file), 'utf8')));
}

const current = summarize(findings);
const shouldWrite = process.argv.includes('--write-baseline');
const printJson = process.argv.includes('--json');

if (shouldWrite) {
  await writeFile(baselinePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  console.log(`Wrote UX baseline with ${findings.length} findings across ${files.length} source files.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
} catch (error) {
  console.error(`Cannot read ${path.relative(projectRoot, baselinePath)}. Run npm run ux:audit -- --write-baseline once.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const regressions = compareWithBaseline(current, baseline, findings);
if (printJson) {
  console.log(JSON.stringify({ totals: current.totals, regressions }, null, 2));
} else if (regressions.length > 0) {
  console.error(`UX audit found ${regressions.length} new violation group(s):`);
  for (const regression of regressions) {
    console.error(`- ${regression.rule}: ${regression.file} (${regression.allowed} -> ${regression.count})`);
    for (const sample of regression.samples) console.error(`  ${regression.file}:${sample.line} ${sample.sample}`);
  }
} else {
  console.log(`UX audit passed: no new violations. Current baseline debt: ${findings.length}.`);
}

process.exitCode = regressions.length > 0 ? 1 : 0;
