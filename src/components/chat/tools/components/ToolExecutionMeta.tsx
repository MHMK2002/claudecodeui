import { cn } from '../../../../lib/utils';
import { parseMessageTimestamp } from '../../utils/messageTimestamp';
import type { MessageTimestampValue } from '../../utils/messageTimestamp';
import MessageTimestamp from '../../view/subcomponents/MessageTimestamp';

import { ToolStatusBadge } from './ToolStatusBadge';
import type { ToolStatus } from './ToolStatusBadge';

interface ToolExecutionMetaProps {
  status?: ToolStatus;
  timestamp?: MessageTimestampValue;
  className?: string;
}

export function ToolExecutionMeta({ status, timestamp, className }: ToolExecutionMetaProps) {
  if (!status && !parseMessageTimestamp(timestamp)) {
    return null;
  }

  return (
    <span
      data-tool-execution-meta="true"
      className={cn('inline-flex shrink-0 items-center gap-1.5', className)}
    >
      {status && <ToolStatusBadge status={status} />}
      <MessageTimestamp timestamp={timestamp} className="text-[10px]" />
    </span>
  );
}
