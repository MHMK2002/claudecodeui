import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/utils';

interface DialogContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.MutableRefObject<HTMLElement | null>;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog() {
  const ctx = React.useContext(DialogContext);
  if (!ctx) throw new Error('Dialog components must be used within <Dialog>');
  return ctx;
}

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Dialog: React.FC<DialogProps> = ({ open: controlledOpen, onOpenChange: controlledOnOpenChange, defaultOpen = false, children }) => {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const triggerRef = React.useRef<HTMLElement | null>(null) as React.MutableRefObject<HTMLElement | null>;
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const onOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      controlledOnOpenChange?.(next);
    },
    [isControlled, controlledOnOpenChange]
  );

  const value = React.useMemo(() => ({ open, onOpenChange, triggerRef }), [open, onOpenChange]);

  return <DialogContext.Provider value={value}>{children}</DialogContext.Provider>;
};

const DialogTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }>(
  ({ onClick, children, asChild, ...props }, ref) => {
    const { onOpenChange, triggerRef } = useDialog();

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        onOpenChange(true);
        onClick?.(e);
      },
      [onOpenChange, onClick]
    );

    // asChild: clone child element and compose onClick + capture ref
    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<any>;
      return React.cloneElement(child, {
        onClick: (e: React.MouseEvent<HTMLElement>) => {
          onOpenChange(true);
          child.props.onClick?.(e);
        },
        ref: (node: HTMLElement | null) => {
          triggerRef.current = node;
          // Forward the outer ref
          if (typeof ref === 'function') ref(node as any);
          else if (ref) (ref as React.MutableRefObject<any>).current = node;
        },
      });
    }

    return (
      <button
        ref={(node) => {
          triggerRef.current = node;
          if (typeof ref === 'function') ref(node);
          else if (ref) ref.current = node;
        }}
        type="button"
        onClick={handleClick}
        {...props}
      >
        {children}
      </button>
    );
  }
);
DialogTrigger.displayName = 'DialogTrigger';

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  onEscapeKeyDown?: () => void;
  onPointerDownOutside?: () => void;
  wrapperClassName?: string;
  animationClassName?: string;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openDialogStack: symbol[] = [];

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onEscapeKeyDown, onPointerDownOutside, wrapperClassName, animationClassName, ...props }, ref) => {
    const { open, onOpenChange, triggerRef } = useDialog();
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const previousFocusRef = React.useRef<HTMLElement | null>(null);
    const dialogIdRef = React.useRef(Symbol('dialog'));

    // Restore focus even when a controlled parent unmounts the dialog immediately.
    React.useEffect(() => {
      if (!open) return undefined;
      previousFocusRef.current = document.activeElement as HTMLElement;
      const dialogId = dialogIdRef.current;
      openDialogStack.push(dialogId);
      return () => {
        const stackIndex = openDialogStack.lastIndexOf(dialogId);
        if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
        const restoreTarget = triggerRef.current ?? previousFocusRef.current;
        previousFocusRef.current = null;
        queueMicrotask(() => restoreTarget?.focus());
      };
    }, [open, triggerRef]);

    React.useEffect(() => {
      if (!open) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (openDialogStack.at(-1) !== dialogIdRef.current) return;
        if (e.key === 'Escape') {
          e.stopPropagation();
          onEscapeKeyDown?.();
          onOpenChange(false);
          return;
        }

        // Focus trap: Tab / Shift+Tab cycle within the dialog
        if (e.key === 'Tab' && contentRef.current) {
          const focusable = Array.from(
            contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
          );
          if (focusable.length === 0) return;

          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };

      document.addEventListener('keydown', handleKeyDown, true);

      // Prevent body scroll
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';

      return () => {
        document.removeEventListener('keydown', handleKeyDown, true);
        document.body.style.overflow = prev;
      };
    }, [open, onOpenChange, onEscapeKeyDown]);

    // Auto-focus first focusable element on open
    React.useEffect(() => {
      if (open && contentRef.current) {
        // Small delay to let the portal render
        requestAnimationFrame(() => {
          const first = contentRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
          first?.focus();
        });
      }
    }, [open]);

    // Keep assistive technology and pointer/focus navigation inside the top-level
    // modal. Nested dialogs temporarily inert the parent dialog and restore it.
    React.useEffect(() => {
      if (!open || !contentRef.current) return undefined;
      const wrapper = contentRef.current.parentElement;
      if (!wrapper) return undefined;
      const siblings = Array.from(document.body.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== wrapper)
        .map((element) => ({
          element,
          inert: element.inert,
          ariaHidden: element.getAttribute('aria-hidden'),
        }));
      for (const { element } of siblings) {
        element.inert = true;
        element.setAttribute('aria-hidden', 'true');
      }
      return () => {
        for (const { element, inert, ariaHidden } of siblings) {
          element.inert = inert;
          if (ariaHidden === null) element.removeAttribute('aria-hidden');
          else element.setAttribute('aria-hidden', ariaHidden);
        }
      };
    }, [open]);

    if (!open) return null;

    return createPortal(
      <div className={cn('fixed inset-0 z-50', wrapperClassName)}>
        {/* Overlay */}
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close dialog"
          className="fixed inset-0 animate-dialog-overlay-show bg-black/50 backdrop-blur-sm"
          onClick={() => {
            onPointerDownOutside?.();
            onOpenChange(false);
          }}
        />
        {/* Content */}
        <div
          ref={(node) => {
            contentRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          role="dialog"
          aria-modal="true"
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
            'rounded-xl border bg-popover text-popover-foreground shadow-lg',
            animationClassName ?? 'animate-dialog-content-show',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </div>,
      document.body
    );
  }
);
DialogContent.displayName = 'DialogContent';

const DialogTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('sr-only', className)} {...props} />
  )
);
DialogTitle.displayName = 'DialogTitle';

export { Dialog, DialogTrigger, DialogContent, DialogTitle, useDialog };
