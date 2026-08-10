/**
 * Client-side cron helpers. Mirrors the field grammar and parse semantics of
 * `server/utils/cron.js`. Only `validateCron` and `describeCron` are exposed
 * for live form preview — `nextRunAt` is server-only (it uses timezone-aware
 * Date arithmetic that we don't want to duplicate on the client).
 */

type CronFieldSet = Set<number>;
type ParseResult =
  | { ok: true; fields: { minute: CronFieldSet; hour: CronFieldSet; dayOfMonth: CronFieldSet; month: CronFieldSet; dayOfWeek: CronFieldSet } }
  | { ok: false; error: string };

export type CronValidationResult = ParseResult;

const FIELD_BOUNDS = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 },
};

function parseField(raw: string, min: number, max: number): CronFieldSet | null {
  if (raw === '*') {
    const result = new Set<number>();
    for (let i = min; i <= max; i += 1) result.add(i);
    return result;
  }
  if (raw.includes(',')) {
    const result = new Set<number>();
    for (const piece of raw.split(',')) {
      const sub = parseField(piece.trim(), min, max);
      if (!sub) return null;
      for (const v of sub) result.add(v);
    }
    return result;
  }
  if (raw.includes('/')) {
    const [range, stepStr] = raw.split('/');
    const step = Number.parseInt(stepStr, 10);
    if (!Number.isInteger(step) || step <= 0) return null;
    let start: number;
    let end: number;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((v) => Number.parseInt(v, 10));
      if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
      start = a;
      end = b;
    } else {
      const v = Number.parseInt(range, 10);
      if (!Number.isInteger(v)) return null;
      start = v;
      end = max;
    }
    if (start < min || end > max || start > end) return null;
    const result = new Set<number>();
    for (let v = start; v <= end; v += step) result.add(v);
    return result;
  }
  if (raw.includes('-')) {
    const [aStr, bStr] = raw.split('-');
    const a = Number.parseInt(aStr, 10);
    const b = Number.parseInt(bStr, 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a < min || b > max || a > b) return null;
    const result = new Set<number>();
    for (let v = a; v <= b; v += 1) result.add(v);
    return result;
  }
  const v = Number.parseInt(raw, 10);
  if (!Number.isInteger(v) || v < min || v > max) return null;
  return new Set<number>([v]);
}

function parse5Field(expr: string): ParseResult {
  const tokens = expr.trim().split(/\s+/);
  if (tokens.length !== 5) {
    return {
      ok: false,
      error: `Cron must have exactly 5 fields (minute hour day-of-month month day-of-week); got ${tokens.length}.`,
    };
  }
  const [minuteRaw, hourRaw, domRaw, monthRaw, dowRaw] = tokens;
  const bounds = FIELD_BOUNDS;
  const minute = parseField(minuteRaw, bounds.minute.min, bounds.minute.max);
  if (!minute) return { ok: false, error: `Invalid minute field: "${minuteRaw}".` };
  const hour = parseField(hourRaw, bounds.hour.min, bounds.hour.max);
  if (!hour) return { ok: false, error: `Invalid hour field: "${hourRaw}".` };
  const dayOfMonth = parseField(domRaw, bounds.dayOfMonth.min, bounds.dayOfMonth.max);
  if (!dayOfMonth) return { ok: false, error: `Invalid day-of-month field: "${domRaw}".` };
  const month = parseField(monthRaw, bounds.month.min, bounds.month.max);
  if (!month) return { ok: false, error: `Invalid month field: "${monthRaw}".` };
  const dowSet = parseField(dowRaw, bounds.dayOfWeek.min, bounds.dayOfWeek.max);
  if (!dowSet) return { ok: false, error: `Invalid day-of-week field: "${dowRaw}".` };
  const dayOfWeek = new Set<number>();
  for (const v of dowSet) dayOfWeek.add(v === 7 ? 0 : v);
  return { ok: true, fields: { minute, hour, dayOfMonth, month, dayOfWeek } };
}

export function validateCron(expr: string): ParseResult {
  if (typeof expr !== 'string' || expr.trim() === '') {
    return { ok: false, error: 'Cron expression is required.' };
  }
  if (/[A-Za-z]/.test(expr)) {
    return { ok: false, error: 'Alphabetic day/month names are not supported. Use numeric fields.' };
  }
  return parse5Field(expr);
}

export function describeCron(expr: string, timeZone: string): string {
  const validation = validateCron(expr);
  if (!validation.ok) return validation.error;
  const { minute, hour } = validation.fields;
  const minuteArr = [...minute].sort((a, b) => a - b);
  const hourArr = [...hour].sort((a, b) => a - b);
  const everyMinute = minute.size === 60;
  const everyHour = hour.size === 24;
  const singleMinute = minuteArr.length === 1;
  const singleHour = hourArr.length === 1;
  const pad = (n: number): string => n.toString().padStart(2, '0');

  if (everyMinute && everyHour) return `Every minute (${timeZone})`;
  if (everyHour && singleMinute) return `Every hour at minute ${pad(minuteArr[0])} (${timeZone})`;
  if (everyMinute && singleHour) return `Every minute of hour ${pad(hourArr[0])} (${timeZone})`;
  if (singleHour && singleMinute) return `Every day at ${pad(hourArr[0])}:${pad(minuteArr[0])} (${timeZone})`;
  return `Custom schedule: ${expr} (${timeZone})`;
}