import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

import type { QuickSettingsHandleStyle } from '../types';

type QuickSettingsHandleProps = {
  isOpen: boolean;
  isDragging: boolean;
  drawerWidth: number;
  style: QuickSettingsHandleStyle;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => void;
};

export default function QuickSettingsHandle({
  isOpen,
  isDragging,
  drawerWidth,
  style,
  onClick,
  onMouseDown,
  onTouchStart,
}: QuickSettingsHandleProps) {
  const borderClass = isDragging
    ? 'border-blue-500 dark:border-blue-400'
    : 'border-gray-200 dark:border-gray-700';
  const transitionClass = isDragging
    ? ''
    : 'transition-all duration-150 ease-out';
  const cursorClass = isDragging ? 'cursor-grabbing' : 'cursor-pointer';
  const ariaLabel = isDragging
    ? 'Moving project drawer'
    : isOpen
      ? 'Close project drawer'
      : 'Open project drawer';
  const title = isDragging
    ? 'Moving project drawer'
    : 'Open, close, or drag the project drawer';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`fixed right-0 z-50 ${transitionClass} min-h-11 min-w-11 border bg-white dark:bg-gray-800 ${borderClass} rounded-l-md p-2 shadow-lg transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-gray-700 ${cursorClass} touch-none`}
      style={{
        ...style,
        right: isOpen ? `${drawerWidth}px` : 0,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        WebkitUserSelect: 'none',
      }}
      aria-label={ariaLabel}
      title={title}
    >
      {isDragging ? (
        <GripVertical className="h-5 w-5 text-blue-500 dark:text-blue-400" />
      ) : isOpen ? (
        <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      ) : (
        <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
      )}
    </button>
  );
}
