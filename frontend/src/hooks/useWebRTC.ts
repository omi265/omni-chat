import { useEffect, useRef, useState, useCallback } from 'react';
import { getBackendUrl, getSocket } from '../lib/socket';
import { 
  getPersistentKeyPair, 
  KeyPair,
  getOrCreateRoomKey,
  encryptRoomMessage,
  decryptRoomMessage,
  encryptFile,
  decryptFile
} from '../lib/crypto';

interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  channelId?: string;
  file?: RoomFile;
}

interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
}

interface PeerConnectionData {
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  username: string;
  publicKey?: string;
}

interface RoomMember {
  username: string;
  publicKey: string;
  socketId: string | null;
  isOnline: boolean;
  isSpeaking?: boolean;
  avatarColor?: string;
  avatarUrl?: string | null;
  role?: string;
  voiceChannelId?: string | null;
}

export interface RoomFile {
  id: string;
  channelId: string;
  sender: string;
  name: string;
  type: string;
  size: number;
  nonce: string;
  timestamp: number;
  thumbKey?: string | null;
  thumbType?: string | null;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
  previewStatus?: 'ready' | 'processing' | 'failed' | null;
  data?: Uint8Array; // Only present when downloading
  localUrl?: string; // Blob URL for previews
  thumbUrl?: string | null;
}

const toUint8Array = (payload: unknown): Uint8Array => {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload);
  if (payload && typeof payload === 'object') {
    if ('data' in payload && Array.isArray((payload as { data?: unknown }).data)) {
      return Uint8Array.from((payload as { data: number[] }).data);
    }
    if (
      'buffer' in payload &&
      (payload as { buffer?: unknown }).buffer instanceof ArrayBuffer &&
      typeof (payload as { byteOffset?: unknown }).byteOffset === 'number' &&
      typeof (payload as { byteLength?: unknown }).byteLength === 'number'
    ) {
      const typed = payload as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
      return new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    }
  }
  return new Uint8Array();
};

const withPreviewUrl = (file: RoomFile): RoomFile => ({
  ...file,
  thumbUrl: file.previewStatus === 'ready' && file.thumbKey ? `${getBackendUrl()}/media/thumb/${file.id}` : null,
});

export const useWebRTC = (roomId: string, username: string, localStream: MediaStream | null) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [roomFiles, setRoomFiles] = useState<RoomFile[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string>(roomId + ':general');
  const [keys, setKeys] = useState<KeyPair | null>(null);
  const [roomKey, setRoomKey] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [fileTransferError, setFileTransferError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const socket = getSocket();
  const peersRef = useRef<Map<string, PeerConnectionData>>(new Map());
  const messagesSet = useRef<Set<string>>(new Set());

  const addMessage = useCallback((msg: Message) => {
    if (messagesSet.current.has(msg.id)) return;
    messagesSet.current.add(msg.id);
    setMessages(prev => [...prev, msg].sort((a, b) => a.timestamp - b.timestamp).slice(-200));
  }, []);

  useEffect(() => {
    const kp = getPersistentKeyPair(username);
    setKeys(kp);
    const rk = getOrCreateRoomKey(roomId);
    setRoomKey(rk);

    socket.connect();

    socket.on('channel-list', (list: Channel[]) => {
      setChannels(list);
      setActiveChannelId(prev => {
        if (list.some(c => c.id === prev)) return prev;
        const general = list.find(c => c.id === roomId + ':general');
        return general ? general.id : (list[0]?.id || prev);
      });
    });

    socket.on('room-history-bulk', (history: any[]) => {
      history.forEach(msg => {
        try {
          const plaintext = decryptRoomMessage(msg.payload.ciphertext, msg.payload.nonce, rk);
          addMessage({ ...msg, text: plaintext });
        } catch (err) {}
      });
    });

    socket.on('room-files-bulk', (files: RoomFile[]) => {
      setRoomFiles(files.map(withPreviewUrl));
    });

    socket.on('room-file', (file: RoomFile) => {
      setFileTransferError(null);
      setRoomFiles(prev => {
        if (prev.some(existing => existing.id === file.id)) return prev;
        return [...prev, withPreviewUrl(file)];
      });
    });

    socket.on('room-file-data', (fileData: any) => {
      if (!rk) return;
      try {
        const encryptedBytes = toUint8Array(fileData.data);
        const decrypted = decryptFile(encryptedBytes, fileData.nonce, rk);
        // Casting to any to bypass TS error regarding Uint8Array buffer compatibility with BlobPart
        const blob = new Blob([decrypted as any], { type: fileData.type });
        const url = URL.createObjectURL(blob);
        
        setRoomFiles(prev => prev.map(f => f.id === fileData.id ? { ...f, localUrl: url, data: decrypted } : f));
      } catch (e) {
        console.error('Failed to decrypt file', e);
      }
    });

    socket.on('room-history', ({ channelId, messages: history }: { channelId: string, messages: any[] }) => {
      history.forEach(msg => {
        try {
          const plaintext = decryptRoomMessage(msg.payload.ciphertext, msg.payload.nonce, rk);
          addMessage({ ...msg, text: plaintext, channelId });
        } catch (err) {}
      });
    });

    socket.on('room-message', (msg: any) => {
      try {
        const plaintext = decryptRoomMessage(msg.payload.ciphertext, msg.payload.nonce, rk);
        addMessage({ ...msg, text: plaintext });
      } catch (err) {}
    });

    socket.on('room-members-list', (members: RoomMember[]) => {
      setRoomMembers(members);
      members.filter(m => m.isOnline && m.username !== username && m.socketId).forEach(m => {
        initiateConnection(m.socketId!, m.username, true);
      });
    });

    const onConnect = () => {
      socket.emit('register-user', { username, publicKey: kp.publicKey });
      socket.emit('join-room', { roomId, username });
    };

    if (socket.connected) onConnect();
    else socket.on('connect', onConnect);

    socket.on('user-joined', ({ socketId, username: joinedUser, publicKey: joinedPubKey, avatarColor, avatarUrl, role, voiceChannelId }) => {
      setRoomMembers(prev => {
        const existingIndex = prev.findIndex(m => m.username === joinedUser);
        if (existingIndex !== -1) {
          const next = [...prev];
          next[existingIndex] = { ...next[existingIndex], isOnline: true, socketId, publicKey: joinedPubKey, avatarColor, avatarUrl, role, voiceChannelId };
          return next;
        }
        return [...prev, { username: joinedUser, publicKey: joinedPubKey, socketId, isOnline: true, avatarColor, avatarUrl, role, voiceChannelId }];
      });
      initiateConnection(socketId, joinedUser, false);
    });

    socket.on('voice-state-update', ({ username: user, channelId }) => {
      setRoomMembers(prev => prev.map(m => m.username === user ? { ...m, voiceChannelId: channelId } : m));
    });

    socket.on('user-left', ({ socketId, username: leftUser }) => {
      const peer = peersRef.current.get(socketId);
      if (peer) {
        peer.pc.close();
        peersRef.current.delete(socketId);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(leftUser);
          return next;
        });
      }
      setRoomMembers(prev => prev.map(m => m.username === leftUser ? { ...m, isOnline: false, socketId: null, voiceChannelId: null } : m));
    });

    socket.on('webrtc-offer', async ({ senderSocketId, offer }) => {
      const peer = peersRef.current.get(senderSocketId);
      if (peer) {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        socket.emit('webrtc-answer', { targetSocketId: senderSocketId, answer });
      }
    });

    socket.on('webrtc-answer', async ({ senderSocketId, answer }) => {
      const peer = peersRef.current.get(senderSocketId);
      if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('ice-candidate', async ({ senderSocketId, candidate }) => {
      const peer = peersRef.current.get(senderSocketId);
      if (peer) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    });

    socket.on('speaking-update', ({ username: speaker, isSpeaking }) => {
      setRoomMembers(prev => prev.map(m => m.username === speaker ? { ...m, isSpeaking } : m));
    });

    return () => {
      socket.disconnect();
      socket.off('connect', onConnect);
      socket.off('channel-list');
      socket.off('room-history-bulk');
      socket.off('room-files-bulk');
      socket.off('room-file');
      socket.off('room-file-data');
      socket.off('room-history');
      socket.off('room-message');
      socket.off('room-members-list');
      socket.off('user-joined');
      socket.off('voice-state-update');
      socket.off('user-left');
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('ice-candidate');
      socket.off('speaking-update');
      peersRef.current.forEach(p => p.pc.close());
      peersRef.current.clear();
    };
  }, [roomId, username, addMessage]);

  // Handle localStream changes
  useEffect(() => {
    if (localStream) {
      peersRef.current.forEach((peer, socketId) => {
        const senders = peer.pc.getSenders();
        if (!senders.some(s => s.track?.kind === 'audio')) {
          localStream.getTracks().forEach(track => peer.pc.addTrack(track, localStream));
          peer.pc.createOffer().then(o => peer.pc.setLocalDescription(o)).then(() => {
            socket.emit('webrtc-offer', { targetSocketId: socketId, offer: peer.pc.localDescription });
          });
        }
      });
    }
  }, [localStream, socket]);

  const initiateConnection = (targetSocketId: string, targetUsername: string, isInitiator: boolean) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    let dc: RTCDataChannel;
    if (isInitiator) {
      dc = pc.createDataChannel('chat');
      setupDataChannel(dc, targetSocketId);
    } else {
      dc = pc.createDataChannel('dummy'); 
      pc.ondatachannel = (event) => {
        setupDataChannel(event.channel, targetSocketId);
        const peer = peersRef.current.get(targetSocketId);
        if (peer) peer.dc = event.channel;
      };
    }

    pc.onicecandidate = (e) => e.candidate && socket.emit('ice-candidate', { targetSocketId, candidate: e.candidate });
    pc.ontrack = (event) => {
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.set(targetUsername, event.streams[0]);
        return next;
      });
    };

    if (isInitiator) {
      pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('webrtc-offer', { targetSocketId, offer: pc.localDescription }));
    }
    peersRef.current.set(targetSocketId, { pc, dc, username: targetUsername });
  };

  const setupDataChannel = (dc: RTCDataChannel, targetSocketId: string) => {
    dc.onopen = () => keys && roomKey && dc.send(JSON.stringify({ type: 'key-exchange', publicKey: keys.publicKey, roomKey }));
    dc.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const peer = peersRef.current.get(targetSocketId);
        if (data.type === 'key-exchange' && peer) {
          peer.publicKey = data.publicKey;
        } else if (data.type === 'chat' && peer && keys && roomKey) {
          const plaintext = decryptRoomMessage(data.payload.ciphertext, data.payload.nonce, roomKey);
          addMessage({ ...data, text: plaintext });
        }
      } catch (e) {}
    };
  };

  const switchChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    socket.emit('get-channel-history', { roomId, channelId });
  };

  const createChannel = (name: string, type: 'text' | 'voice') => {
    socket.emit('create-channel', { roomId, name, type });
  };

  const deleteChannel = (channelId: string) => {
    socket.emit('delete-channel', { roomId, channelId });
  };

  const joinVoiceChannel = (channelId: string) => {
    socket.emit('join-voice', { roomId, channelId });
  };

  const leaveVoiceChannel = () => {
    socket.emit('leave-voice', { roomId });
  };

  const sendFile = async (file: File) => {
    console.log('sendFile triggered for:', file.name, file.size, file.type);
    if (!roomKey) {
      console.error('No roomKey available for encryption');
      return;
    }
    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const data = new Uint8Array(reader.result as ArrayBuffer);
      const encrypted = encryptFile(data, roomKey);
      
      const isImage = file.type.startsWith('image/') || 
                      file.name.toLowerCase().endsWith('.png') || 
                      file.name.toLowerCase().endsWith('.jpg') || 
                      file.name.toLowerCase().endsWith('.jpeg') || 
                      file.name.toLowerCase().endsWith('.webp') || 
                      file.name.toLowerCase().endsWith('.gif');

      const previewData = isImage ? data : undefined;
      
      const fileObj = {
        id: Math.random().toString(36).substring(7),
        channelId: activeChannelId,
        sender: username,
        name: file.name, // In a pro app, encrypt this too
        type: file.type,
        size: file.size,
        data: encrypted.data,
        previewData,
        nonce: encrypted.nonce,
        timestamp: Date.now()
      };

      console.log('Emitting send-room-file event', { id: fileObj.id, name: fileObj.name });
      socket.emit(
        'send-room-file',
        { roomId, channelId: activeChannelId, file: fileObj },
        (response: {
          ok: boolean;
          fileId?: string;
          message?: string;
          thumbKey?: string | null;
          thumbType?: string | null;
          thumbWidth?: number | null;
          thumbHeight?: number | null;
          previewStatus?: 'ready' | 'processing' | 'failed' | null;
        }) => {
          setIsUploading(false);
          console.log('Received response from send-room-file', response);
          if (!response?.ok) {
            setFileTransferError(response?.message || 'Failed to upload file');
            return;
          }
          setFileTransferError(null);
          setRoomFiles(prev => {
            if (prev.some(existing => existing.id === fileObj.id)) return prev;
            return [
              ...prev,
              withPreviewUrl({
                ...fileObj,
                data: undefined,
                thumbKey: response.thumbKey ?? null,
                thumbType: response.thumbType ?? null,
                thumbWidth: response.thumbWidth ?? null,
                thumbHeight: response.thumbHeight ?? null,
                previewStatus: response.previewStatus ?? null,
              }),
            ];
          });
        }
      );
    };
    reader.onerror = () => {
      setIsUploading(false);
      setFileTransferError('Failed to read file from device');
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadFile = (fileId: string) => {
    socket.emit('get-room-file', { roomId, fileId });
  };

  const sendMessage = useCallback((text: string) => {
    if (!keys || !roomKey) return;
    const msgId = Math.random().toString(36).substring(7);
    const timestamp = Date.now();
    const roomEncrypted = encryptRoomMessage(text, roomKey);
    const messageObj = { 
      id: msgId, 
      sender: username, 
      timestamp, 
      payload: roomEncrypted, 
      channelId: activeChannelId
    };
    addMessage({ ...messageObj, text });
    socket.emit('send-room-message', { roomId, channelId: activeChannelId, message: messageObj });
    peersRef.current.forEach((peer) => {
      if (peer.dc.readyState === 'open') {
        peer.dc.send(JSON.stringify({
          type: 'chat',
          ...messageObj
        }));
      }
    });
  }, [username, keys, roomKey, roomId, socket, addMessage, activeChannelId]);

  const broadcastSpeaking = useCallback((isSpeaking: boolean) => {
    socket.emit('speaking-update', { roomId, username, isSpeaking });
  }, [roomId, username, socket]);

  return { 
    messages, 
    roomMembers,
    channels,
    roomFiles,
    activeChannelId,
    connectedUsers: roomMembers.filter(m => m.isOnline && m.username !== username).map(m => m.username), 
    remoteStreams,
    sendMessage,
    sendFile,
    downloadFile,
    switchChannel,
    createChannel,
    deleteChannel,
    joinVoiceChannel,
    leaveVoiceChannel,
    broadcastSpeaking,
    isReady: !!keys && !!roomKey,
    fileTransferError,
    isUploading,
  };
};
