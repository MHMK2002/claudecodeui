import * as React from 'react';

import { cn } from '../../../lib/utils';
import { getTextDirection } from '../../../utils/textDirection';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  /** Optional explicit override. If omitted, dir is derived from `value` via RTL-char detection. */
  dir?: React.InputHTMLAttributes<HTMLInputElement>['dir'];
};

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, value, dir, ...props }, ref) => {
    const resolvedDir = dir ?? (value != null ? getTextDirection(value) : undefined);
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        dir={resolvedDir}
        ref={ref}
        value={value}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
