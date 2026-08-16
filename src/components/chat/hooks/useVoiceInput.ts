import { useCallback, useEffect, useRef, useState } from 'react';

import {
  finalizeVoiceTranscript,
  type VoiceTranscriptDelivery,
} from '../../../lib/finalizeVoiceTranscript';
import {
  getVoiceStreamWebSocketUrl,
  transcribeVoice,
} from '../../../lib/voiceApi';
import { readVoiceConfig } from '../../../hooks/useVoiceConfig';
import { useAuth } from '../../auth/context/AuthContext';
import {
  AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT,
  renewDesktopLocalSession,
} from '../../../utils/api';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SonioxToken = { text?: string; is_final?: boolean };
type SonioxRelayMessage = { error?: string; ready?: boolean; finished?: boolean; tokens?: SonioxToken[] };
type RecordingControl = {
  recorder: MediaRecorder;
  send: boolean;
  origin?: unknown;
  discard: boolean;
};

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}

// Best-effort peak-amplitude check on a finished recording. A mis-selected or
// muted mic — very common with Bluetooth "hands-free" headsets whose HFP mic
// profile fails to engage on macOS — produces a structurally valid but silent
// clip, which the STT backend returns empty for, surfacing as a confusing "No
// speech detected". Decoding here tells the two apart. Returns false (i.e. "not
// known to be silent") whenever decoding isn't possible, so a real recording is
// never blocked by a failed check.
async function isRecordingSilent(blob: Blob): Promise<boolean> {
  try {
    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!Ctor) return false;
    const ctx = new Ctor();
    try {
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      let peak = 0;
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const samples = decoded.getChannelData(ch);
        // Step-sample for speed; silence detection doesn't need every frame.
        for (let i = 0; i < samples.length; i += 64) {
          const v = Math.abs(samples[i]);
          if (v > peak) peak = v;
        }
      }
      // ~-40 dBFS. Real speech peaks well above this; a dead mic sits near zero.
      return peak < 0.01;
    } finally {
      void ctx.close();
    }
  } catch {
    return false;
  }
}

export type VoiceInputState = 'idle' | 'recording' | 'transcribing';

/**
 * Push-to-talk dictation. Records the mic, uploads to /api/voice/transcribe
 * (an OpenAI-compatible speech-to-text backend via the Express proxy), and
 * returns the transcript through onTranscript.
 *
 * `onInterim` receives the partial transcript as it arrives, so the composer can
 * show words appearing while the user is still speaking. Only the Soniox
 * streaming provider produces partials; the batch backend has nothing to report
 * until the upload completes. It is called with `null` when a recording ends
 * without delivering a transcript (cancelled, discarded, or failed) so the
 * consumer can drop the preview it was rendering.
 */
export function useVoiceInput(
  onTranscript: (
    text: string,
    send?: boolean,
    origin?: unknown,
    delivery?: VoiceTranscriptDelivery,
  ) => void | Promise<void>,
  onError?: (msg: string) => void,
  onInterim?: (text: string | null) => void,
) {
  const { runtimeMode } = useAuth();
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Invalidates an outstanding getUserMedia request when the viewed session is
  // detached. A late permission/device result must not start recording there.
  const startAttemptRef = useRef(0);
  // Mutable commit intent for the active recorder only. Every start() captures its
  // own object, so an older onstop cannot consume a newer recording's send/origin.
  const recordingControlRef = useRef<RecordingControl | null>(null);
  // Monotonic id per recording. A recording that is superseded (the user started a
  // new one while this one was still transcribing) must not drive the shared UI
  // state — only the newest recording owns `state`. Delivery still fires regardless.
  const genRef = useRef(0);
  // Soniox streaming only: the relay WebSocket for the current/most recent
  // recording, held purely so the unmount cleanup effect can close it.
  const sonioxSocketRef = useRef<WebSocket | null>(null);
  // A committed recording owns its controller until STT + cleanup + delivery
  // completes. Starting another recording leaves older controllers alone; only a
  // real component teardown aborts all outstanding work.
  const pipelineControllersRef = useRef(new Set<AbortController>());
  // Read through a ref: partials fire many times per recording, from socket
  // handlers closed over inside start(), and must not force start() to change
  // identity on every consumer re-render.
  const onInterimRef = useRef(onInterim);
  onInterimRef.current = onInterim;

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    const pipelineControllers = pipelineControllersRef.current;
    return () => {
      cancelledRef.current = true;
      startAttemptRef.current += 1;
      startingRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
      try {
        sonioxSocketRef.current?.close();
      } catch {
        /* already closed */
      }
      sonioxSocketRef.current = null;
      for (const controller of pipelineControllers) controller.abort();
      pipelineControllers.clear();
    };
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
    const startAttempt = ++startAttemptRef.current;
    try {
      // Record from the user's chosen input device (Voice settings), read fresh each
      // time so a settings change applies to the next recording with no prop
      // threading. Empty id = system default.
      const micDeviceId = readVoiceConfig().micDeviceId;
      // autoGainControl helps quiet/headset mics reach a usable level.
      const audio: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (micDeviceId) audio.deviceId = { exact: micDeviceId };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio });
      } catch (constraintErr) {
        // Chosen device is gone/unusable → retry with the system default rather than
        // failing the whole recording.
        if (micDeviceId && (constraintErr as DOMException)?.name === 'OverconstrainedError') {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
        } else {
          throw constraintErr;
        }
      }
      if (cancelledRef.current || startAttemptRef.current !== startAttempt) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      const chunks: Blob[] = [];
      const control: RecordingControl = {
        recorder: rec,
        send: false,
        origin: undefined,
        discard: false,
      };
      recordingControlRef.current = control;
      const stopRecordingTracks = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (streamRef.current === stream) streamRef.current = null;
      };
      // Claim ownership of the shared UI state for this recording. Any older
      // recording still resolving in the background compares against this and
      // bows out of setState so it can't reset a newer recording's state.
      const gen = ++genRef.current;
      const isCurrent = () => genRef.current === gen;
      const clearCurrentInterim = () => {
        if (isCurrent()) onInterimRef.current?.(null);
      };

      const isSoniox = readVoiceConfig().sttProvider === 'soniox';
      if (isSoniox && runtimeMode === 'desktop-local') {
        const renewed = await renewDesktopLocalSession();
        if (renewed === false) {
          stopRecordingTracks();
          window.dispatchEvent(new Event(AUTH_LOCAL_SESSION_UNAVAILABLE_EVENT));
          throw new Error('Local voice session could not be restored.');
        }
      }

      // Soniox streams over a WebSocket relay (server/modules/websocket/services/
      // voice-stream-proxy.service.ts) instead of an upload-then-poll REST call, so
      // audio goes out as it's recorded and the transcript is mostly ready by the
      // time the user releases the mic. Everything else (the size/silence guards,
      // cleanup step, and onTranscript/origin delivery) stays identical to the
      // non-streaming path below.
      let sonioxSocket: WebSocket | null = null;
      let sonioxReady = false;
      let sonioxReadyResolve: (() => void) | null = null;
      const sonioxReadyPromise = new Promise<void>((resolve) => {
        sonioxReadyResolve = resolve;
      });
      let sonioxQueue: ArrayBuffer[] = [];
      let sonioxFinalText = '';
      let sonioxError: string | null = null;
      let sonioxFinishedResolve: (() => void) | null = null;
      // Chunk -> ArrayBuffer conversion is async (Blob.arrayBuffer()); chaining
      // through this keeps chunks reaching Soniox in the order they were recorded
      // even if conversions were to resolve out of order.
      let sonioxSendChain: Promise<void> = Promise.resolve();

      if (isSoniox) {
        const wsUrl = getVoiceStreamWebSocketUrl();
        if (!wsUrl) {
          sonioxError = 'Not signed in.';
        } else {
          const socket = new WebSocket(wsUrl);
          socket.binaryType = 'arraybuffer';
          sonioxSocket = socket;
          sonioxSocketRef.current = socket;

          const forceStopOnFailure = () => {
            if (recorderRef.current === rec && rec.state !== 'inactive') rec.stop();
          };

          socket.onopen = () => {
            const voiceConfig = readVoiceConfig();
            socket.send(
              JSON.stringify({
                apiKey: voiceConfig.sonioxApiKey,
                languageHints: voiceConfig.sttLanguages,
                terms: voiceConfig.sttTerms,
              }),
            );
          };
          socket.onmessage = (ev) => {
            if (typeof ev.data !== 'string') return;
            let msg: SonioxRelayMessage;
            try {
              msg = JSON.parse(ev.data);
            } catch {
              return;
            }
            if (msg.error) {
              sonioxError = msg.error;
              return;
            }
            if (msg.ready) {
              sonioxReady = true;
              sonioxReadyResolve?.();
              for (const chunk of sonioxQueue) socket.send(chunk);
              sonioxQueue = [];
              return;
            }
            if (Array.isArray(msg.tokens)) {
              // Soniox resends the whole not-yet-final tail on every frame, so the
              // interim buffer is rebuilt per message while finals accumulate.
              let interim = '';
              for (const tok of msg.tokens) {
                if (typeof tok?.text !== 'string') continue;
                if (tok.is_final) sonioxFinalText += tok.text;
                else interim += tok.text;
              }
              // Live preview only belongs to the recording that currently owns the
              // UI; a superseded one still finishes, but silently.
              if (isCurrent() && !control.discard) {
                onInterimRef.current?.((sonioxFinalText + interim).trim());
              }
            }
            if (msg.finished) sonioxFinishedResolve?.();
          };
          socket.onerror = () => {
            if (!sonioxError) sonioxError = 'Voice stream connection failed';
            forceStopOnFailure();
          };
          socket.onclose = () => {
            if (!sonioxReady && !control.discard) {
              if (!sonioxError) sonioxError = 'Voice stream connection failed';
              forceStopOnFailure();
            }
          };
        }
      }

      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        // Kept for both providers: Soniox streaming still needs the full blob for
        // the size/silence guards below (mirroring the batch path exactly), on top
        // of forwarding chunks live over the relay socket.
        chunks.push(e.data);
        if (isSoniox && sonioxSocket) {
          const blob = e.data;
          const socket = sonioxSocket;
          sonioxSendChain = sonioxSendChain
            .then(() => blob.arrayBuffer())
            .then((buf) => {
              if (socket.readyState !== WebSocket.OPEN) return;
              if (sonioxReady) socket.send(buf);
              else sonioxQueue.push(buf);
            })
            .catch(() => {
              /* a dropped chunk shouldn't abort the whole recording */
            });
        }
      };

      rec.onstop = async () => {
        stopRecordingTracks();
        if (recorderRef.current === rec) recorderRef.current = null;
        if (recordingControlRef.current === control) recordingControlRef.current = null;
        if (cancelledRef.current) {
          try {
            sonioxSocket?.close();
          } catch {
            /* already closed */
          }
          return;
        }
        // Capture and clear the send intent + commit target for this stop before any
        // async work, so a later recording can't change where this transcript lands.
        const shouldSend = control.send;
        const origin = control.origin;
        const discarded = control.discard;
        // Dropped by detach() on a session switch: the mic is already released above
        // and the shared UI state has been relinquished, so bail before any async
        // work — no transcription, no delivery.
        if (discarded) {
          try {
            sonioxSocket?.close();
          } catch {
            /* already closed */
          }
          return;
        }
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size < 800) {
          if (isCurrent()) setState('idle');
          clearCurrentInterim();
          onError?.('Recording too short');
          try {
            sonioxSocket?.close();
          } catch {
            /* already closed */
          }
          return;
        }
        // The mic recorded but captured no sound (wrong/muted device — common with
        // Bluetooth headsets). Surface that plainly instead of a wasted STT call that
        // comes back as the ambiguous "No speech detected".
        if (await isRecordingSilent(blob)) {
          if (cancelledRef.current) return;
          if (isCurrent()) setState('idle');
          clearCurrentInterim();
          onError?.('No sound from the microphone — check the selected device isn’t muted.');
          try {
            sonioxSocket?.close();
          } catch {
            /* already closed */
          }
          return;
        }

        const pipelineController = new AbortController();
        pipelineControllersRef.current.add(pipelineController);
        const deliverFinalTranscript = (rawText: string) =>
          finalizeVoiceTranscript({
            rawText,
            send: shouldSend,
            origin,
            signal: pipelineController.signal,
            ownsUi: isCurrent,
            onTranscript,
          });

        if (isSoniox) {
          if (isCurrent()) setState('transcribing');
          try {
            if (!sonioxSocket) throw new Error(sonioxError || 'Voice stream connection failed');
            if (!sonioxReady) await Promise.race([sonioxReadyPromise, sleep(2000)]);
            if (sonioxSocket.readyState !== WebSocket.OPEN) {
              throw new Error(sonioxError || 'Voice stream connection failed');
            }
            const finishedPromise = new Promise<void>((resolve) => {
              sonioxFinishedResolve = resolve;
            });
            await sonioxSendChain;
            sonioxSocket.send('');
            await Promise.race([finishedPromise, sleep(6000)]);
            if (cancelledRef.current) return;
            const result = await deliverFinalTranscript(sonioxFinalText);
            if (result === 'cancelled') return;
            if (result === 'empty') {
              clearCurrentInterim();
              onError?.(sonioxError || 'No speech detected');
            }
          } catch (e) {
            clearCurrentInterim();
            if (!cancelledRef.current) {
              onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          } finally {
            try {
              sonioxSocket?.close();
            } catch {
              /* already closed */
            }
            pipelineControllersRef.current.delete(pipelineController);
            if (!cancelledRef.current && isCurrent()) setState('idle');
          }
          return;
        }

        if (isCurrent()) setState('transcribing');
        try {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const res = await transcribeVoice(blob, `recording.${ext}`, pipelineController.signal);
          if (!res.ok) throw new Error(`transcribe ${res.status}`);
          const data = await res.json();
          if (cancelledRef.current) return;
          const result = await deliverFinalTranscript(
            typeof data?.text === 'string' ? data.text : '',
          );
          if (result === 'empty') onError?.('No speech detected');
        } catch (e) {
          if (!cancelledRef.current) {
            onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } finally {
          pipelineControllersRef.current.delete(pipelineController);
          if (!cancelledRef.current && isCurrent()) setState('idle');
        }
      };

      rec.start(isSoniox ? 250 : undefined);
      setState('recording');
    } catch (e) {
      if (startAttemptRef.current !== startAttempt) return;
      recorderRef.current = null;
      stopTracks();
      if (cancelledRef.current) return;
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      onError?.(msg);
      setState('idle');
    } finally {
      if (startAttemptRef.current === startAttempt) startingRef.current = false;
    }
  }, [onTranscript, onError, runtimeMode]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready,
  // and { origin } to bind the eventual transcript to the session it was committed in
  // (so switching sessions before it resolves can't redirect it).
  // Guard on the recorder's own state (not React state) so a double tap, or the mic
  // and Send buttons both firing, can't call stop() on an already-inactive recorder.
  const stop = useCallback((opts?: { send?: boolean; origin?: unknown }) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      const control = recordingControlRef.current;
      if (control?.recorder === rec) {
        control.send = opts?.send ?? false;
        control.origin = opts?.origin;
      }
      rec.stop();
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === 'recording') stop();
    else if (state === 'idle') start();
  }, [state, start, stop]);

  // Relinquish the shared UI state without cancelling delivery. Called when the
  // viewed session changes so the recording no longer follows the user to the new
  // session: an in-flight transcription keeps resolving and is still delivered to
  // its captured origin, while a live recording (not yet committed) is dropped.
  // Either way the newest generation resets to 'idle' so the now-viewed session can
  // start its own recording immediately (concurrently with the backgrounded one).
  const detach = useCallback(() => {
    startAttemptRef.current += 1;
    startingRef.current = false;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      const control = recordingControlRef.current;
      if (control?.recorder === rec) {
        control.discard = true;
        control.send = false;
        control.origin = undefined;
      }
      rec.stop();
    }
    // Bump the generation so any in-flight recording/transcription stops owning
    // `state` (its isCurrent() turns false), then reset the visible state.
    genRef.current++;
    setState('idle');
    // The composer is shared across sessions, so a live preview left in the box
    // would follow the user into the session they just switched to.
    onInterimRef.current?.(null);
  }, []);

  return { state, toggle, stop, start, detach };
}
