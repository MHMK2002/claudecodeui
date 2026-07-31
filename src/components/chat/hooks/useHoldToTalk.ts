import { useEffect, useRef } from 'react';

type StopFn = (opts?: { send?: boolean }) => void;

/**
 * Hold-to-talk keyboard shortcut. When `enabled`, holding Option+Space
 * (Alt+Space) anywhere in the app window starts recording; releasing it stops
 * and fills the input (no auto-send). Pure side-effect hook.
 *
 * Bypassed entirely when `enabled` is false, so the shortcut never fires unless
 * the user opts in via settings.
 *
 * Implementation note: `onStart`/`onStop` are read through refs and the window
 * listeners are bound once per `enabled` toggle. This matters because starting
 * recording triggers a state change (idle → recording) which re-renders the
 * owner — if the effect re-ran mid-hold, the `active` flag would reset and the
 * keyup that stops the recording would be lost. Keeping the binding stable for
 * the whole hold ensures release always fires.
 */
export function useHoldToTalk(enabled: boolean, onStart: () => void, onStop: StopFn) {
  const startRef = useRef(onStart);
  const stopRef = useRef(onStop);
  startRef.current = onStart;
  stopRef.current = onStop;

  useEffect(() => {
    if (!enabled) return;

    // Local to this effect closure — survives owner re-renders so a stray
    // keyup from a different press can't stop a recording that isn't ours,
    // and our own recording can't be orphaned by a re-render.
    let active = false;

    const isHoldToTalk = (e: KeyboardEvent) =>
      e.code === 'Space' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHoldToTalk(e) || e.repeat || active) return;
      e.preventDefault();
      active = true;
      startRef.current();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!active || e.code !== 'Space') return;
      // Stop on Space release regardless of other modifiers, so letting go of
      // Option a hair early still ends the recording.
      e.preventDefault();
      active = false;
      stopRef.current({ send: false });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled]);
}
