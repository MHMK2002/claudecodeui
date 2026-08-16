import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, type LucideIcon } from 'lucide-react';

import { cn } from '../../../lib/utils';

import { Button } from './Button';

type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

export type ActionMenuItem = {
  key: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  isDanger?: boolean;
  showDividerBefore?: boolean;
  closeOnSelect?: boolean;
};

type ActionMenuProps = {
  label: string;
  items: ActionMenuItem[];
  icon?: LucideIcon;
  ariaLabel?: string;
  align?: 'left' | 'right';
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  disabled?: boolean;
  iconOnly?: boolean;
  portal?: boolean;
  header?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
};

type ActionMenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/** Pure focus resolver used by ActionMenu keyboard handling and its regression tests. */
export function getActionMenuFocusIndex(
  enabledItems: boolean[],
  currentIndex: number,
  key: ActionMenuNavigationKey,
): number {
  const enabledIndexes = enabledItems
    .map((enabled, index) => enabled ? index : -1)
    .filter((index) => index >= 0);
  if (enabledIndexes.length === 0) return -1;
  if (key === 'Home') return enabledIndexes[0];
  if (key === 'End') return enabledIndexes[enabledIndexes.length - 1];

  const currentPosition = enabledIndexes.indexOf(currentIndex);
  if (key === 'ArrowDown') {
    return enabledIndexes[(currentPosition + 1 + enabledIndexes.length) % enabledIndexes.length];
  }
  const previousPosition = currentPosition < 0 ? enabledIndexes.length - 1 : currentPosition - 1;
  return enabledIndexes[(previousPosition + enabledIndexes.length) % enabledIndexes.length];
}

/** Tab exits a menu through normal browser focus order, so focus must not be restored. */
export function shouldActionMenuCloseWithoutFocusReturn(key: string): boolean {
  return key === 'Tab';
}

export default function ActionMenu({
  label,
  items,
  icon: TriggerIcon,
  ariaLabel,
  align = 'right',
  variant = 'outline',
  size = 'sm',
  className,
  triggerClassName,
  menuClassName,
  disabled,
  iconOnly = false,
  portal = false,
  header,
  onOpenChange,
}: ActionMenuProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [portalPosition, setPortalPosition] = React.useState<{ top: number; left: number } | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  // Whether closing should move focus back to the trigger. Set for keyboard
  // (Escape) and item selection, but left false for outside pointer clicks so
  // focus is not stolen from wherever the user clicked.
  const restoreFocusRef = React.useRef(false);
  const focusMenuOnOpenRef = React.useRef(false);
  const initialFocusRef = React.useRef<'first' | 'last'>('first');
  const wasOpenRef = React.useRef(false);
  const menuId = React.useId();

  const setMenuOpen = React.useCallback((open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setPortalPosition(null);
    }
    onOpenChange?.(open);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        rootRef.current
        && !rootRef.current.contains(target)
        && !menuRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        restoreFocusRef.current = true;
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen, setMenuOpen]);

  React.useEffect(() => {
    if (!isOpen || !portal) {
      return;
    }

    const closeOnViewportChange = () => setMenuOpen(false);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [isOpen, portal, setMenuOpen]);

  // Move focus into the menu on open and back to the trigger on a keyboard or
  // selection close, so keyboard and screen-reader navigation match the menu role.
  React.useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      if (focusMenuOnOpenRef.current) {
        const menu = menuRef.current;
        const items = menu
          ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
          : [];
        const initialItem = initialFocusRef.current === 'last'
          ? items[items.length - 1]
          : items[0];
        (initialItem ?? menu)?.focus();
      }
      return;
    }

    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      if (restoreFocusRef.current) {
        triggerRef.current?.focus();
      }
      restoreFocusRef.current = false;
    }
  }, [isOpen]);

  const runItem = (item: ActionMenuItem) => {
    if (item.disabled || item.loading) {
      return;
    }

    if (item.closeOnSelect !== false) {
      restoreFocusRef.current = true;
      setMenuOpen(false);
    }
    item.onSelect();
  };

  const toggleMenu = () => {
    if (isOpen) {
      setMenuOpen(false);
      return;
    }

    if (portal && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const menuWidth = 260;
      const estimatedHeight = (header ? 52 : 0)
        + items.reduce((height, item) => height + (item.description ? 58 : 40) + (item.showDividerBefore ? 9 : 0), 12);
      setPortalPosition({
        top: rect.bottom + 6 + estimatedHeight <= window.innerHeight - 8
          ? rect.bottom + 6
          : Math.max(8, rect.top - estimatedHeight - 6),
        left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
      });
    }
    setMenuOpen(true);
  };

  const menu = isOpen && (!portal || portalPosition) && (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={ariaLabel || label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (shouldActionMenuCloseWithoutFocusReturn(event.key)) {
          event.preventDefault();
          const focusable = Array.from(document.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          )).filter((element) => !menuRef.current?.contains(element));
          const triggerIndex = focusable.findIndex((element) => element === triggerRef.current);
          const offset = event.shiftKey ? -1 : 1;
          const destination = focusable[triggerIndex + offset];
          restoreFocusRef.current = false;
          setMenuOpen(false);
          queueMicrotask(() => destination?.focus());
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        );
        const currentIndex = items.findIndex((item) => item === document.activeElement);
        const nextIndex = getActionMenuFocusIndex(
          items.map((item) => !item.disabled),
          currentIndex,
          event.key as ActionMenuNavigationKey,
        );
        items[nextIndex]?.focus();
      }}
      className={cn(
        portal ? 'fixed z-[70]' : 'absolute top-full z-50 mt-2',
        'min-w-[220px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg',
        'animate-in fade-in-0 zoom-in-95',
        !portal && (align === 'right' ? 'right-0' : 'left-0'),
        menuClassName,
      )}
      style={portal && portalPosition ? portalPosition : undefined}
    >
      {header}
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <React.Fragment key={item.key}>
            {item.showDividerBefore && <div role="separator" className="mx-2 my-1 h-px bg-border" />}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled || item.loading}
              onClick={() => runItem(item)}
              className={cn(
                'flex min-h-11 w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                'focus:outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                item.disabled || item.loading
                  ? 'cursor-not-allowed opacity-50'
                  : item.isDanger
                    ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                    : 'hover:bg-accent',
              )}
            >
              {item.loading ? (
                <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
              ) : (
                Icon && <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-5">{item.label}</span>
                {item.description && (
                  <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <Button
        ref={triggerRef}
        type="button"
        variant={variant}
        size={size}
        className={triggerClassName}
        disabled={disabled}
        aria-label={ariaLabel || label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        onClick={(event) => {
          focusMenuOnOpenRef.current = event.detail === 0;
          initialFocusRef.current = 'first';
          toggleMenu();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          focusMenuOnOpenRef.current = true;
          initialFocusRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
          if (!isOpen) {
            toggleMenu();
            return;
          }
          const items = menuRef.current
            ? Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'))
            : [];
          const target = event.key === 'ArrowUp' ? items[items.length - 1] : items[0];
          target?.focus();
        }}
      >
        {TriggerIcon && <TriggerIcon className="h-4 w-4" />}
        {!iconOnly && (
          <>
            <span>{label}</span>
            <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
          </>
        )}
      </Button>

      {portal && typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
}
