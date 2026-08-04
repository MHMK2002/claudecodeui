#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const REPORT_SCHEMA_VERSION = 1;
const REPORT_VARIANTS = new Set([
  'baseline-stt',
  'contextual-stt',
  'cleanup-ungated',
  'cleanup-gated',
]);

const HELP = `Usage:
  node scripts/voice-cleanup-benchmark.mjs --manifest <samples.jsonl> --output <report.json>

Options:
  --manifest <path>  JSONL manifest containing local benchmark file references
  --output <path>    New aggregate JSON report (existing files are not overwritten)
  -h, --help         Show this help
`;

class ValidationError extends Error {}

function parseArguments(argv) {
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }

    const equalsIndex = argument.indexOf('=');
    const key = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);

    if (key !== '--manifest' && key !== '--output') {
      throw new ValidationError(`Unknown argument: ${argument}`);
    }

    if (values.has(key)) {
      throw new ValidationError(`Argument supplied more than once: ${key}`);
    }

    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.length === 0 || (inlineValue === undefined && value.startsWith('-'))) {
      throw new ValidationError(`Missing value for ${key}`);
    }

    values.set(key, value);
    if (inlineValue === undefined) {
      index += 1;
    }
  }

  const manifest = values.get('--manifest');
  const output = values.get('--output');
  if (!manifest || !output) {
    throw new ValidationError('Both --manifest and --output are required.');
  }

  const manifestPath = resolve(manifest);
  const outputPath = resolve(output);
  if (manifestPath === outputPath) {
    throw new ValidationError('--manifest and --output must refer to different files.');
  }

  return { help: false, manifestPath, outputPath };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function lineField(lineNumber, field) {
  return `Manifest line ${lineNumber}, field ${field}`;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireOptionalNonNegativeNumber(value, label) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${label} must be a finite non-negative number.`);
  }
  return value;
}

function requireOptionalNonNegativeInteger(value, label) {
  const number = requireOptionalNonNegativeNumber(value, label);
  if (number !== undefined && !Number.isInteger(number)) {
    throw new ValidationError(`${label} must be a non-negative integer.`);
  }
  return number;
}

function requireOptionalBoolean(value, label) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ValidationError(`${label} must be a boolean.`);
  }
  return value;
}

function resolveLocalReference(baseDirectory, value, label) {
  const reference = requireNonEmptyString(value, label);
  if (/^[a-z][a-z\d+.-]*:/iu.test(reference)) {
    throw new ValidationError(`${label} must be a local file path, not a URI.`);
  }
  return resolve(baseDirectory, reference);
}

async function validateFile(path, label) {
  let details;
  try {
    details = await stat(path);
  } catch {
    throw new ValidationError(`${label} does not reference a readable local file.`);
  }
  if (!details.isFile()) {
    throw new ValidationError(`${label} must reference a file.`);
  }
}

async function readTextFile(baseDirectory, value, label) {
  const path = resolveLocalReference(baseDirectory, value, label);
  await validateFile(path, label);
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw new ValidationError(`${label} could not be read as UTF-8 text.`);
  }
}

async function readCriticalSpans(baseDirectory, value, label) {
  if (value === undefined) {
    return [];
  }

  const contents = await readTextFile(baseDirectory, value, label);
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ValidationError(`${label} must contain valid JSON.`);
  }

  const spans = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.spans : undefined;
  if (!Array.isArray(spans)) {
    throw new ValidationError(`${label} must contain a JSON string array or an object with a spans array.`);
  }

  const uniqueSpans = new Set();
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (typeof span !== 'string' || span.length === 0) {
      throw new ValidationError(`${label} contains an invalid span at index ${index}.`);
    }
    uniqueSpans.add(span.normalize('NFKC'));
  }
  return [...uniqueSpans];
}

async function parseResult(result, resultIndex, lineNumber, baseDirectory) {
  const prefix = `results[${resultIndex}]`;
  if (!isRecord(result)) {
    throw new ValidationError(`${lineField(lineNumber, prefix)} must be an object.`);
  }

  const variant = requireNonEmptyString(
    result.variant,
    lineField(lineNumber, `${prefix}.variant`),
  );
  if (variant === 'raw' || variant === 'reference') {
    throw new ValidationError(
      `${lineField(lineNumber, `${prefix}.variant`)} cannot be "raw" or "reference".`,
    );
  }
  if (!REPORT_VARIANTS.has(variant)) {
    throw new ValidationError(
      `${lineField(lineNumber, `${prefix}.variant`)} must use a documented aggregate variant label.`,
    );
  }

  const transcript = await readTextFile(
    baseDirectory,
    result.transcript,
    lineField(lineNumber, `${prefix}.transcript`),
  );

  return {
    variant,
    transcript,
    latencyMs: requireOptionalNonNegativeNumber(
      result.latencyMs,
      lineField(lineNumber, `${prefix}.latencyMs`),
    ),
    fallback: requireOptionalBoolean(
      result.fallback,
      lineField(lineNumber, `${prefix}.fallback`),
    ),
    costUsd: requireOptionalNonNegativeNumber(
      result.costUsd,
      lineField(lineNumber, `${prefix}.costUsd`),
    ),
    harmfulEditCount: requireOptionalNonNegativeInteger(
      result.harmfulEditCount,
      lineField(lineNumber, `${prefix}.harmfulEditCount`),
    ),
  };
}

async function parseSample(record, lineNumber, baseDirectory) {
  if (!isRecord(record)) {
    throw new ValidationError(`Manifest line ${lineNumber} must contain a JSON object.`);
  }

  const id = requireNonEmptyString(record.id, lineField(lineNumber, 'id'));

  if (record.audio !== undefined) {
    const audioPath = resolveLocalReference(
      baseDirectory,
      record.audio,
      lineField(lineNumber, 'audio'),
    );
    await validateFile(audioPath, lineField(lineNumber, 'audio'));
  }

  const raw = record.raw === undefined
    ? undefined
    : await readTextFile(baseDirectory, record.raw, lineField(lineNumber, 'raw'));
  const reference = record.reference === undefined
    ? undefined
    : await readTextFile(baseDirectory, record.reference, lineField(lineNumber, 'reference'));
  const criticalSpans = await readCriticalSpans(
    baseDirectory,
    record.criticalSpans,
    lineField(lineNumber, 'criticalSpans'),
  );

  if (record.results !== undefined && !Array.isArray(record.results)) {
    throw new ValidationError(`${lineField(lineNumber, 'results')} must be an array.`);
  }

  const results = raw === undefined
    ? []
    : [{ variant: 'raw', transcript: raw }];
  const variants = new Set(results.map((result) => result.variant));

  for (const [resultIndex, resultRecord] of (record.results ?? []).entries()) {
    const result = await parseResult(resultRecord, resultIndex, lineNumber, baseDirectory);
    if (variants.has(result.variant)) {
      throw new ValidationError(
        `${lineField(lineNumber, `results[${resultIndex}].variant`)} duplicates another variant in this sample.`,
      );
    }
    variants.add(result.variant);
    results.push(result);
  }

  return { id, reference, criticalSpans, results };
}

async function loadManifest(manifestPath) {
  await validateFile(manifestPath, '--manifest');

  let contents;
  try {
    contents = await readFile(manifestPath, 'utf8');
  } catch {
    throw new ValidationError('--manifest could not be read as UTF-8 text.');
  }

  const samples = [];
  const ids = new Set();
  const baseDirectory = dirname(manifestPath);
  const lines = contents.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new ValidationError(`Manifest line ${index + 1} is not valid JSON.`);
    }

    const sample = await parseSample(record, index + 1, baseDirectory);
    if (ids.has(sample.id)) {
      throw new ValidationError(`Manifest line ${index + 1} has a duplicate id.`);
    }
    ids.add(sample.id);
    samples.push(sample);
  }

  if (samples.length === 0) {
    throw new ValidationError('--manifest must contain at least one sample.');
  }
  return samples;
}

function normalizeText(text) {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function levenshtein(left, right) {
  let columns = left;
  let rows = right;
  if (columns.length > rows.length) {
    [columns, rows] = [rows, columns];
  }

  let previous = Array.from({ length: columns.length + 1 }, (_, index) => index);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const current = [rowIndex + 1];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const substitutionCost = rows[rowIndex] === columns[columnIndex] ? 0 : 1;
      current.push(Math.min(
        current[columnIndex] + 1,
        previous[columnIndex + 1] + 1,
        previous[columnIndex] + substitutionCost,
      ));
    }
    previous = current;
  }
  return previous[columns.length];
}

function divide(numerator, denominator) {
  if (denominator === 0) {
    return numerator === 0 ? 0 : numerator;
  }
  return numerator / denominator;
}

function calculateTextMetrics(candidate, reference) {
  const normalizedCandidate = normalizeText(candidate);
  const normalizedReference = normalizeText(reference);
  const candidateCharacters = [...normalizedCandidate];
  const referenceCharacters = [...normalizedReference];
  const candidateWords = normalizedCandidate.length === 0 ? [] : normalizedCandidate.split(' ');
  const referenceWords = normalizedReference.length === 0 ? [] : normalizedReference.split(' ');
  const characterEdits = levenshtein(referenceCharacters, candidateCharacters);
  const wordEdits = levenshtein(referenceWords, candidateWords);

  return {
    characterEdits,
    referenceCharacters: referenceCharacters.length,
    cer: divide(characterEdits, referenceCharacters.length),
    wordEdits,
    referenceWords: referenceWords.length,
    wer: divide(wordEdits, referenceWords.length),
    normalizedEditDistance: divide(
      characterEdits,
      Math.max(referenceCharacters.length, candidateCharacters.length),
    ),
  };
}

function calculateCriticalSpanMetrics(candidate, criticalSpans) {
  const normalizedCandidate = candidate.normalize('NFKC');
  let preserved = 0;
  for (const span of criticalSpans) {
    if (normalizedCandidate.includes(span)) {
      preserved += 1;
    }
  }
  return { preserved, total: criticalSpans.length };
}

function createAccumulator() {
  return {
    resultCount: 0,
    evaluatedResultCount: 0,
    characterEdits: 0,
    referenceCharacters: 0,
    cerValues: [],
    wordEdits: 0,
    referenceWords: 0,
    werValues: [],
    normalizedEditDistances: [],
    criticalSpansPreserved: 0,
    criticalSpansTotal: 0,
    criticalSpanResultCount: 0,
    harmfulEditCount: 0,
    harmfulEditResultCount: 0,
    latencies: [],
    fallbackCount: 0,
    fallbackResultCount: 0,
    costs: [],
  };
}

function mean(values) {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sortedValues, percentage) {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = Math.ceil((percentage / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function summarizeNumbers(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    reportedResultCount: values.length,
    min: sorted[0],
    mean: mean(values),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

function finalizeAccumulator(accumulator) {
  const report = {
    resultCount: accumulator.resultCount,
    evaluatedResultCount: accumulator.evaluatedResultCount,
  };

  if (accumulator.evaluatedResultCount > 0) {
    report.cer = {
      edits: accumulator.characterEdits,
      referenceUnits: accumulator.referenceCharacters,
      microRate: divide(accumulator.characterEdits, accumulator.referenceCharacters),
      meanRate: mean(accumulator.cerValues),
    };
    report.wer = {
      edits: accumulator.wordEdits,
      referenceUnits: accumulator.referenceWords,
      microRate: divide(accumulator.wordEdits, accumulator.referenceWords),
      meanRate: mean(accumulator.werValues),
    };
    report.normalizedEditDistance = {
      mean: mean(accumulator.normalizedEditDistances),
    };
  }

  if (accumulator.criticalSpanResultCount > 0) {
    report.criticalSpanPreservation = {
      evaluatedResultCount: accumulator.criticalSpanResultCount,
      preserved: accumulator.criticalSpansPreserved,
      total: accumulator.criticalSpansTotal,
      rate: divide(accumulator.criticalSpansPreserved, accumulator.criticalSpansTotal),
    };
  }

  if (accumulator.harmfulEditResultCount > 0) {
    report.harmfulEdits = {
      annotatedResultCount: accumulator.harmfulEditResultCount,
      count: accumulator.harmfulEditCount,
      note: 'Human annotation only; this harness does not infer harmful edits.',
    };
  }

  if (accumulator.latencies.length > 0) {
    report.latencyMs = summarizeNumbers(accumulator.latencies);
  }
  if (accumulator.fallbackResultCount > 0) {
    report.fallback = {
      reportedResultCount: accumulator.fallbackResultCount,
      count: accumulator.fallbackCount,
      rate: accumulator.fallbackCount / accumulator.fallbackResultCount,
    };
  }
  if (accumulator.costs.length > 0) {
    report.costUsd = {
      reportedResultCount: accumulator.costs.length,
      total: accumulator.costs.reduce((total, cost) => total + cost, 0),
      mean: mean(accumulator.costs),
    };
  }

  return report;
}

function buildReport(samples) {
  const variants = new Map();
  let resultCount = 0;
  let evaluatedResultCount = 0;

  for (const sample of samples) {
    for (const result of sample.results) {
      resultCount += 1;
      const accumulator = variants.get(result.variant) ?? createAccumulator();
      variants.set(result.variant, accumulator);
      accumulator.resultCount += 1;

      if (sample.reference !== undefined) {
        const metrics = calculateTextMetrics(result.transcript, sample.reference);
        accumulator.evaluatedResultCount += 1;
        evaluatedResultCount += 1;
        accumulator.characterEdits += metrics.characterEdits;
        accumulator.referenceCharacters += metrics.referenceCharacters;
        accumulator.cerValues.push(metrics.cer);
        accumulator.wordEdits += metrics.wordEdits;
        accumulator.referenceWords += metrics.referenceWords;
        accumulator.werValues.push(metrics.wer);
        accumulator.normalizedEditDistances.push(metrics.normalizedEditDistance);
      }

      if (sample.criticalSpans.length > 0) {
        const critical = calculateCriticalSpanMetrics(result.transcript, sample.criticalSpans);
        accumulator.criticalSpanResultCount += 1;
        accumulator.criticalSpansPreserved += critical.preserved;
        accumulator.criticalSpansTotal += critical.total;
      }

      if (result.harmfulEditCount !== undefined) {
        accumulator.harmfulEditResultCount += 1;
        accumulator.harmfulEditCount += result.harmfulEditCount;
      }
      if (result.latencyMs !== undefined) {
        accumulator.latencies.push(result.latencyMs);
      }
      if (result.fallback !== undefined) {
        accumulator.fallbackResultCount += 1;
        accumulator.fallbackCount += result.fallback ? 1 : 0;
      }
      if (result.costUsd !== undefined) {
        accumulator.costs.push(result.costUsd);
      }
    }
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    privacy: {
      aggregateOnly: true,
      transcriptContentIncluded: false,
      audioContentIncluded: false,
      sampleIdentifiersIncluded: false,
    },
    sampleCount: samples.length,
    resultCount,
    evaluatedResultCount,
    variants: Object.fromEntries(
      [...variants.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([variant, accumulator]) => [variant, finalizeAccumulator(accumulator)]),
    ),
  };
}

async function writeReport(outputPath, report) {
  try {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new ValidationError('--output already exists; choose a new path.');
    }
    throw new ValidationError('--output could not be written.');
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(HELP);
    return;
  }

  const samples = await loadManifest(arguments_.manifestPath);
  const report = buildReport(samples);
  await writeReport(arguments_.outputPath, report);
  process.stdout.write(
    `Wrote aggregate report for ${report.sampleCount} samples and ${report.resultCount} results.\n`,
  );
}

try {
  await main();
} catch (error) {
  if (error instanceof ValidationError) {
    process.stderr.write(`Validation error: ${error.message}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write('Benchmark failed unexpectedly.\n');
    process.exitCode = 1;
  }
}
