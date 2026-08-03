import { useEffect, useRef } from "react";

import { artUrl } from "~/api/client";
import type { Track } from "~/api/schemas";

/** MediaSession metadata, transport actions, and position state. */

export interface MediaSessionOptions {
  readonly track: Track | null;
  readonly status: "idle" | "loading" | "playing" | "paused" | "stalled";
  readonly duration: number;
  readonly hasNext: boolean;
  readonly hasPrevious: boolean;
  readonly getPosition: () => number;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onSeek: (seconds: number) => void;
}

/** Strips the extension from the filename used as the track title. */
export function trackTitle(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function useMediaSession(options: MediaSessionOptions): void {
  const latest = useRef(options);
  latest.current = options;

  const { track, status, duration } = options;
  const trackId = track?.id ?? null;

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session) return;

    if (!trackId || !track) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }

    session.metadata = new MediaMetadata({
      title: trackTitle(track.name),
      artwork: [
        { src: artUrl(track.id, 160), sizes: "160x160" },
        { src: artUrl(track.id, 320), sizes: "320x320" },
        { src: artUrl(track.id, 640), sizes: "640x640" }
      ]
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session) return;
    session.playbackState =
      status === "playing" ? "playing" : status === "idle" ? "none" : "paused";
  }, [status]);

  // The OS extrapolates position between state changes.
  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session?.setPositionState) return;
    if (!trackId || duration <= 0) return;
    try {
      session.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(latest.current.getPosition(), duration)
      });
    } catch {
      // Some browsers reject position updates during transitions.
    }
  }, [trackId, duration, status]);

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session?.setActionHandler) return;

    const set = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Ignore unsupported actions without disabling the rest.
      }
    };

    set("play", () => latest.current.onPlay());
    set("pause", () => latest.current.onPause());
    set("stop", () => latest.current.onPause());
    set("seekto", (details) => {
      if (typeof details.seekTime === "number") {
        latest.current.onSeek(details.seekTime);
      }
    });
    set("seekforward", (details) => {
      latest.current.onSeek(
        latest.current.getPosition() + (details.seekOffset ?? 10)
      );
    });
    set("seekbackward", (details) => {
      latest.current.onSeek(
        latest.current.getPosition() - (details.seekOffset ?? 10)
      );
    });

    return () => {
      for (const action of [
        "play",
        "pause",
        "stop",
        "seekto",
        "seekforward",
        "seekbackward",
        "nexttrack",
        "previoustrack"
      ] as const) {
        set(action, null);
      }
    };
  }, []);

  // A null handler lets the OS disable unavailable skip actions.
  const { hasNext, hasPrevious } = options;
  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session?.setActionHandler) return;
    try {
      session.setActionHandler(
        "nexttrack",
        hasNext ? () => latest.current.onNext() : null
      );
      session.setActionHandler(
        "previoustrack",
        hasPrevious ? () => latest.current.onPrevious() : null
      );
    } catch {
      // The OS omits unsupported skip controls.
    }
  }, [hasNext, hasPrevious]);
}
