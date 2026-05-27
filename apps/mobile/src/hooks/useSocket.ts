import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { socketUrl } from "../lib/api";
import { useSessionStore } from "../stores/session.store";

let sharedSocket: Socket | null = null;

export function useSocket(): Socket | null {
  const token = useSessionStore((state) => state.session?.token);
  const [socket, setSocket] = useState<Socket | null>(sharedSocket);

  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }

    if (!sharedSocket) {
      sharedSocket = io(socketUrl, { auth: { token }, autoConnect: true });
    } else {
      sharedSocket.auth = { token };
      if (!sharedSocket.connected) {
        sharedSocket.connect();
      }
    }

    setSocket(sharedSocket);

    return () => {
      // Keep shared connection alive across tab screens.
    };
  }, [token]);

  return socket;
}

export function disconnectSocket(): void {
  sharedSocket?.disconnect();
  sharedSocket = null;
}

export function useSocketEvents(events: Record<string, (...args: any[]) => void>): void {
  const socket = useSocket();

  useEffect(() => {
    if (!socket || Object.keys(events).length === 0) {
      return;
    }

    for (const [event, handler] of Object.entries(events)) {
      socket.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(events)) {
        socket.off(event, handler);
      }
    };
  }, [socket, events]);
}
