export type MessageTimestampValue = string | number | Date | null | undefined;

export type MessageTimestampFormatOptions = {
  locale?: Intl.LocalesArgument;
  timeZone?: string;
};

export function parseMessageTimestamp(timestamp: MessageTimestampValue): Date | null {
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return null;
  }

  const date = timestamp instanceof Date ? new Date(timestamp.getTime()) : new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMessageClockTime(
  timestamp: MessageTimestampValue,
  options: MessageTimestampFormatOptions = {},
): string | null {
  const date = parseMessageTimestamp(timestamp);
  if (!date) return null;

  return new Intl.DateTimeFormat(options.locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone,
  }).format(date);
}

export function formatMessageFullDateTime(
  timestamp: MessageTimestampValue,
  options: MessageTimestampFormatOptions = {},
): string | null {
  const date = parseMessageTimestamp(timestamp);
  if (!date) return null;

  return new Intl.DateTimeFormat(options.locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: options.timeZone,
  }).format(date);
}
