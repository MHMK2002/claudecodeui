import { useCallback, useEffect, useRef, useState } from 'react';

import { cleanupVoiceTranscript, getVoiceStreamWebSocketUrl, transcribeVoice } from '../../../lib/voiceApi';
import { readVoiceConfig } from '../../../hooks/useVoiceConfig';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SonioxToken = { text?: string; is_final?: boolean };
type SonioxRelayMessage = { error?: string; ready?: boolean; finished?: boolean; tokens?: SonioxToken[] };

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
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean, origin?: unknown) => void,
  onError?: (msg: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);
  // Opaque token identifying which session (etc.) this stop commits to. Snapshotted
  // in onstop before any async work so a recording started elsewhere while this one
  // is still transcribing can't redirect this transcript.
  const originRef = useRef<unknown>(undefined);
  // Monotonic id per recording. A recording that is superseded (the user started a
  // new one while this one was still transcribing) must not drive the shared UI
  // state — only the newest recording owns `state`. Delivery still fires regardless.
  const genRef = useRef(0);
  // Set by detach() to drop an in-progress recording on a session switch: onstop
  // reads and clears it, then bails before transcribing/delivering.
  const discardRef = useRef(false);
  // Soniox streaming only: the relay WebSocket for the current/most recent
  // recording, held purely so the unmount cleanup effect can close it.
  const sonioxSocketRef = useRef<WebSocket | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
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
    };
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
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
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];
      // Claim ownership of the shared UI state for this recording. Any older
      // recording still resolving in the background compares against this and
      // bows out of setState so it can't reset a newer recording's state.
      const gen = ++genRef.current;
      const isCurrent = () => genRef.current === gen;

      const isSoniox = readVoiceConfig().sttProvider === 'soniox';

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
            socket.send(JSON.stringify({ apiKey: readVoiceConfig().sonioxApiKey }));
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
              for (const tok of msg.tokens) {
                if (tok?.is_final && typeof tok.text === 'string') sonioxFinalText += tok.text;
              }
            }
            if (msg.finished) sonioxFinishedResolve?.();
          };
          socket.onerror = () => {
            if (!sonioxError) sonioxError = 'Voice stream connection failed';
            forceStopOnFailure();
          };
          socket.onclose = () => {
            if (!sonioxReady && !discardRef.current) {
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
        chunksRef.current.push(e.data);
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
        stopTracks();
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
        const shouldSend = sendRef.current;
        const origin = originRef.current;
        const discarded = discardRef.current;
        sendRef.current = false;
        originRef.current = undefined;
        discardRef.current = false;
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
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          if (isCurrent()) setState('idle');
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
          onError?.('No sound from the microphone — check the selected device isn’t muted.');
          try {
            sonioxSocket?.close();
          } catch {
            /* already closed */
          }
          return;
        }

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
            const text = sonioxFinalText.trim();
            if (text) {
              // Same optional LLM polish step as the batch path. State stays
              // 'transcribing' through this so the UI keeps the loading indicator.
              const finalText = await cleanupVoiceTranscript(text);
              if (cancelledRef.current) return;
              onTranscript(finalText, shouldSend, origin);
            } else {
              onError?.(sonioxError || 'No speech detected');
            }
          } catch (e) {
            if (!cancelledRef.current) {
              onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
            }
          } finally {
            try {
              sonioxSocket?.close();
            } catch {
              /* already closed */
            }
            if (!cancelledRef.current && isCurrent()) setState('idle');
          }
          return;
        }

        if (isCurrent()) setState('transcribing');
        try {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const res = await transcribeVoice(blob, `recording.${ext}`);
          if (!res.ok) throw new Error(`transcribe ${res.status}`);
          const data = await res.json();
          if (cancelledRef.current) return;
          const text = String(data?.text || '').trim();
          if (text) {
            // Optional LLM polish step. State stays 'transcribing' through this so
            // the UI keeps the loading indicator. Fails soft to the raw transcript.
            const finalText = await cleanupVoiceTranscript(text);
            if (cancelledRef.current) return;
            // Deliver even if superseded — the transcript belongs to `origin`, not
            // to whatever recording currently owns the UI state.
            onTranscript(finalText, shouldSend, origin);
          } else onError?.('No speech detected');
        } catch (e) {
          if (!cancelledRef.current) {
            onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } finally {
          if (!cancelledRef.current && isCurrent()) setState('idle');
        }
      };

      rec.start(isSoniox ? 250 : undefined);
      setState('recording');
    } catch (e) {
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
      startingRef.current = false;
    }
  }, [onTranscript, onError]);

  // Stop recording. Pass { send: true } to auto-send the transcript once it's ready,
  // and { origin } to bind the eventual transcript to the session it was committed in
  // (so switching sessions before it resolves can't redirect it).
  // Guard on the recorder's own state (not React state) so a double tap, or the mic
  // and Send buttons both firing, can't call stop() on an already-inactive recorder.
  const stop = useCallback((opts?: { send?: boolean; origin?: unknown }) => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      originRef.current = opts?.origin;
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
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      discardRef.current = true;
      sendRef.current = false;
      originRef.current = undefined;
      rec.stop();
    }
    // Bump the generation so any in-flight recording/transcription stops owning
    // `state` (its isCurrent() turns false), then reset the visible state.
    genRef.current++;
    setState('idle');
  }, []);

  return { state, toggle, stop, start, detach };
}
