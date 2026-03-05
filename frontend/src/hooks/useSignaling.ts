import { useEffect, useRef, useCallback, useState, useMemo } from "react";

export type SignalingMessage = {
  type: string;
  [key: string]: unknown;
};

export interface SignalingHandle {
  sendMessage: (msg: SignalingMessage) => void;
  setOnMessage: (handler: (msg: SignalingMessage) => void) => void;
  close: () => void;
}

export function useSignaling(callId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<((msg: SignalingMessage) => void) | null>(null);
  const [connected, setConnected] = useState(false);

  const handle = useMemo<SignalingHandle>(() => ({
    sendMessage(msg: SignalingMessage) {
      wsRef.current?.send(JSON.stringify(msg));
    },
    setOnMessage(handler: (msg: SignalingMessage) => void) {
      onMessageRef.current = handler;
    },
    close() {
      wsRef.current?.close();
      wsRef.current = null;
    },
  }), []);

  useEffect(() => {
    if (!callId) return;

    const wsUrl = import.meta.env.VITE_WS_URL
      || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

    let cancelled = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) {
        ws.close();
        return;
      }
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", call_id: callId }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as SignalingMessage;
      console.log("[signaling] recv:", msg.type, "handler set:", !!onMessageRef.current);
      onMessageRef.current?.(msg);
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        setConnected(false);
        wsRef.current = null;
      }
    };

    return () => {
      cancelled = true;
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [callId]);

  return { handle, connected };
}
