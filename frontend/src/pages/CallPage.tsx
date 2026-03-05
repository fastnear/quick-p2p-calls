import { useParams, useNavigate } from "react-router-dom";
import { useRef, useEffect, useState, useCallback } from "react";
import { useSignaling } from "../hooks/useSignaling";
import { useMediaDevices } from "../hooks/useMediaDevices";
import { useWebRTC } from "../hooks/useWebRTC";

function formatBitrate(bps: number): string {
  if (bps < 1000) return `${bps} bps`;
  if (bps < 1000_000) return `${(bps / 1000).toFixed(0)} kbps`;
  return `${(bps / 1000_000).toFixed(1)} Mbps`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function CallPage() {
  const { callId } = useParams<{ callId: string }>();
  const navigate = useNavigate();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);
  const [debugOpen, setDebugOpen] = useState(() => localStorage.getItem("debug-open") === "true");
  const [swapped, setSwapped] = useState(false);

  const { handle: signaling, connected } = useSignaling(callId);
  const { stream, audioEnabled, videoEnabled, toggleAudio, toggleVideo, stopAll } =
    useMediaDevices();
  const { remoteStream, connectionState, debug, cleanup: cleanupWebRTC } = useWebRTC(
    signaling,
    connected,
    stream
  );

  useEffect(() => {
    if (localVideoRef.current && stream) {
      localVideoRef.current.srcObject = stream;
    }
  }, [stream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const hangUp = useCallback(() => {
    cleanupWebRTC();
    stopAll();
    signaling.sendMessage({ type: "leave" });
    signaling.close();
    navigate("/");
  }, [cleanupWebRTC, stopAll, signaling, navigate]);

  const isConnected = connectionState === "connected";
  const isWaiting = !remoteStream || connectionState === "new" || connectionState === "closed";

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-gray-900">
      {/* Main video */}
      <video
        ref={swapped ? localVideoRef : remoteVideoRef}
        autoPlay
        playsInline
        muted={swapped}
        className={`h-full w-full object-cover ${swapped ? "-scale-x-100" : ""}`}
      />

      {/* PIP video */}
      <video
        ref={swapped ? remoteVideoRef : localVideoRef}
        autoPlay
        playsInline
        muted={!swapped}
        onClick={() => setSwapped((s) => !s)}
        className={`absolute bottom-24 right-4 h-36 w-48 cursor-pointer rounded-lg border-2 border-gray-700 object-cover shadow-lg ${!swapped ? "-scale-x-100" : ""}`}
      />

      {/* Waiting overlay */}
      {isWaiting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/80">
          <div className="mb-6 text-xl text-gray-300">Waiting for someone to join...</div>
          <div className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2">
            <span className="max-w-xs truncate text-sm text-gray-400">
              {window.location.href}
            </span>
            <button
              onClick={copyLink}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-500"
            >
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>
        </div>
      )}

      {/* Control bar */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-4">
        {/* Mic toggle */}
        <button
          onClick={toggleAudio}
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            audioEnabled ? "bg-gray-700 hover:bg-gray-600" : "bg-red-600 hover:bg-red-500"
          }`}
          title={audioEnabled ? "Mute" : "Unmute"}
        >
          {audioEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" x2="22" y1="2" y2="22"/>
              <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/>
              <path d="M5 10v2a7 7 0 0 0 12 5.66"/>
              <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/>
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          )}
        </button>

        {/* Camera toggle */}
        <button
          onClick={toggleVideo}
          className={`flex h-12 w-12 items-center justify-center rounded-full ${
            videoEnabled ? "bg-gray-700 hover:bg-gray-600" : "bg-red-600 hover:bg-red-500"
          }`}
          title={videoEnabled ? "Camera off" : "Camera on"}
        >
          {videoEnabled ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/>
              <rect x="2" y="6" width="14" height="12" rx="2"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/>
              <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/>
              <line x1="2" x2="22" y1="2" y2="22"/>
            </svg>
          )}
        </button>

        {/* Hang up */}
        <button
          onClick={hangUp}
          className="flex h-12 w-14 items-center justify-center rounded-full bg-red-600 hover:bg-red-500"
          title="Hang up"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4Z"/>
          </svg>
        </button>
      </div>

      {/* Connection status */}
      {isConnected && (
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-gray-800/70 px-3 py-1 text-xs text-green-400">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          Connected
        </div>
      )}

      {/* Debug panel */}
      <div className="absolute right-4 top-4 rounded-lg bg-black/70 font-mono text-xs text-gray-300">
        <button
          onClick={() => setDebugOpen((o) => { const next = !o; localStorage.setItem("debug-open", String(next)); return next; })}
          className="flex w-full items-center gap-1 px-3 py-2 font-semibold text-gray-100"
        >
          <span className={`inline-block transition-transform ${debugOpen ? "rotate-90" : ""}`}>&#9654;</span>
          Debug
        </button>
        {debugOpen && (
          <div className="px-3 pb-2 leading-relaxed">
            <div>WS: {connected ? <span className="text-green-400">connected</span> : <span className="text-red-400">disconnected</span>}</div>
            <div>Connection: <span className={debug.connectionState === "connected" ? "text-green-400" : "text-yellow-400"}>{debug.connectionState}</span></div>
            <div>ICE: <span className={debug.iceConnectionState === "connected" ? "text-green-400" : "text-yellow-400"}>{debug.iceConnectionState}</span></div>
            <div>ICE gathering: {debug.iceGatheringState}</div>
            <div>Signaling: {debug.signalingState}</div>
            {debug.localCandidateType && <div>Local: {debug.localCandidateType}</div>}
            {debug.remoteCandidateType && <div>Remote: {debug.remoteCandidateType}</div>}
            {debug.roundTripTime !== null && <div>RTT: {(debug.roundTripTime * 1000).toFixed(0)}ms</div>}
            {(debug.bytesSent > 0 || debug.bytesReceived > 0) && (
              <div>TX/RX: {formatBytes(debug.bytesSent)} / {formatBytes(debug.bytesReceived)}</div>
            )}
            {debug.outboundVideo && (
              <>
                <div className="mt-1 font-semibold text-gray-100">Video Out</div>
                <div>{debug.outboundVideo.codec} {debug.outboundVideo.resolution}</div>
                {debug.outboundVideo.framerate !== null && <div>{debug.outboundVideo.framerate} fps</div>}
                {debug.outboundVideo.bitrate !== null && <div>{formatBitrate(debug.outboundVideo.bitrate)}</div>}
              </>
            )}
            {debug.inboundVideo && (
              <>
                <div className="mt-1 font-semibold text-gray-100">Video In</div>
                <div>{debug.inboundVideo.codec} {debug.inboundVideo.resolution}</div>
                {debug.inboundVideo.framerate !== null && <div>{debug.inboundVideo.framerate} fps</div>}
                {debug.inboundVideo.bitrate !== null && <div>{formatBitrate(debug.inboundVideo.bitrate)}</div>}
              </>
            )}
            {(debug.outboundAudio || debug.inboundAudio) && (
              <>
                <div className="mt-1 font-semibold text-gray-100">Audio</div>
                {debug.outboundAudio && <div>Out: {debug.outboundAudio.codec}</div>}
                {debug.inboundAudio && <div>In: {debug.inboundAudio.codec}</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
