const MAX_NORMALIZED_TOKEN_EDIT_RATIO = 0.35;

export type VoiceCleanupRejectionReason =
  | 'candidate_empty'
  | 'placeholder_missing'
  | 'placeholder_duplicate'
  | 'placeholder_reordered'
  | 'placeholder_modified'
  | 'protected_span_changed'
  | 'lexical_change_unsafe'
  | 'length_out_of_range'
  | 'edit_ratio_exceeded';

export interface VoiceCleanupPlaceholder {
  readonly token: string;
  readonly value: string;
}

export interface PreparedVoiceCleanup {
  readonly rawText: string;
  readonly maskedText: string;
  readonly placeholderNamespace: string;
  readonly placeholders: readonly VoiceCleanupPlaceholder[];
}

export type VoiceCleanupValidationResult =
  | {
      readonly accepted: true;
      readonly reason: 'accepted';
      readonly text: string;
    }
  | {
      readonly accepted: false;
      readonly reason: VoiceCleanupRejectionReason;
      readonly text: string;
    };

interface ProtectedSpan {
  readonly start: number;
  readonly end: number;
}

const PROTECTED_PATTERNS: readonly RegExp[] = [
  // Quoted content is kept as a single protected span, including anything
  // inside it that would independently match another rule.
  /"(?:\\[\s\S]|[^"\\])*"/gu,
  /(?<![\p{L}\p{N}_])'(?:\\[\s\S]|[^'\\])*'(?![\p{L}\p{N}_])/gu,
  /`(?:\\[\s\S]|[^`\\])*`/gu,
  /“[^”]*”/gu,
  /‘[^’]*’/gu,
  /«[^»]*»/gu,

  // URLs and filesystem paths precede identifiers so the complete value is
  // represented by one placeholder.
  /\b(?:https?|wss?|ftp):\/\/[^\s<>"'`]+/giu,
  /\b[A-Za-z]:\\(?:[^\s<>"'`\\]+\\?)+/gu,
  /(?<![\p{L}\p{N}_])(?:~\/|\.{1,2}\/|\/)[^\s<>"'`]+/gu,
  /(?<![\p{L}\p{N}_])(?:[\p{L}\p{N}_.@-]+\/)+(?:[\p{L}\p{N}_.@-]+)/gu,

  // Command-line flags, including an optional inline assignment.
  /(?<![\p{L}\p{N}_])--?[A-Za-z][A-Za-z0-9-]*(?:=(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+))?/gu,

  // Dotted identifiers, snake_case names, camel/PascalCase names, and
  // hyphenated model identifiers such as gpt-4o-mini.
  /(?<![A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$-]*(?:\.[A-Za-z_$][A-Za-z0-9_$-]*)+(?![A-Za-z0-9_$])/gu,
  /(?<![A-Za-z0-9_$])[A-Za-z_$][A-Za-z0-9_$]*(?:_[A-Za-z0-9_$]+)+(?![A-Za-z0-9_$])/gu,
  /(?<![A-Za-z0-9_$])(?:[a-z_$][a-z0-9_$]*[A-Z][A-Za-z0-9_$]*|[A-Z][a-z0-9_$]+(?:[A-Z][A-Za-z0-9_$]*)+|[A-Z]{2,}[A-Za-z0-9_$]*)(?![A-Za-z0-9_$])/gu,
  /(?<![A-Za-z0-9])[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+(?![A-Za-z0-9])/gu,

  // Numeric literals include decimal/version-like values, hexadecimal,
  // scientific notation, and Persian/Arabic digits.
  /(?<![\p{L}\p{N}_])[-+]?(?:0[xX][0-9A-Fa-f]+|0[bB][01]+|0[oO][0-7]+|[\p{N}]+(?:[._٬٫][\p{N}]+)*(?:[eE][-+]?[\p{N}]+)?)(?![\p{L}\p{N}_])/gu,

  // Negation carries disproportionate semantic weight and must not be
  // silently removed or inverted by cleanup.
  /\b(?:no|not|never|cannot|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|mustn['’]t)\b/giu,
  /(?<![\p{L}\p{N}_])(?:نه|هرگز|اصلاً|ابداً|بدون|نباید|نیست(?:م|ی|یم|ید|ند)?|نمی(?:‌?[\p{L}\p{M}]+)?|نکن(?:م|ی|د|یم|ید|ند)?|نشد(?:م|ی|ه|یم|ید|ند)?|نکرد(?:م|ی|ه|یم|ید|ند)?|نبود(?:م|ی|ه|یم|ید|ند)?|نخواه(?:م|ی|د|یم|ید|ند))(?![\p{L}\p{N}_])/gu,
];

function collectProtectedSpans(text: string): ProtectedSpan[] {
  const matches: ProtectedSpan[] = [];

  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  matches.sort((left, right) =>
    left.start - right.start || right.end - left.end,
  );

  const selected: ProtectedSpan[] = [];
  let protectedUntil = -1;
  for (const match of matches) {
    if (match.start < protectedUntil) {
      continue;
    }
    selected.push(match);
    protectedUntil = match.end;
  }

  return selected;
}

function createPlaceholderNamespace(rawText: string): string {
  let nonce = 0;
  let namespace = `VOICE_CLEANUP_${nonce}_`;
  while (rawText.includes(namespace)) {
    nonce += 1;
    namespace = `VOICE_CLEANUP_${nonce}_`;
  }
  return namespace;
}

/** Masks semantically sensitive spans before a transcript is sent for cleanup. */
export function prepareVoiceCleanup(rawText: string): PreparedVoiceCleanup {
  const spans = collectProtectedSpans(rawText);
  const placeholderNamespace = createPlaceholderNamespace(rawText);
  const placeholders: VoiceCleanupPlaceholder[] = [];
  let maskedText = '';
  let cursor = 0;

  spans.forEach((span, index) => {
    const value = rawText.slice(span.start, span.end);
    const token = `⟪${placeholderNamespace}${index.toString().padStart(4, '0')}⟫`;
    maskedText += rawText.slice(cursor, span.start) + token;
    placeholders.push({ token, value });
    cursor = span.end;
  });
  maskedText += rawText.slice(cursor);

  return {
    rawText,
    maskedText,
    placeholderNamespace,
    placeholders,
  };
}

function countOccurrences(text: string, value: string): number {
  let count = 0;
  let offset = 0;
  while (offset <= text.length - value.length) {
    const index = text.indexOf(value, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + value.length;
  }
  return count;
}

function restorePlaceholders(
  candidate: string,
  placeholders: readonly VoiceCleanupPlaceholder[],
): string {
  let restored = candidate;
  for (const placeholder of placeholders) {
    restored = restored.replace(placeholder.token, placeholder.value);
  }
  return restored;
}

function protectedValues(text: string): string[] {
  return collectProtectedSpans(text).map((span) => text.slice(span.start, span.end));
}

function characterCount(text: string): number {
  return Array.from(text).length;
}

function normalizedTokens(text: string): string[] {
  const normalized = text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[‌‍]/gu, '');
  return normalized.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? [];
}

function tokenEditDistance(source: readonly string[], target: readonly string[]): number {
  if (source.length > target.length) {
    return tokenEditDistance(target, source);
  }

  let previous = Array.from({ length: source.length + 1 }, (_, index) => index);
  for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
    const current = [targetIndex];
    for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
      const substitutionCost =
        source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      current[sourceIndex] = Math.min(
        current[sourceIndex - 1] + 1,
        previous[sourceIndex] + 1,
        previous[sourceIndex - 1] + substitutionCost,
      );
    }
    previous = current;
  }
  return previous[source.length];
}

function normalizedTokenEditRatio(source: string, target: string): number {
  const sourceTokens = normalizedTokens(source);
  const targetTokens = normalizedTokens(target);
  const denominator = Math.max(sourceTokens.length, targetTokens.length);
  if (denominator === 0) {
    return 0;
  }
  return tokenEditDistance(sourceTokens, targetTokens) / denominator;
}

const REMOVABLE_FILLER_TOKENS = new Set([
  'um',
  'uh',
  'erm',
  'er',
  'hmm',
  'hm',
  'امم',
  'اِم',
]);

function hasOnlySafeLexicalRemovals(source: string, target: string): boolean {
  const sourceTokens = normalizedTokens(source);
  const targetTokens = normalizedTokens(target);
  let sourceIndex = 0;
  let targetIndex = 0;

  while (sourceIndex < sourceTokens.length) {
    const sourceToken = sourceTokens[sourceIndex];
    let sourceRunEnd = sourceIndex + 1;
    while (sourceTokens[sourceRunEnd] === sourceToken) sourceRunEnd += 1;
    const sourceRunLength = sourceRunEnd - sourceIndex;

    let targetRunEnd = targetIndex;
    while (targetTokens[targetRunEnd] === sourceToken) targetRunEnd += 1;
    const targetRunLength = targetRunEnd - targetIndex;

    if (targetRunLength > sourceRunLength) return false;
    if (targetRunLength === 0 && !REMOVABLE_FILLER_TOKENS.has(sourceToken)) {
      return false;
    }

    sourceIndex = sourceRunEnd;
    targetIndex = targetRunEnd;
  }

  return targetIndex === targetTokens.length;
}

function reject(
  prepared: PreparedVoiceCleanup,
  reason: VoiceCleanupRejectionReason,
): VoiceCleanupValidationResult {
  return { accepted: false, reason, text: prepared.rawText };
}

/** Validates a model candidate and restores protected content byte-for-byte. */
export function validateAndRestoreVoiceCleanup(
  prepared: PreparedVoiceCleanup,
  candidate: string,
): VoiceCleanupValidationResult {
  if (candidate.trim().length === 0) {
    return reject(prepared, 'candidate_empty');
  }

  const occurrenceCounts = prepared.placeholders.map((placeholder) =>
    countOccurrences(candidate, placeholder.token),
  );
  if (occurrenceCounts.some((count) => count > 1)) {
    return reject(prepared, 'placeholder_duplicate');
  }

  let candidateWithoutExpectedPlaceholders = candidate;
  for (const placeholder of prepared.placeholders) {
    candidateWithoutExpectedPlaceholders = candidateWithoutExpectedPlaceholders
      .split(placeholder.token)
      .join('');
  }
  if (candidateWithoutExpectedPlaceholders.includes(prepared.placeholderNamespace)) {
    return reject(prepared, 'placeholder_modified');
  }
  if (occurrenceCounts.some((count) => count === 0)) {
    return reject(prepared, 'placeholder_missing');
  }

  let previousPosition = -1;
  for (const placeholder of prepared.placeholders) {
    const position = candidate.indexOf(placeholder.token);
    if (position < previousPosition) {
      return reject(prepared, 'placeholder_reordered');
    }
    previousPosition = position;
  }

  const restored = restorePlaceholders(candidate, prepared.placeholders);
  const expectedProtectedValues = prepared.placeholders.map(({ value }) => value);
  const restoredProtectedValues = protectedValues(restored);
  if (
    restoredProtectedValues.length !== expectedProtectedValues.length ||
    restoredProtectedValues.some((value, index) => value !== expectedProtectedValues[index])
  ) {
    return reject(prepared, 'protected_span_changed');
  }
  const rawLength = characterCount(prepared.rawText);
  const restoredLength = characterCount(restored);
  if (restoredLength * 2 < rawLength || restoredLength * 2 > rawLength * 3) {
    return reject(prepared, 'length_out_of_range');
  }

  if (!hasOnlySafeLexicalRemovals(prepared.rawText, restored)) {
    return reject(prepared, 'lexical_change_unsafe');
  }

  if (
    normalizedTokenEditRatio(prepared.rawText, restored) >
    MAX_NORMALIZED_TOKEN_EDIT_RATIO
  ) {
    return reject(prepared, 'edit_ratio_exceeded');
  }

  return { accepted: true, reason: 'accepted', text: restored };
}
