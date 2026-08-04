const OPTIONAL_CONTEXT_FIELD = String.raw`(?:prompt|keywords?(?:\[\])?|languages?(?:\[\])?)`;

const DECLARATION_BEFORE_FIELD = new RegExp(
  String.raw`\b(?:unsupported|unknown|unrecognized|unexpected)\s+(?:(?:(?:optional|request)\s+)*(?:field|parameter|argument)(?:\s+supplied)?\s*[:=]?\s*)?["']?${OPTIONAL_CONTEXT_FIELD}(?![a-z])`,
  'iu',
);
const EXTRA_FIELD_DECLARATION = new RegExp(
  String.raw`\bextra\s+(?:optional\s+)?field\s*[:=]?\s*["']?${OPTIONAL_CONTEXT_FIELD}(?![a-z])`,
  'iu',
);
const DECLARATION_AFTER_FIELD = new RegExp(
  String.raw`\b${OPTIONAL_CONTEXT_FIELD}(?![a-z])["']?\s+(?:(?:field|parameter|argument)\s+)?(?:is|are|was|were)?\s*(?:an?\s+)?(?:unsupported|unknown|unrecognized|unexpected|not\s+supported|not\s+permitted|extra\s+field)\b`,
  'iu',
);

const STRUCTURED_PATH_KEYS = new Set(['loc', 'param', 'parameter', 'field', 'path', 'argument']);
const STRUCTURED_DECLARATION_KEYS = new Set(['type', 'code', 'message', 'msg', 'reason']);
const STRUCTURED_DECLARATION =
  /\b(?:extra_forbidden|extra inputs? (?:are )?not permitted|unsupported|unknown|unrecognized|unexpected|not supported|not permitted)\b/iu;

function structuredFieldReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(structuredFieldReference);
  if (typeof value !== 'string') return false;
  return value
    .toLowerCase()
    .split(/[^a-z[\]]+/u)
    .some((part) => /^(?:prompt|keywords?(?:\[\])?|languages?(?:\[\])?)$/u.test(part));
}

function hasStructuredUnsupportedField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasStructuredUnsupportedField);
  if (!value || typeof value !== 'object') return false;

  const entries = Object.entries(value as Record<string, unknown>);
  const namesOptionalField = entries.some(([key, entryValue]) =>
    STRUCTURED_PATH_KEYS.has(key.toLowerCase()) && structuredFieldReference(entryValue),
  );
  const declaresUnsupported = entries.some(([key, entryValue]) =>
    STRUCTURED_DECLARATION_KEYS.has(key.toLowerCase()) &&
    typeof entryValue === 'string' &&
    STRUCTURED_DECLARATION.test(entryValue),
  );
  if (namesOptionalField && declaresUnsupported) return true;
  return entries.some(([, entryValue]) => hasStructuredUnsupportedField(entryValue));
}

export function isUnsupportedSttContextError(status: number, message: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const normalized = String(message).toLowerCase();
  try {
    if (hasStructuredUnsupportedField(JSON.parse(message))) return true;
  } catch {
    // Non-JSON provider errors use the bounded textual patterns below.
  }
  return (
    DECLARATION_BEFORE_FIELD.test(normalized) ||
    EXTRA_FIELD_DECLARATION.test(normalized) ||
    DECLARATION_AFTER_FIELD.test(normalized)
  );
}
