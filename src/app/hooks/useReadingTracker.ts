import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_IDLE_THRESHOLD_MS = 2 * 60 * 1000;
const DEFAULT_TICK_INTERVAL_MS = 1000;
const ONE_MINUTE_MS = 60 * 1000;

export interface UseReadingTrackerOptions {
  enabled: boolean;
  documentId: string | number | null | undefined;
  onTrackMinute: (documentId: string) => Promise<void> | void;
  idleThresholdMs?: number;
  tickIntervalMs?: number;
}

export interface UseReadingTrackerResult {
  isIdle: boolean;
  activeSeconds: number;
  activeMinutes: number;
}

export default function useReadingTracker({
  enabled,
  documentId,
  onTrackMinute,
  idleThresholdMs = DEFAULT_IDLE_THRESHOLD_MS,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
}: UseReadingTrackerOptions): UseReadingTrackerResult {
  const normalizedDocumentId = useMemo(() => {
    const raw = documentId == null ? '' : String(documentId);
    return raw.trim();
  }, [documentId]);

  const [isIdle, setIsIdle] = useState(false);
  const [activeSeconds, setActiveSeconds] = useState(0);

  const onTrackMinuteRef = useRef(onTrackMinute);
  const lastInteractionRef = useRef(Date.now());
  const isIdleRef = useRef(false);
  const totalActiveMsRef = useRef(0);
  const minuteBufferMsRef = useRef(0);
  const pendingMinutesRef = useRef(0);
  const isSyncingRef = useRef(false);

  useEffect(() => {
    onTrackMinuteRef.current = onTrackMinute;
  }, [onTrackMinute]);

  useEffect(() => {
    lastInteractionRef.current = Date.now();
    isIdleRef.current = false;
    totalActiveMsRef.current = 0;
    minuteBufferMsRef.current = 0;
    pendingMinutesRef.current = 0;
    isSyncingRef.current = false;
    setIsIdle(false);
    setActiveSeconds(0);
  }, [normalizedDocumentId]);

  const flushPendingMinutes = useCallback(async (targetDocumentId: string) => {
    if (!targetDocumentId || isSyncingRef.current) {
      return;
    }

    isSyncingRef.current = true;

    try {
      while (pendingMinutesRef.current > 0) {
        try {
          await onTrackMinuteRef.current(targetDocumentId);
        } catch {
          break;
        }

        pendingMinutesRef.current -= 1;
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !normalizedDocumentId) {
      return;
    }

    const handleUserInteraction = () => {
      lastInteractionRef.current = Date.now();

      if (isIdleRef.current) {
        isIdleRef.current = false;
        setIsIdle(false);
      }

      if (pendingMinutesRef.current > 0 && !isSyncingRef.current) {
        void flushPendingMinutes(normalizedDocumentId);
      }
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'scroll', 'click'];
    for (const eventName of events) {
      window.addEventListener(eventName, handleUserInteraction);
    }

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, handleUserInteraction);
      }
    };
  }, [enabled, flushPendingMinutes, normalizedDocumentId]);

  useEffect(() => {
    if (!enabled || !normalizedDocumentId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const currentlyIdle = now - lastInteractionRef.current >= idleThresholdMs;

      if (currentlyIdle !== isIdleRef.current) {
        isIdleRef.current = currentlyIdle;
        setIsIdle(currentlyIdle);
      }

      if (currentlyIdle) {
        return;
      }

      totalActiveMsRef.current += tickIntervalMs;
      minuteBufferMsRef.current += tickIntervalMs;
      setActiveSeconds(Math.floor(totalActiveMsRef.current / 1000));

      if (minuteBufferMsRef.current >= ONE_MINUTE_MS) {
        const earnedMinutes = Math.floor(minuteBufferMsRef.current / ONE_MINUTE_MS);
        minuteBufferMsRef.current -= earnedMinutes * ONE_MINUTE_MS;
        pendingMinutesRef.current += earnedMinutes;
        void flushPendingMinutes(normalizedDocumentId);
      }
    }, tickIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled, flushPendingMinutes, idleThresholdMs, normalizedDocumentId, tickIntervalMs]);

  return {
    isIdle,
    activeSeconds,
    activeMinutes: Math.floor(activeSeconds / 60),
  };
}
