import { useEffect, useRef, useState, useMemo } from "react";

export type SignalingMessage = {
  type: string;
  [key: string]: unknown;
};

export interface SignalingHandle {
  sendMessage: (msg: SignalingMessage) => void;
  setOnMessage: (handler: (msg: SignalingMessage) => void) => void;
  close: () => void;
}

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 10000];

export function useSignaling(callId: string | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef<((msg: SignalingMessage) => void) | null>(null);
  const [connected, setConnected] = useState(false);
  const closedIntentionally = useRef(false);

  const handle = useMemo<SignalingHandle>(() => ({
    sendMessage(msg: SignalingMessage) {
      wsRef.current?.send(JSON.stringify(msg));
    },
    setOnMessage(handler: (msg: SignalingMessage) => void) {
      onMessageRef.current = handler;
    },
    close() {
      closedIntentionally.current = true;
      wsRef.current?.close();
      wsRef.current = null;
    },
  }), []);

  useEffect(() => {
    if (!callId) return;

    const wsUrl = import.meta.env.VITE_WS_URL
      || `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

    let cancelled = false;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    closedIntentionally.current = false;

    function connect() {
      if (cancelled) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          ws.close();
          return;
        }
        reconnectAttempt = 0;
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

        if (!cancelled && !closedIntentionally.current) {
          const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
          console.log(`[signaling] reconnecting in ${delay}ms (attempt ${reconnectAttempt + 1})`);
          reconnectAttempt++;
          reconnectTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };
  }, [callId]);

  return { handle, connected };
}
