import { io, Socket } from 'socket.io-client';

const getBackendUrl = () => {
  if (process.env.NEXT_PUBLIC_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_URL;
  }
  
  // In a unified server setup, we can just use a relative path
  // or the current origin. This works perfectly with proxies/subdomains.
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  return 'http://localhost:2650';
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
