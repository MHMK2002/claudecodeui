// Lightweight 5-field cron parser. Rejects 6-field, alphabetic day/month names,
// and any field that fails to parse. Timezone-aware via Intl.DateTimeFormat —
// no luxon/moment dependency.

const FIELD_BOUNDS = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 7 }, // 0 and 7 both mean Sunday (vixie cron)
};

function parseField(raw, min, max) {
  // wildcard
  if (raw === '*') {
    const result = new Set();
    for (let i = min; i <= max; i += 1) {
      result.add(i);
    }
    return result;
  }

  // comma list (each part recursive)
  if (raw.includes(',')) {
    const result = new Set();
    for (const piece of raw.split(',')) {
      const sub = parseField(piece.trim(), min, max);
      if (!sub) return null;
      for (const v of sub) result.add(v);
    }
    return result;
  }

  // step: `*/k`, `n/k`, `n-m/k`
  if (raw.includes('/')) {
    const [range, stepStr] = raw.split('/');
    const step = Number.parseInt(stepStr, 10);
    if (!Number.isInteger(step) || step <= 0) return null;
    let start;
    let end;
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
    const result = new Set();
    for (let v = start; v <= end; v += step) result.add(v);
    return result;
  }

  // range: `n-m`
  if (raw.includes('-')) {
    const [aStr, bStr] = raw.split('-');
    const a = Number.parseInt(aStr, 10);
    const b = Number.parseInt(bStr, 10);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    if (a < min || b > max || a > b) return null;
    const result = new Set();
    for (let v = a; v <= b; v += 1) result.add(v);
    return result;
  }

  // single value
  const v = Number.parseInt(raw, 10);
  if (!Number.isInteger(v) || v < min || v > max) return null;
  return new Set([v]);
}

function parse5Field(expr) {
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
  const dowRawSet = parseField(dowRaw, bounds.dayOfWeek.min, bounds.dayOfWeek.max);
  if (!dowRawSet) return { ok: false, error: `Invalid day-of-week field: "${dowRaw}".` };

  // normalize 7 → 0 (Sunday)
  const dayOfWeek = new Set();
  for (const v of dowRawSet) {
    dayOfWeek.add(v === 7 ? 0 : v);
  }

  return {
    ok: true,
    fields: { minute, hour, dayOfMonth, month, dayOfWeek },
  };
}

function validateCron(expr) {
  if (typeof expr !== 'string' || expr.trim() === '') {
    return { ok: false, error: 'Cron expression is required.' };
  }
  // Reject alphabetic day/month names explicitly; we only support numeric.
  if (/[A-Za-z]/.test(expr)) {
    return { ok: false, error: 'Alphabetic day/month names are not supported. Use numeric fields.' };
  }
  return parse5Field(expr);
}

function partsFor(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value ?? '';

  const year = Number.parseInt(part('year'), 10);
  const month = Number.parseInt(part('month'), 10);
  const day = Number.parseInt(part('day'), 10);
  let hour = Number.parseInt(part('hour'), 10);
  if (hour === 24) hour = 0;
  const minute = Number.parseInt(part('minute'), 10);
  const second = Number.parseInt(part('second'), 10);

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = weekdayMap[part('weekday')] ?? new Date(date).getUTCDay();

  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = Math.round((wallAsUtc - date.getTime()) / 60000) * -1;

  return { year, month, day, hour, minute, second, weekday, offsetMinutes };
}

function utcDateFromWall(year, month, day, hour, minute, offsetMinutes) {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(wall + offsetMinutes * 60000);
}

function nextRunAt(expr, timeZone, from) {
  const validation = validateCron(expr);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const { minute, hour, dayOfMonth, month, dayOfWeek } = validation.fields;

  const cursor = new Date(from.getTime() + 60_000 - (from.getTime() % 60_000));

  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i += 1) {
    const probe = new Date(cursor.getTime() + i * 60_000);
    const p = partsFor(probe, timeZone);

    if (!month.has(p.month)) continue;
    const domRestricted = dayOfMonth.size !== 31;
    const dowRestricted = dayOfWeek.size !== 7;
    if (domRestricted && dowRestricted) {
      if (!dayOfMonth.has(p.day) || !dayOfWeek.has(p.weekday)) continue;
    } else {
      if (!dayOfMonth.has(p.day) && !dayOfWeek.has(p.weekday)) continue;
    }
    if (!hour.has(p.hour)) continue;
    if (!minute.has(p.minute)) continue;

    return utcDateFromWall(p.year, p.month, p.day, p.hour, p.minute, p.offsetMinutes);
  }

  throw new Error(`Could not find a next-run time within one year for "${expr}" in ${timeZone}.`);
}

function describeCron(expr, timeZone) {
  const validation = validateCron(expr);
  if (!validation.ok) return validation.error;
  const { minute, hour } = validation.fields;
  const minuteArr = [...minute].sort((a, b) => a - b);
  const hourArr = [...hour].sort((a, b) => a - b);
  const everyMinute = minute.size === 60;
  const everyHour = hour.size === 24;
  const singleMinute = minuteArr.length === 1;
  const singleHour = hourArr.length === 1;

  const pad = (n) => n.toString().padStart(2, '0');

  if (everyMinute && everyHour) return `Every minute (${timeZone})`;
  if (everyHour && singleMinute) return `Every hour at minute ${pad(minuteArr[0])} (${timeZone})`;
  if (everyMinute && singleHour) return `Every minute of hour ${pad(hourArr[0])} (${timeZone})`;
  if (singleHour && singleMinute) return `Every day at ${pad(hourArr[0])}:${pad(minuteArr[0])} (${timeZone})`;
  return `Custom schedule: ${expr} (${timeZone})`;
}

export {
  validateCron,
  nextRunAt,
  describeCron,
};
