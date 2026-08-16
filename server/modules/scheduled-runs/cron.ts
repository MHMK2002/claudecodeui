type CronFields = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
};

type CronValidation =
  | { ok: true; fields: CronFields }
  | { ok: false; error: string };

const FIELD_BOUNDS = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 },
};

function parseField(raw: string, min: number, max: number): Set<number> | null {
  if (raw === '*') {
    const result = new Set<number>();
    for (let value = min; value <= max; value += 1) result.add(value);
    return result;
  }
  if (raw.includes(',')) {
    const result = new Set<number>();
    for (const piece of raw.split(',')) {
      const values = parseField(piece.trim(), min, max);
      if (!values) return null;
      values.forEach((value) => result.add(value));
    }
    return result;
  }
  if (raw.includes('/')) {
    const [range = '', stepRaw = ''] = raw.split('/');
    const step = Number.parseInt(stepRaw, 10);
    if (!Number.isInteger(step) || step <= 0) return null;
    let start: number;
    let end: number;
    if (range === '*') {
      start = min;
      end = max;
    } else if (range.includes('-')) {
      const [startRaw = '', endRaw = ''] = range.split('-');
      start = Number.parseInt(startRaw, 10);
      end = Number.parseInt(endRaw, 10);
    } else {
      start = Number.parseInt(range, 10);
      end = max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    const result = new Set<number>();
    for (let value = start; value <= end; value += step) result.add(value);
    return result;
  }
  if (raw.includes('-')) {
    const [startRaw = '', endRaw = ''] = raw.split('-');
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    const result = new Set<number>();
    for (let value = start; value <= end; value += 1) result.add(value);
    return result;
  }
  const value = Number.parseInt(raw, 10);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < min || value > max) return null;
  return new Set([value]);
}

function parseFiveFields(expression: string): CronValidation {
  const tokens = expression.trim().split(/\s+/);
  if (tokens.length !== 5) {
    return { ok: false, error: `Cron must have exactly 5 fields; got ${tokens.length}.` };
  }
  const [minuteRaw = '', hourRaw = '', dayRaw = '', monthRaw = '', weekdayRaw = ''] = tokens;
  const minute = parseField(minuteRaw, FIELD_BOUNDS.minute.min, FIELD_BOUNDS.minute.max);
  if (!minute) return { ok: false, error: `Invalid minute field: "${minuteRaw}".` };
  const hour = parseField(hourRaw, FIELD_BOUNDS.hour.min, FIELD_BOUNDS.hour.max);
  if (!hour) return { ok: false, error: `Invalid hour field: "${hourRaw}".` };
  const dayOfMonth = parseField(dayRaw, FIELD_BOUNDS.dayOfMonth.min, FIELD_BOUNDS.dayOfMonth.max);
  if (!dayOfMonth) return { ok: false, error: `Invalid day-of-month field: "${dayRaw}".` };
  const month = parseField(monthRaw, FIELD_BOUNDS.month.min, FIELD_BOUNDS.month.max);
  if (!month) return { ok: false, error: `Invalid month field: "${monthRaw}".` };
  const rawWeekdays = parseField(weekdayRaw, FIELD_BOUNDS.dayOfWeek.min, FIELD_BOUNDS.dayOfWeek.max);
  if (!rawWeekdays) return { ok: false, error: `Invalid day-of-week field: "${weekdayRaw}".` };
  const dayOfWeek = new Set<number>();
  rawWeekdays.forEach((value) => dayOfWeek.add(value === 7 ? 0 : value));
  return { ok: true, fields: { minute, hour, dayOfMonth, month, dayOfWeek } };
}

/** Used by Schedules routes to reject malformed five-field cron input. */
export function validateCron(expression: unknown): CronValidation {
  if (typeof expression !== 'string' || !expression.trim()) {
    return { ok: false, error: 'Cron expression is required.' };
  }
  if (/[A-Za-z]/.test(expression)) {
    return { ok: false, error: 'Alphabetic day/month names are not supported. Use numeric fields.' };
  }
  return parseFiveFields(expression);
}

function createZonedPartsReader(timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const weekdayNumber: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return (date: Date) => {
    const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
    const parsedHour = Number.parseInt(values.hour ?? '', 10);
    return {
      month: Number.parseInt(values.month ?? '', 10),
      day: Number.parseInt(values.day ?? '', 10),
      hour: parsedHour === 24 ? 0 : parsedHour,
      minute: Number.parseInt(values.minute ?? '', 10),
      weekday: weekdayNumber[values.weekday ?? ''] ?? date.getUTCDay(),
    };
  };
}

/**
 * Used by the Schedules service and scheduler to calculate one future instant.
 *
 * Cron fields are matched against real UTC instants rendered in the requested
 * IANA timezone. This skips nonexistent spring-forward times and preserves
 * monotonic instants through fall-back repeats.
 */
export function nextRunAt(expression: string, timeZone: string, from: Date): Date {
  const validation = validateCron(expression);
  if (!validation.ok) throw new Error(validation.error);
  const readParts = createZonedPartsReader(timeZone);
  const { minute, hour, dayOfMonth, month, dayOfWeek } = validation.fields;
  const firstMinute = from.getTime() + 60_000 - (from.getTime() % 60_000);
  const maxIterations = 2 * 366 * 24 * 60;

  for (let index = 0; index < maxIterations; index += 1) {
    const probe = new Date(firstMinute + index * 60_000);
    const parts = readParts(probe);
    if (!month.has(parts.month)) continue;
    const dayOfMonthRestricted = dayOfMonth.size !== 31;
    const dayOfWeekRestricted = dayOfWeek.size !== 7;
    const dayMatches = dayOfMonthRestricted && dayOfWeekRestricted
      ? dayOfMonth.has(parts.day) && dayOfWeek.has(parts.weekday)
      : dayOfMonth.has(parts.day) || dayOfWeek.has(parts.weekday);
    if (!dayMatches || !hour.has(parts.hour) || !minute.has(parts.minute)) continue;
    return probe;
  }
  throw new Error(`Could not find a next-run time within two years for "${expression}" in ${timeZone}.`);
}
