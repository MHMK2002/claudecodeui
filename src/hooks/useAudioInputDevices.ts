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
  status: AudioInputStatus;
  error: string | null;
  /** Throwaway getUserMedia grant so labels populate, then re-enumerate. */
  requestPermission: () => Promise<boolean>;
  /** Re-enumerate on demand. */
  refresh: () => void;
};

export type AudioInputStatus =
  | 'checking'
  | 'ready'
  | 'permission-required'
  | 'permission-denied'
  | 'missing'
  | 'unsupported'
  | 'error';

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
  const [status, setStatus] = useState<AudioInputStatus>(supported ? 'checking' : 'unsupported');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!isSupported()) return;
    setStatus((current) => current === 'permission-denied' ? current : 'checking');
    navigator.mediaDevices
      .enumerateDevices()
      .then((list) => {
        const inputs = list.filter((device) => device.kind === 'audioinput');
        setDevices(inputs);
        setError(null);
        setStatus((current) => {
          if (current === 'permission-denied') return current;
          if (inputs.length === 0) return 'missing';
          return inputs.every((device) => !device.label) ? 'permission-required' : 'ready';
        });
      })
      .catch((cause) => {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Microphones could not be listed.');
      });
  }, []);

  const requestPermission = useCallback(async () => {
    if (!isSupported() || typeof navigator.mediaDevices.getUserMedia !== 'function') return false;
    setStatus('checking');
    setError(null);
    try {
      // We only need the permission grant so enumerateDevices returns labels —
      // release the mic immediately.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      refresh();
      return true;
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setStatus('permission-denied');
        setError('Microphone permission is blocked. Allow access in system or browser settings.');
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setDevices([]);
        setStatus('missing');
        setError('No microphone was found. Connect a microphone and try again.');
      } else {
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Microphone access failed.');
      }
      return false;
    }
  }, [refresh]);

  useEffect(() => {
    if (!supported) return;
    refresh();
    const onChange = () => refresh();
    navigator.mediaDevices.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', onChange);
  }, [supported, refresh]);

  const needsPermission = status === 'permission-required';

  return { devices, needsPermission, supported, status, error, requestPermission, refresh };
}
