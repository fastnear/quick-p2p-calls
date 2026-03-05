import { useEffect, useRef, useState, useCallback } from "react";

const PREFS_KEY = "p2p-device-prefs";

interface DevicePrefs {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioInputId: string;
  videoInputId: string;
  audioOutputId: string;
}

function loadPrefs(): DevicePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...defaultPrefs, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultPrefs;
}

const defaultPrefs: DevicePrefs = {
  audioEnabled: true,
  videoEnabled: true,
  audioInputId: "",
  videoInputId: "",
  audioOutputId: "",
};

function savePrefs(prefs: Partial<DevicePrefs>) {
  const current = loadPrefs();
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...current, ...prefs }));
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
}

export function useMediaDevices() {
  const prefs = loadPrefs();
  const [audioEnabled, setAudioEnabled] = useState(prefs.audioEnabled);
  const [videoEnabled, setVideoEnabled] = useState(prefs.videoEnabled);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioInputs, setAudioInputs] = useState<DeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<DeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<DeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState(prefs.audioInputId);
  const [selectedVideoInput, setSelectedVideoInput] = useState(prefs.videoInputId);
  const [selectedAudioOutput, setSelectedAudioOutput] = useState(prefs.audioOutputId);
  const onTrackChangedRef = useRef<((stream: MediaStream) => void) | null>(null);

  const enumerateDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioInputs(
      devices.filter((d) => d.kind === "audioinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Mic ${i + 1}` }))
    );
    setVideoInputs(
      devices.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    );
    setAudioOutputs(
      devices.filter((d) => d.kind === "audiooutput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Speaker ${i + 1}` }))
    );
  }, []);

  const acquireStream = useCallback(async (audioId?: string, videoId?: string) => {
    const constraints: MediaStreamConstraints = {
      audio: audioId ? { deviceId: { exact: audioId } } : true,
      video: {
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        frameRate: { ideal: 60 },
        ...(videoId ? { deviceId: { exact: videoId } } : {}),
      },
    };

    const s = await navigator.mediaDevices.getUserMedia(constraints);
    return s;
  }, []);

  const replaceStream = useCallback(
    (newStream: MediaStream) => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = newStream;
      newStream.getAudioTracks().forEach((t) => (t.enabled = audioEnabled));
      newStream.getVideoTracks().forEach((t) => (t.enabled = videoEnabled));
      setStream(newStream);
      onTrackChangedRef.current?.(newStream);
    },
    [audioEnabled, videoEnabled]
  );

  useEffect(() => {
    let cancelled = false;
    acquireStream(prefs.audioInputId || undefined, prefs.videoInputId || undefined)
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = s;
        s.getAudioTracks().forEach((t) => (t.enabled = prefs.audioEnabled));
        s.getVideoTracks().forEach((t) => (t.enabled = prefs.videoEnabled));
        setStream(s);
        await enumerateDevices();
      })
      .catch((err) => console.error("getUserMedia failed:", err));

    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchAudioInput = useCallback(
    async (deviceId: string) => {
      setSelectedAudioInput(deviceId);
      savePrefs({ audioInputId: deviceId });
      try {
        const s = await acquireStream(deviceId, selectedVideoInput || undefined);
        replaceStream(s);
      } catch (err) {
        console.error("Failed to switch audio input:", err);
      }
    },
    [acquireStream, replaceStream, selectedVideoInput]
  );

  const switchVideoInput = useCallback(
    async (deviceId: string) => {
      setSelectedVideoInput(deviceId);
      savePrefs({ videoInputId: deviceId });
      try {
        const s = await acquireStream(selectedAudioInput || undefined, deviceId);
        replaceStream(s);
      } catch (err) {
        console.error("Failed to switch video input:", err);
      }
    },
    [acquireStream, replaceStream, selectedAudioInput]
  );

  const switchAudioOutput = useCallback((deviceId: string) => {
    setSelectedAudioOutput(deviceId);
    savePrefs({ audioOutputId: deviceId });
  }, []);

  const toggleAudio = useCallback(() => {
    setAudioEnabled((prev) => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
      savePrefs({ audioEnabled: next });
      return next;
    });
  }, []);

  const toggleVideo = useCallback(() => {
    setVideoEnabled((prev) => {
      const next = !prev;
      streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
      savePrefs({ videoEnabled: next });
      return next;
    });
  }, []);

  const stopAll = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  return {
    stream,
    audioEnabled,
    videoEnabled,
    toggleAudio,
    toggleVideo,
    stopAll,
    audioInputs,
    videoInputs,
    audioOutputs,
    selectedAudioInput,
    selectedVideoInput,
    selectedAudioOutput,
    switchAudioInput,
    switchVideoInput,
    switchAudioOutput,
    onTrackChangedRef,
  };
}
