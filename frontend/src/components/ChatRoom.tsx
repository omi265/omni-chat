'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useWebRTC, RoomFile } from '../hooks/useWebRTC';
import { useMediaStream } from '../hooks/useMediaStream';
import UserSettingsModal from './UserSettingsModal';
import { getSocket } from '../lib/socket';

interface ServerInfo {
  id: string;
  name: string;
}

interface ChatRoomProps {
  roomId: string;
  username: string;
  joinedServers: ServerInfo[];
  onSwitchServer: (id: string) => void;
  onLeaveHome: () => void;
}

export default function ChatRoom({ roomId, username, joinedServers, onSwitchServer, onLeaveHome }: ChatRoomProps) {
  const { localStream, startStream, stopStream, toggleMute, toggleDeafen, isMuted, isDeafened, isSpeaking: isLocallySpeaking, mediaError } = useMediaStream();
  
  const [avatarColor, setAvatarColor] = useState(typeof window !== 'undefined' ? localStorage.getItem('p2p_avatar_color') || '#5865F2' : '#5865F2');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(typeof window !== 'undefined' ? localStorage.getItem('p2p_avatar_url') : null);
  const [showSettings, setShowSettings] = useState(false);

  const { 
    messages, 
    roomMembers, 
    channels,
    roomFiles,
    activeChannelId,
    connectedUsers,
    sendMessage, 
    sendFile,
    downloadFile,
    switchChannel,
    createChannel,
    deleteChannel,
    joinVoiceChannel,
    leaveVoiceChannel,
    broadcastSpeaking, 
    remoteStreams,
    isReady,
    fileTransferError,
    isUploading,
  } = useWebRTC(roomId, username, localStream);
  
  const [inputText, setInputText] = useState('');
  const [currentVoiceChannelId, setCurrentVoiceChannelId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({ text: true, voice: true, members: true });
  const [isCreatingChannel, setIsCreatingChannel] = useState<{ type: 'text' | 'voice' } | null>(null);
  const [newChannelName, setNewChannelName] = useState('');
  const [showServerInfo, setShowServerInfo] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

  const activeChannel = channels.find(c => c.id === activeChannelId);
  const isVoiceView = activeChannel?.type === 'voice';
  const serverName = roomId.split(':')[0];
  const serverSecret = roomId.split(':')[1] || '';

  useEffect(() => {
    if (currentVoiceChannelId) broadcastSpeaking(isLocallySpeaking);
  }, [isLocallySpeaking, currentVoiceChannelId, broadcastSpeaking]);

  useEffect(() => {
    remoteStreams.forEach((stream, peerName) => {
      let audio = audioRefs.current.get(peerName);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.setAttribute('playsinline', 'true');
        audioRefs.current.set(peerName, audio);
      }
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.volume = isDeafened ? 0 : 1;
      if (!isDeafened) audio.play().catch(() => {});
    });
    return () => {
      audioRefs.current.forEach(audio => { audio.srcObject = null; audio.remove(); });
      audioRefs.current.clear();
    };
  }, [remoteStreams, isDeafened]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isVoiceView, roomFiles, activeChannelId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      sendMessage(inputText);
      setInputText('');
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log('handleFileChange selected file:', file?.name);
    if (file) {
      if (file.size > 20 * 1024 * 1024) {
        alert('File is too large (max 20MB)');
        return;
      }
      sendFile(file);
    }
  };

  const handleJoinVoice = async (channelId: string) => {
    if (currentVoiceChannelId === channelId) return;
    const stream = await startStream();
    if (stream) {
      setCurrentVoiceChannelId(channelId);
      joinVoiceChannel(channelId);
    }
  };

  const handleLeaveVoice = () => {
    stopStream();
    setCurrentVoiceChannelId(null);
    leaveVoiceChannel();
    broadcastSpeaking(false);
  };

  const handleCreateChannel = () => {
    if (newChannelName.trim() && isCreatingChannel) {
      createChannel(newChannelName.trim().toLowerCase().replace(/\s+/g, '-'), isCreatingChannel.type);
      setNewChannelName('');
      setIsCreatingChannel(null);
    }
  };

  const handleInvite = () => {
    const code = btoa(JSON.stringify({ r: roomId }));
    const url = `${window.location.origin}?invite=${code}`;
    navigator.clipboard.writeText(url).then(() => {
      alert('Invite link copied to clipboard!');
    });
  };

  const saveProfile = (color: string, url: string | null) => {
    const socket = getSocket();
    const savedKeys = localStorage.getItem('p2p_chat_keys_' + username);
    socket.emit('register-user', { 
      username, 
      publicKey: savedKeys ? JSON.parse(savedKeys).publicKey : '',
      avatarColor: color,
      avatarUrl: url 
    });
    setAvatarColor(color);
    setAvatarUrl(url);
    localStorage.setItem('p2p_avatar_color', color);
    if (url) localStorage.setItem('p2p_avatar_url', url);
    else localStorage.removeItem('p2p_avatar_url');
    setShowSettings(false);
  };

  const renderFile = (file: RoomFile) => {
    const isImage = file.type.startsWith('image/');
    const isPdf = file.type === 'application/pdf';
    const isMarkdown = file.name.endsWith('.md');
    const previewSrc = file.localUrl || file.thumbUrl;

    return (
      <div key={file.id} className="mt-2 bg-[#2b2d31] border border-[#1e1f22] rounded-lg p-3 max-w-full sm:max-w-sm shadow-sm overflow-hidden">
        {isImage && previewSrc ? (
          <div className="relative group mb-2">
            <img src={previewSrc} className="max-h-64 rounded object-contain w-full bg-[#1e1f22] border border-white/5" alt={file.name} />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 rounded">
               {file.localUrl ? (
                 <a href={file.localUrl} target="_blank" rel="noopener noreferrer" className="bg-green-600 text-white px-4 py-2 rounded-full text-xs font-bold shadow-xl hover:bg-green-500 transition-colors">
                   Open Original
                 </a>
               ) : (
                 <button onClick={() => downloadFile(file.id)} className="bg-indigo-500 text-white px-4 py-2 rounded-full text-xs font-bold shadow-xl hover:bg-indigo-400 transition-colors">
                   Download Original
                 </button>
               )}
            </div>
          </div>
        ) : isImage && file.previewStatus === 'processing' ? (
          <div className="h-40 bg-[#1e1f22] rounded flex flex-col items-center justify-center mb-2 border border-dashed border-[#3f4147]">
            <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
            <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Generating Preview...</span>
          </div>
        ) : (
          <div className="flex items-center p-3 bg-[#1e1f22] rounded mb-2 border border-white/5">
            <div className="w-12 h-12 flex-shrink-0 flex items-center justify-center rounded bg-[#2b2d31] mr-3 text-xl shadow-inner">
              {isPdf ? '📕' : isMarkdown ? '📝' : '📄'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-[#dbdee1] truncate">{file.name}</div>
              <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">{(file.size / 1024).toFixed(1)} KB • {isPdf ? 'PDF' : isMarkdown ? 'Markdown' : 'File'}</div>
            </div>
          </div>
        )}
        
        <div className="flex space-x-2">
          {!file.localUrl ? (
            <button onClick={() => downloadFile(file.id)} className="flex-1 bg-[#4e5058] py-2 rounded text-[11px] font-bold text-white hover:bg-[#6d6f78] transition flex items-center justify-center space-x-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              <span>Download</span>
            </button>
          ) : (
            <a href={file.localUrl} download={file.name} className="flex-1 bg-[#23a559] py-2 rounded text-[11px] font-bold text-white text-center hover:bg-[#1a8344] transition flex items-center justify-center space-x-2">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
              <span>Save to Device</span>
            </a>
          )}
        </div>
        
        <div className="mt-2 text-[9px] text-gray-500/70 font-medium uppercase tracking-tighter text-right">
          {new Date(file.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    );
  };

  const renderMessagesAndFiles = () => {
    const combined: any[] = [
      ...messages.filter(m => !m.channelId || m.channelId === activeChannelId).map(m => ({ ...m, kind: 'msg' })),
      ...roomFiles.filter(f => f.channelId === activeChannelId).map(f => ({ ...f, kind: 'file' }))
    ].sort((a, b) => a.timestamp - b.timestamp);

    return combined.map((item, index) => {
      if (item.kind === 'file') {
        return (
          <div key={item.id} className="mt-[1.0625rem] px-4 group">
            <div className="flex items-baseline space-x-2 mb-1">
              <span className="font-medium text-indigo-400 text-xs">{item.sender} shared a file</span>
              <span className="text-[10px] text-gray-500">{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {renderFile(item)}
          </div>
        );
      }

      const prevMsg = combined[index - 1];
      const isCompact = prevMsg && prevMsg.kind === 'msg' && prevMsg.sender === item.sender && (item.timestamp - prevMsg.timestamp < 300000);
      const sender = roomMembers.find(m => m.username === item.sender);
      const color = sender?.avatarColor || (item.sender === username ? avatarColor : '#5865F2');
      const url = sender?.avatarUrl || (item.sender === username ? avatarUrl : null);

      if (isCompact) {
        return (
          <div key={item.id} className="group relative py-[2px] hover:bg-[#2e3035] px-4 text-left">
            <div className="flex items-start">
              <div className="w-[56px] shrink-0 text-[10px] text-[#949ba4] opacity-0 group-hover:opacity-100 flex items-center justify-center h-[22px] select-none">
                {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
              </div>
              <div className="flex-1 text-[#dbdee1] text-[15px] leading-[1.375rem] break-words whitespace-pre-wrap">
                {item.text}
              </div>
            </div>
          </div>
        );
      }

      return (
        <div key={item.id} className="group mt-[1.0625rem] py-[2px] hover:bg-[#2e3035] px-4 text-left">
          <div className="flex items-start">
            <div 
              className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-white font-bold text-lg mr-4 mt-[2px] overflow-hidden" 
              style={{ backgroundColor: color }}
            >
              {url ? <img src={url} className="w-full h-full object-cover" alt="" /> : item.sender[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline mb-[2px]">
                <span className="font-medium hover:underline cursor-pointer mr-2" style={{ color }}>{item.sender}</span>
                <span className="text-[12px] text-[#949ba4]">
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
              </div>
              <div className="text-[#dbdee1] text-[15px] leading-[1.375rem] break-words whitespace-pre-wrap">
                {item.text}
              </div>
            </div>
          </div>
        </div>
      );
    });
  };

  return (
    <div className="flex h-full bg-[#313338] text-gray-200 font-sans overflow-hidden relative">
      
      {/* Mobile Sidebar Backdrop */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-30 w-72 bg-[#2B2D31] flex flex-col shrink-0 transition-transform duration-300 ease-in-out md:relative md:w-60 md:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="md:hidden h-16 bg-[#1E1F22] flex items-center px-4 space-x-3 overflow-x-auto custom-scrollbar border-b border-[#1E1F22]">
          <div onClick={onLeaveHome} className="w-10 h-10 bg-[#313338] rounded-2xl flex items-center justify-center text-gray-300 shrink-0">H</div>
          {joinedServers.map(server => (
            <div 
              key={server.id}
              onClick={() => { onSwitchServer(server.id); setIsSidebarOpen(false); }}
              className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold shrink-0 ${server.id === roomId ? 'bg-indigo-500 text-white' : 'bg-[#313338] text-gray-300'}`}
            >
              {server.name.substring(0, 2).toUpperCase()}
            </div>
          ))}
        </div>

        <div className="h-12 border-b border-[#1E1F22] px-4 flex items-center justify-between shadow-sm font-bold text-white uppercase text-[11px] tracking-wider transition-colors hover:bg-[#35373C] cursor-pointer group">
          <span className="truncate" onClick={() => setShowServerInfo(true)}>{serverName}</span>
          <div className="flex items-center space-x-1">
            <button onClick={handleInvite} className="text-[#949ba4] hover:text-white p-1" title="Invite People"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg></button>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-400 p-1"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
          </div>
        </div>
        
        <nav className="flex-1 p-2 space-y-2 overflow-y-auto custom-scrollbar text-left">
          <section>
            <div className="px-2 mb-1 flex items-center justify-between text-[11px] font-semibold text-[#949ba4] uppercase tracking-wider group cursor-pointer">
              <div onClick={() => setExpandedSections(p => ({...p, text: !p.text}))} className="flex items-center hover:text-gray-200 flex-1">
                <svg className={`w-3 h-3 mr-1 transition-transform ${expandedSections.text ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z" /></svg>
                Text Channels
              </div>
              <button onClick={() => setIsCreatingChannel({ type: 'text' })} className="text-gray-400 hover:text-gray-200 text-lg leading-none">+</button>
            </div>
            {expandedSections.text && (
              <div className="space-y-0.5">
                {channels.filter(c => c.type === 'text').map(channel => (
                  <div key={channel.id} onClick={() => { switchChannel(channel.id); setIsSidebarOpen(false); }} className={activeChannelId === channel.id ? "px-2 py-1.5 rounded bg-[#3F4147] text-white flex items-center space-x-2 cursor-pointer group" : "px-2 py-1.5 rounded hover:bg-[#35373C] text-[#949ba4] flex items-center space-x-2 cursor-pointer group"}>
                    <span className="text-[#80848e] text-xl leading-none">#</span>
                    <span className="font-medium truncate text-[15px] flex-1">{channel.name}</span>
                    {channel.id && !channel.id.endsWith(':general') && (
                      <button onClick={(e) => { e.stopPropagation(); deleteChannel(channel.id); }} className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-red-400">×</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="px-2 mt-4 mb-1 flex items-center justify-between text-[11px] font-semibold text-[#949ba4] uppercase tracking-wider group cursor-pointer">
              <div onClick={() => setExpandedSections(p => ({...p, voice: !p.voice}))} className="flex items-center hover:text-gray-200 flex-1">
                <svg className={`w-3 h-3 mr-1 transition-transform ${expandedSections.voice ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z" /></svg>
                Voice Channels
              </div>
              <button onClick={() => setIsCreatingChannel({ type: 'voice' })} className="text-gray-400 hover:text-gray-200 text-lg leading-none">+</button>
            </div>
            {expandedSections.voice && (
              <div className="space-y-1">
                {channels.filter(c => c.type === 'voice').map(channel => {
                  const isJoined = currentVoiceChannelId === channel.id;
                  return (
                    <div key={channel.id}>
                      <div onClick={() => { handleJoinVoice(channel.id); switchChannel(channel.id); if(!isJoined) setIsSidebarOpen(false); }} className={(activeChannelId === channel.id) ? "px-2 py-1.5 rounded bg-[#3F4147] text-white flex items-center space-x-2 cursor-pointer transition group" : "px-2 py-1.5 rounded hover:bg-[#35373C] text-[#949ba4] flex items-center space-x-2 cursor-pointer transition group"}>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 100 4v2a2 2 0 01-2 2H4a2 2 0 01-2-2v-2a2 2 0 100-4V6z"></path></svg>
                        <span className="font-medium truncate text-[15px] flex-1">{channel.name}</span>
                        {channel.id && !channel.id.endsWith(':voice-gen') && (
                          <button onClick={(e) => { e.stopPropagation(); deleteChannel(channel.id); }} className="opacity-0 group-hover:opacity-100 text-xs text-gray-500 hover:text-red-400">×</button>
                        )}
                      </div>
                      {isJoined && (
                        <div className="ml-8 space-y-1 border-l border-[#3F4147] pl-2 mt-1">
                          {roomMembers.filter(m => m.isOnline && m.voiceChannelId === channel.id).map(m => (
                            <div key={m.username} className="text-xs py-1 flex items-center">
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold border-2 mr-2 overflow-hidden ${m.isSpeaking ? 'border-[#23a559]' : 'border-transparent'}`} style={{ backgroundColor: m.avatarColor || '#5865F2' }}>
                                {m.avatarUrl ? <img src={m.avatarUrl} className="w-full h-full object-cover" alt="" /> : m.username[0].toUpperCase()}
                              </div>
                              <span className={m.username === username ? "text-white font-bold" : "text-gray-300"}>{m.username}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <div onClick={() => setExpandedSections(p => ({...p, members: !p.members}))} className="px-2 mt-4 mb-1 flex items-center text-[11px] font-semibold text-[#949ba4] uppercase tracking-wider cursor-pointer hover:text-gray-200">
              <svg className={`w-3 h-3 mr-1 transition-transform ${expandedSections.members ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z" /></svg>
              Members — {connectedUsers.length + 1}
            </div>
            {expandedSections.members && (
              <div className="space-y-1 mt-1">
                {roomMembers.map((m, i) => (
                  <div key={i} className="px-2 py-1 flex items-center text-sm group relative">
                    <div className="relative shrink-0 mr-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs uppercase overflow-hidden ${m.isOnline ? '' : 'opacity-50 grayscale'}`} style={{ backgroundColor: m.avatarColor || '#5865F2' }}>
                        {m.avatarUrl ? <img src={m.avatarUrl} className="w-full h-full object-cover" alt="" /> : m.username[0].toUpperCase()}
                      </div>
                      {m.isOnline && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#2B2D31] rounded-full flex items-center justify-center border-2 border-[#2B2D31]"><div className="w-2 h-2 bg-[#23a559] rounded-full" /></div>}
                    </div>
                    <span className={m.isOnline ? 'text-gray-200' : 'text-gray-500'}>{m.username}</span>
                    {m.role === 'owner' && <span className="ml-1 text-yellow-500" title="Server Owner">👑</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </nav>

        {/* User Card */}
        <div className="bg-[#232428] p-2 flex flex-col shrink-0">
          {currentVoiceChannelId && (
            <div className="px-3 py-2 border-b border-[#1E1F22] flex items-center justify-between bg-[#2B2D31]/50 shadow-inner">
              <div className="flex flex-col min-w-0">
                <div className="flex items-center text-[#23a559] text-[11px] font-bold uppercase leading-none truncate">
                  <span className="w-2 h-2 bg-[#23a559] rounded-full mr-1.5 animate-pulse shrink-0" />
                  Voice Connected
                </div>
                <div className="text-[#949ba4] text-[11px] leading-tight mt-1 truncate max-w-[120px]">
                  {channels.find(c => c.id === currentVoiceChannelId)?.name || 'Voice'}
                </div>
              </div>
              <div className="flex items-center space-x-0.5 ml-2">
                <button onClick={toggleMute} className={`p-2 rounded hover:bg-[#3F4147] transition ${isMuted ? 'text-[#f23f43]' : 'text-[#dbdee1]'}`} title={isMuted ? "Unmute" : "Mute"}><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" /></svg></button>
                <button onClick={toggleDeafen} className={`p-2 rounded hover:bg-[#3F4147] transition ${isDeafened ? 'text-[#f23f43]' : 'text-[#dbdee1]'}`} title={isDeafened ? "Undeafen" : "Deafen"}><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 111.06 1.06L9.06 9l.94.94a.75.75 0 11-1.06 1.06L8 10.06l-.94.94a.75.75 0 01-1.06-1.06L6.94 9l-.94-.94a.75.75 0 011.06-1.06L8 7.94l.94-.94z" clipRule="evenodd" /></svg></button>
                <button onClick={handleLeaveVoice} className="p-2 rounded hover:bg-[#f23f43] text-[#f23f43] hover:text-white transition" title="Disconnect"><svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.209.369l-1.904 2.38a11.952 11.952 0 01-5.426-5.426l2.38-1.904a1 1 0 00.369-1.209L8.22 5.684A1 1 0 007.272 5H5a2 2 0 00-2 2v1" /></svg></button>
              </div>
            </div>
          )}
          <div className="h-[52px] px-2 flex items-center space-x-2 text-left">
            <div className="relative flex-shrink-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs uppercase overflow-hidden" style={{ backgroundColor: avatarColor }}>
                {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" alt="" /> : username[0].toUpperCase()}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#232428] rounded-full flex items-center justify-center border-2 border-[#232428]"><div className="w-2 h-2 bg-[#23a559] rounded-full" /></div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-bold truncate">{username}</div>
              <div className="text-[#949ba4] text-[10px]">Online</div>
            </div>
            <button onClick={() => setShowSettings(true)} className="p-1.5 hover:bg-[#3F4147] rounded-md text-[#949ba4] hover:text-white transition"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg></button>
          </div>
        </div>
      </aside>

      {/* 3. Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#313338]">
        <header className="h-12 border-b border-[#1E1F22] flex items-center justify-between px-4 shadow-sm shrink-0 font-bold text-white">
          <div className="flex items-center">
            <button onClick={() => setIsSidebarOpen(true)} className="md:hidden mr-3 text-gray-400 hover:text-white"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" /></svg></button>
            <span className="text-[#80848e] mr-2 text-xl leading-none">#</span>
            <span className="text-[15px]">{activeChannel?.name || 'general'}</span>
            {!isReady && <span className="ml-4 text-[10px] text-yellow-500 animate-pulse uppercase">Syncing...</span>}
          </div>
          <div className="flex items-center space-x-4 text-[#b5bac1]">
            <svg className="w-6 h-6 hover:text-[#dbdee1] cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden relative flex flex-col">
          {isVoiceView ? (
            <div className="flex-1 flex flex-col bg-[#1E1F22]">
              <div className="flex-1 p-4 md:p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 auto-rows-max overflow-y-auto custom-scrollbar">
                {roomMembers.filter(m => m.isOnline && m.voiceChannelId === activeChannelId).map(m => (
                  <div key={m.username} className="aspect-video bg-[#2B2D31] rounded-xl flex flex-col items-center justify-center relative border-2 transition-all" style={{ borderColor: m.isSpeaking ? '#23a559' : 'transparent' }}>
                    <div className="w-16 h-16 md:w-24 md:h-24 rounded-full flex items-center justify-center text-white text-2xl md:text-4xl font-bold overflow-hidden shadow-xl" style={{ backgroundColor: m.avatarColor || '#5865F2' }}>
                      {m.avatarUrl ? <img src={m.avatarUrl} className="w-full h-full object-cover" alt="" /> : m.username[0].toUpperCase()}
                    </div>
                    <div className="mt-4 font-bold text-white text-sm md:text-base">{m.username}</div>
                    {m.username === username && <div className="absolute bottom-3 left-3 bg-black/40 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">You</div>}
                    {m.username === username && isMuted && <div className="absolute top-3 right-3 bg-red-500 rounded-full p-1 shadow-lg"><svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" /></svg></div>}
                  </div>
                ))}
                {(!currentVoiceChannelId || currentVoiceChannelId !== activeChannelId) && (
                  <div className="col-span-full flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="w-20 h-20 bg-[#2B2D31] rounded-full flex items-center justify-center text-4xl mb-4 shadow-2xl animate-bounce">🎙️</div>
                    <h3 className="text-xl font-bold text-white">Voice Stage</h3>
                    <p className="text-[#949ba4] text-sm mt-2 max-w-xs">Join the conversation in #{activeChannel?.name}.</p>
                    <button onClick={() => handleJoinVoice(activeChannelId!)} className="mt-6 px-8 py-3 bg-[#23a559] hover:bg-[#1a8344] text-white font-bold rounded-md transition-colors shadow-lg active:scale-95 transform">Join Voice Channel</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {fileTransferError && (
                <div className="mx-4 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {fileTransferError}
                </div>
              )}
              {mediaError && (
                <div className="mx-4 mt-4 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
                  {mediaError}
                </div>
              )}
              <div className="flex-1 min-h-0 p-4 pb-0">
                <div
                  ref={scrollRef}
                  className="h-full overflow-y-auto custom-scrollbar rounded-lg border border-[#1E1F22] bg-[#2B2D31]/35 text-left shadow-inner"
                >
                  <div className="flex flex-col justify-end min-h-full">
                    <div className="py-12 px-4 mb-4 border-b border-[#3F4147]/20 text-center">
                      <div className="w-20 h-24 mx-auto flex items-center justify-center text-white text-4xl font-bold mb-4 shadow-2xl rounded-lg" style={{ backgroundColor: avatarColor }}>#</div>
                      <h1 className="text-2xl md:text-3xl font-bold text-white mb-1 leading-tight">Welcome to #{activeChannel?.name || 'general'}!</h1>
                      <p className="text-[#b5bac1] text-sm">This is the beginning of the server. Everything is end-to-end encrypted.</p>
                    </div>
                    {renderMessagesAndFiles()}
                  </div>
                </div>
              </div>

              <div className="px-4 shrink-0">
                {isUploading && (
                  <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold animate-pulse bg-indigo-500/5 py-2 px-3 rounded-t-lg border-x border-t border-[#1E1F22]">
                    <div className="w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="uppercase tracking-widest">Uploading file...</span>
                  </div>
                )}
              </div>
              <div className="p-4 bg-[#313338] shrink-0">
                <div className="bg-[#383A40] rounded-lg px-4 flex items-center shadow-inner">
                  <button onClick={() => fileInputRef.current?.click()} className="text-[#b5bac1] hover:text-[#dbdee1] p-2 mr-2 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg></button>
                  <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                  <form onSubmit={handleSend} className="flex-1">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={`Message #${activeChannel?.name || 'general'}`}
                      className="w-full bg-transparent border-none text-[#dbdee1] py-[11px] focus:outline-none placeholder-[#6d6f78] text-[15px]"
                      disabled={!isReady}
                    />
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {showSettings && <UserSettingsModal username={username} avatarColor={avatarColor} avatarUrl={avatarUrl} onSave={saveProfile} onClose={() => setShowSettings(false)} />}
      {isCreatingChannel && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 text-left font-sans">
          <div className="bg-[#313338] w-full max-w-md rounded-lg p-6 shadow-2xl border border-[#1E1F22]">
            <h2 className="text-2xl font-bold text-white mb-2 font-sans">Create {isCreatingChannel.type === 'text' ? 'Text' : 'Voice'} Channel</h2>
            <input type="text" value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} className="w-full bg-[#1E1F22] border-none rounded p-3 text-white focus:ring-2 focus:ring-indigo-500 mb-6 mt-4 font-sans text-base" placeholder="new-channel" autoFocus />
            <div className="flex justify-end space-x-4">
              <button onClick={() => setIsCreatingChannel(null)} className="text-white hover:underline text-sm font-medium">Cancel</button>
              <button onClick={handleCreateChannel} className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2 rounded font-bold transition-colors text-white text-sm shadow-lg">Create Channel</button>
            </div>
          </div>
        </div>
      )}
      {showServerInfo && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4 font-sans text-white text-left">
          <div className="bg-[#313338] w-full max-w-md rounded-lg p-6 shadow-2xl border border-[#1E1F22]">
            <h2 className="text-2xl font-bold text-white mb-4 font-sans">Server Settings</h2>
            <div className="space-y-4">
              <div><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Server Name</label><div className="bg-[#1E1F22] p-3 rounded mt-1 font-mono text-sm text-indigo-400 border border-white/5">{serverName}</div></div>
              <div><label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Secret Passphrase</label><div className="bg-[#1E1F22] p-3 rounded mt-1 font-mono text-sm text-green-400 break-all border border-white/5">{serverSecret}</div></div>
              <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded text-xs text-indigo-200 leading-relaxed italic">Share these credentials with trusted team members to join this encrypted space.</div>
            </div>
            <div className="mt-8 flex justify-end">
              <button onClick={() => setShowServerInfo(false)} className="bg-indigo-500 hover:bg-indigo-600 text-white px-8 py-2 rounded font-bold shadow-lg transition-transform active:scale-95">Close</button>
            </div>
          </div>
        </div>
      )}
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e1f22; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #1a1b1e; }
      `}</style>
    </div>
  );
}
