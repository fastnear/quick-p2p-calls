import { useEffect, useRef, useState, useCallback } from "react";
import type { SignalingHandle, SignalingMessage } from "./useSignaling";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export interface MediaDebug {
  codec: string;
  resolution: string;
  framerate: number | null;
  bitrate: number | null;
}

export interface WebRTCDebug {
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
  localCandidateType: string;
  remoteCandidateType: string;
  roundTripTime: number | null;
  bytesSent: number;
  bytesReceived: number;
  outboundVideo: MediaDebug | null;
  inboundVideo: MediaDebug | null;
  outboundAudio: MediaDebug | null;
  inboundAudio: MediaDebug | null;
}

const emptyDebug: WebRTCDebug = {
  connectionState: "new",
  iceConnectionState: "new",
  iceGatheringState: "new",
  signalingState: "closed",
  localCandidateType: "",
  remoteCandidateType: "",
  roundTripTime: null,
  bytesSent: 0,
  bytesReceived: 0,
  outboundVideo: null,
  inboundVideo: null,
  outboundAudio: null,
  inboundAudio: null,
};

export function useWebRTC(signaling: SignalingHandle, connected: boolean, localStream: MediaStream | null) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<string>("new");
  const [debug, setDebug] = useState<WebRTCDebug>(emptyDebug);
  const localStreamRef = useRef(localStream);
  const pendingRef = useRef<SignalingMessage | null>(null);
  const handlerRef = useRef<((msg: SignalingMessage) => Promise<void>) | null>(null);
  const prevOutboundVideo = useRef<number | null>(null);
  const prevInboundVideo = useRef<number | null>(null);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  const cleanup = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    setRemoteStream(null);
    setConnectionState("closed");
    setDebug(emptyDebug);
  }, []);

  useEffect(() => {
    console.log("[webrtc] effect run, connected:", connected, "stream:", !!localStreamRef.current);
    if (!connected) return;

    const createPC = () => {
      pcRef.current?.close();
      const stream = localStreamRef.current!;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      const remote = new MediaStream();
      setRemoteStream(remote);

      pc.ontrack = (e) => {
        e.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          signaling.sendMessage({
            type: "ice-candidate",
            candidate: e.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        setConnectionState(pc.connectionState);
      };

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      // Prefer AV1 > H264 > VP9 > VP8, set max quality
      for (const transceiver of pc.getTransceivers()) {
        if (transceiver.sender.track?.kind === "video") {
          const caps = RTCRtpReceiver.getCapabilities?.("video");
          if (caps) {
            const preferred = ["video/AV1", "video/H264", "video/VP9", "video/VP8"];
            const sorted = [...caps.codecs].sort((a, b) => {
              const ai = preferred.indexOf(a.mimeType);
              const bi = preferred.indexOf(b.mimeType);
              return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
            });
            transceiver.setCodecPreferences(sorted);
          }

          const params = transceiver.sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 256_000_000; // 256 Mbps
          params.encodings[0].maxFramerate = 60;
          transceiver.sender.setParameters(params).catch(() => {});
        }
      }

      return pc;
    };

    const handleMessage = async (msg: SignalingMessage) => {
      console.log("[webrtc] handleMessage:", msg.type, "stream:", !!localStreamRef.current);
      if ((msg.type === "peer-joined" || msg.type === "offer") && !localStreamRef.current) {
        console.log("[webrtc] buffering message, no stream yet");
        pendingRef.current = msg;
        return;
      }

      switch (msg.type) {
        case "peer-joined": {
          console.log("[webrtc] creating offer");
          const pc = createPC();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signaling.sendMessage({ type: "offer", sdp: pc.localDescription });
          break;
        }

        case "offer": {
          console.log("[webrtc] received offer, creating answer");
          const pc = createPC();
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.sendMessage({ type: "answer", sdp: pc.localDescription });
          break;
        }

        case "answer": {
          await pcRef.current?.setRemoteDescription(
            new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit)
          );
          break;
        }

        case "ice-candidate": {
          if (msg.candidate) {
            await pcRef.current?.addIceCandidate(
              new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)
            );
          }
          break;
        }

        case "peer-left": {
          cleanup();
          break;
        }
      }
    };

    handlerRef.current = handleMessage;
    signaling.setOnMessage(handleMessage);
    console.log("[webrtc] handler registered");

    const statsInterval = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;

      const info: WebRTCDebug = {
        ...emptyDebug,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      };

      try {
        const stats = await pc.getStats();
        const codecs = new Map<string, string>();

        // First pass: collect codec info
        stats.forEach((report) => {
          if (report.type === "codec") {
            codecs.set(report.id, report.mimeType ?? "");
          }
        });

        // Second pass: collect everything else
        stats.forEach((report) => {
          if (report.type === "candidate-pair" && report.state === "succeeded") {
            info.roundTripTime = report.currentRoundTripTime ?? null;
            const local = report.localCandidateId ? stats.get(report.localCandidateId) : null;
            const remote = report.remoteCandidateId ? stats.get(report.remoteCandidateId) : null;
            if (local) info.localCandidateType = `${local.candidateType} ${local.protocol ?? ""}`;
            if (remote) info.remoteCandidateType = `${remote.candidateType} ${remote.protocol ?? ""}`;
          }

          if (report.type === "transport") {
            info.bytesSent = report.bytesSent ?? 0;
            info.bytesReceived = report.bytesReceived ?? 0;
          }

          if (report.type === "outbound-rtp" && report.kind === "video") {
            const codec = report.codecId ? (codecs.get(report.codecId) ?? "") : "";
            const prevBytes = prevOutboundVideo.current;
            const bitrate = prevBytes !== null ? (report.bytesSent - prevBytes) * 8 : null;
            prevOutboundVideo.current = report.bytesSent;
            info.outboundVideo = {
              codec: codec.replace("video/", ""),
              resolution: report.frameWidth && report.frameHeight ? `${report.frameWidth}x${report.frameHeight}` : "",
              framerate: report.framesPerSecond ?? null,
              bitrate,
            };
          }

          if (report.type === "inbound-rtp" && report.kind === "video") {
            const codec = report.codecId ? (codecs.get(report.codecId) ?? "") : "";
            const prevBytes = prevInboundVideo.current;
            const bitrate = prevBytes !== null ? (report.bytesReceived - prevBytes) * 8 : null;
            prevInboundVideo.current = report.bytesReceived;
            info.inboundVideo = {
              codec: codec.replace("video/", ""),
              resolution: report.frameWidth && report.frameHeight ? `${report.frameWidth}x${report.frameHeight}` : "",
              framerate: report.framesPerSecond ?? null,
              bitrate,
            };
          }

          if (report.type === "outbound-rtp" && report.kind === "audio") {
            const codec = report.codecId ? (codecs.get(report.codecId) ?? "") : "";
            info.outboundAudio = { codec: codec.replace("audio/", ""), resolution: "", framerate: null, bitrate: null };
          }

          if (report.type === "inbound-rtp" && report.kind === "audio") {
            const codec = report.codecId ? (codecs.get(report.codecId) ?? "") : "";
            info.inboundAudio = { codec: codec.replace("audio/", ""), resolution: "", framerate: null, bitrate: null };
          }
        });
      } catch { /* stats unavailable */ }

      setDebug(info);
    }, 1000);

    return () => {
      clearInterval(statsInterval);
      console.log("[webrtc] effect cleanup");
      handlerRef.current = null;
      // Don't close the peer connection here — it should survive WS reconnects.
      // cleanup() is called explicitly on peer-left or hang up.
    };
  }, [connected, signaling, cleanup]);

  // Replay pending message once localStream becomes available
  useEffect(() => {
    if (localStream && pendingRef.current && handlerRef.current) {
      const msg = pendingRef.current;
      pendingRef.current = null;
      handlerRef.current(msg);
    }
  }, [localStream]);

  const replaceTracks = useCallback((newStream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) return;
    for (const sender of pc.getSenders()) {
      const newTrack = newStream.getTracks().find((t) => t.kind === sender.track?.kind);
      if (newTrack) {
        sender.replaceTrack(newTrack).catch(() => {});
      }
    }
  }, []);

  return { remoteStream, connectionState, debug, cleanup, replaceTracks };
}
