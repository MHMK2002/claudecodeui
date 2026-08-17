import type { ComponentPropsWithoutRef } from 'react';

import { cn } from '../../../../lib/utils';
import {
  formatMessageClockTime,
  formatMessageFullDateTime,
  parseMessageTimestamp,
} from '../../utils/messageTimestamp';
import type {
  MessageTimestampFormatOptions,
  MessageTimestampValue,
} from '../../utils/messageTimestamp';

type MessageTimestampProps = Omit<ComponentPropsWithoutRef<'time'>, 'children' | 'dateTime'> & {
  timestamp: MessageTimestampValue;
  formatOptions?: MessageTimestampFormatOptions;
};

export default function MessageTimestamp({
  timestamp,
  formatOptions,
  className,
  ...props
}: MessageTimestampProps) {
  const date = parseMessageTimestamp(timestamp);
  if (!date) return null;

  const clockTime = formatMessageClockTime(date, formatOptions);
  const fullDateTime = formatMessageFullDateTime(date, formatOptions);
  if (!clockTime || !fullDateTime) return null;

  return (
    <time
      {...props}
      dateTime={date.toISOString()}
      dir="ltr"
      title={props.title ?? fullDateTime}
      aria-label={props['aria-label'] ?? fullDateTime}
      className={cn('shrink-0 tabular-nums', className)}
    >
      {clockTime}
    </time>
  );
}
