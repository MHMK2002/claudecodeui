import { useCallback, useEffect, useState } from 'react';

export type AudioInputDevices = {
  /** Available audio input devices (kind === 'audioinput'). */
  devices: MediaDeviceInfo[];
  /**
   * True when inputs exist but their labels are still hidden — the browser only
   * exposes device labels once microphone permission has been granted. The settings
   * UI shows an "allow access" button in this state.
   */
  needsPermission: boolean;
  /** False in SSR / browsers without the Media Devices API. */
  supported: boolean;
  /** Throwaway getUserMedia grant so labels populate, then re-enumerate. */
  requestPermission: () => Promise<void>;
  /** Re-enumerate on demand. */
  refresh: () => void;
};

const isSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.enumerateDevices === 'function';

/**
 * Enumerates microphones for the voice settings device picker. Keeps the list in
 * sync with hardware changes (devicechange) and offers a permission prompt so real
 * device names can be shown (labels are blank until the user grants mic access).
 */
export function useAudioInputDevices(): AudioInputDevices {
  const [supported] = useState(isSupported);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(() => {
    if (!isSupported()) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audioinput')))
      .catch(() => {
        /* enumeration can reject in restricted contexts — keep the previous list */
      });
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSupported() || typeof navigator.mediaDevices.getUserMedia !== 'function') return;
    try {
      // We only need the permission grant so enumerateDevices returns labels —
      // release the mic immediately.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* denied/failed: labels stay hidden; the picker still works by index */
    } finally {
      refresh();
    }
  }, [refresh]);

  useEffect(() => {
    if (!supported) return;
    refresh();
    const onChange = () => refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
  }, [supported, refresh]);

  const needsPermission = supported && devices.length > 0 && devices.every((d) => !d.label);

  return { devices, needsPermission, supported, requestPermission, refresh };
}
