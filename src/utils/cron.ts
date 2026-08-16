/**
 * Client-side cron helpers. Mirrors the field grammar and parse semantics of
 * `server/utils/cron.js`. Only `validateCron` and `describeCron` are exposed
 * for live form validation and the next-three-runs preview.
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

type ZonedParts = {
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const WEEKDAY_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function zonedParts(date: Date, formatter: Intl.DateTimeFormat): ZonedParts {
  const values = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const parsedHour = Number.parseInt(values.hour ?? '', 10);
  return {
    month: Number.parseInt(values.month ?? '', 10),
    day: Number.parseInt(values.day ?? '', 10),
    hour: parsedHour === 24 ? 0 : parsedHour,
    minute: Number.parseInt(values.minute ?? '', 10),
    weekday: WEEKDAY_NUMBER[values.weekday ?? ''] ?? date.getUTCDay(),
  };
}

/**
 * Returns the next matching UTC instants while evaluating cron fields in the
 * selected IANA timezone. Probing real instants makes DST gaps skip cleanly
 * and repeated wall-clock minutes remain distinct, monotonic executions.
 */
export function nextCronRuns(
  expr: string,
  timeZone: string,
  from: Date = new Date(),
  count = 3,
): Date[] {
  const validation = validateCron(expr);
  if (!validation.ok) throw new Error(validation.error);
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('Preview count must be between 1 and 20.');
  }

  // Constructing once validates the timezone and avoids rebuilding Intl state
  // for every probed minute.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const { minute, hour, dayOfMonth, month, dayOfWeek } = validation.fields;
  const firstMinute = from.getTime() + 60_000 - (from.getTime() % 60_000);
  const results: Date[] = [];
  const maxIterations = 2 * 366 * 24 * 60;

  for (let index = 0; index < maxIterations && results.length < count; index += 1) {
    const probe = new Date(firstMinute + index * 60_000);
    const parts = zonedParts(probe, formatter);
    if (!month.has(parts.month)) continue;

    const dayOfMonthRestricted = dayOfMonth.size !== 31;
    const dayOfWeekRestricted = dayOfWeek.size !== 7;
    const dayMatches = dayOfMonthRestricted && dayOfWeekRestricted
      ? dayOfMonth.has(parts.day) && dayOfWeek.has(parts.weekday)
      : dayOfMonth.has(parts.day) || dayOfWeek.has(parts.weekday);
    if (!dayMatches || !hour.has(parts.hour) || !minute.has(parts.minute)) continue;
    results.push(probe);
  }

  if (results.length !== count) {
    throw new Error(`Could not find ${count} future runs for this schedule.`);
  }
  return results;
}
