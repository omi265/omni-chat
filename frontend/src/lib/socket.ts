import { io, Socket } from 'socket.io-client';

const getBackendUrl = () => {
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }
  
  if (typeof window !== 'undefined') {
    const { protocol, hostname, port, origin } = window.location;

    // In local split-dev, Next runs on 3000 and the backend runs on 3001.
    if (port === '3000') {
      return `${protocol}//${hostname}:3001`;
    }

    // In the unified production/static setup, frontend and backend share one origin.
    return origin;
  }
  
  return 'http://localhost:3001';
};

let socket: Socket | null = null;

export const getSocket = () => {
  if (!socket) {
    // If we're using origin, Socket.io handles the path automatically
    socket = io(getBackendUrl(), {
      autoConnect: false,
    });
  }
  return socket;
};
