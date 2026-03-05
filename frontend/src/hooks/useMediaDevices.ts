import { useEffect, useRef, useState, useCallback } from "react";

const PREFS_KEY = "p2p-device-prefs";

function loadPrefs(): { audioEnabled: boolean; videoEnabled: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { audioEnabled: true, videoEnabled: true };
}

function savePrefs(audioEnabled: boolean, videoEnabled: boolean) {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ audioEnabled, videoEnabled }));
}

export function useMediaDevices() {
  const prefs = loadPrefs();
  const [audioEnabled, setAudioEnabled] = useState(prefs.audioEnabled);
  const [videoEnabled, setVideoEnabled] = useState(prefs.videoEnabled);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        audio: true,
        video: { width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 60 } },
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        s.getAudioTracks().forEach((t) => (t.enabled = audioEnabled));
        s.getVideoTracks().forEach((t) => (t.enabled = videoEnabled));
        setStream(s);
      })
      .catch((err) => console.error("getUserMedia failed:", err));

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
      savePrefs(next, videoEnabled);
      return next;
    });
  }, [videoEnabled]);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
      savePrefs(audioEnabled, next);
      return next;
    });
  }, [audioEnabled]);

  const stopAll = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  return { stream, audioEnabled, videoEnabled, toggleAudio, toggleVideo, stopAll };
}
