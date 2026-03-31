'use client';

import React, { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket';

interface AdminPanelProps {
  username: string;
  onClose: () => void;
}

interface RoomInfo {
  id: string;
  name?: string;
  visibility?: 'public' | 'private';
  members: { username: string; role: string }[];
}

interface UserInfo {
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  serverCount: number;
  servers: string[]; // List of room names/ids they joined
}

export default function AdminPanel({ username, onClose }: AdminPanelProps) {
  const [tab, setTab] = useState<'servers' | 'users'>('servers');
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const socket = getSocket();

  useEffect(() => {
    refreshData();
    socket.on('admin-rooms-list', (list: RoomInfo[]) => setRooms(list));
    socket.on('admin-users-list', (list: UserInfo[]) => setUsers(list));
    socket.on('admin-action-success', (data: any) => {
      alert(data.message);
      refreshData();
    });

    return () => {
      socket.off('admin-rooms-list');
      socket.off('admin-users-list');
      socket.off('admin-action-success');
    };
  }, [username, socket, tab]);

  const refreshData = () => {
    if (tab === 'servers') socket.emit('admin-get-rooms', { username });
    else socket.emit('admin-get-users', { username });
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const handleDeleteRoom = (roomId: string) => {
    if (confirm(`Delete server ${roomId.split(':')[0]}? All messages will be wiped.`)) {
      socket.emit('admin-delete-room', { username, roomId });
    }
  };

  const handleDeleteUser = (targetUsername: string) => {
    if (confirm(`Permanently delete user ${targetUsername}? This will remove them from all servers.`)) {
      socket.emit('admin-delete-user', { username, targetUsername });
    }
  };

  const handleUpdateSecret = (roomId: string) => {
    const newSecret = prompt('Enter new Secret Passphrase:');
    if (newSecret) {
      const name = roomId.split(':')[0];
      socket.emit('admin-update-room-id', { 
        username, oldRoomId: roomId, newRoomId: `${name}:${newSecret}` 
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#313338] font-sans">
      <div className="h-12 border-b border-[#1E1F22] flex items-center justify-between px-6 bg-[#2B2D31] shrink-0">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2 font-bold text-white uppercase text-xs tracking-wider">
            <span className="text-indigo-400 text-base">🛡️</span>
            <span>Admin Control</span>
          </div>
          <div className="flex space-x-1">
            <button 
              onClick={() => { setTab('servers'); setExpandedId(null); }}
              className={`px-3 py-1 rounded text-sm font-medium transition ${tab === 'servers' ? 'bg-[#3F4147] text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Servers
            </button>
            <button 
              onClick={() => { setTab('users'); setExpandedId(null); }}
              className={`px-3 py-1 rounded text-sm font-medium transition ${tab === 'users' ? 'bg-[#3F4147] text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              Members
            </button>
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white transition text-sm font-medium">Close Panel</button>
      </div>

      <div className="flex-1 overflow-y-auto p-10">
        <div className="max-w-5xl mx-auto">
          {tab === 'servers' ? (
            <div className="grid gap-4">
              <h2 className="text-xl font-bold text-white mb-4">Active Servers ({rooms.length})</h2>
              {rooms.map(room => (
                <div key={room.id} className="flex flex-col bg-[#2B2D31] rounded-lg border border-[#1E1F22] overflow-hidden">
                  <div className="p-5 flex items-center justify-between">
                    <div className="flex items-center space-x-4 cursor-pointer group" onClick={() => toggleExpand(room.id)}>
                      <svg className={`w-4 h-4 text-gray-500 transition-transform ${expandedId === room.id ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z" /></svg>
                      <div>
                        <div className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors">#{room.id.split(':')[0]}</div>
                        <div className="text-xs text-gray-400 font-medium">{room.members.length} members · {room.visibility || 'private'}</div>
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button onClick={() => handleUpdateSecret(room.id)} className="px-4 py-2 bg-[#4e5058] text-white rounded text-xs font-bold hover:bg-[#6d6f78] transition">Update Secret</button>
                      <button onClick={() => handleDeleteRoom(room.id)} className="px-4 py-2 bg-red-500/10 text-red-400 rounded text-xs font-bold hover:bg-red-500 hover:text-white transition">Delete</button>
                    </div>
                  </div>
                  
                  {expandedId === room.id && (
                    <div className="px-14 pb-5 pt-2 border-t border-[#1E1F22] bg-[#232428]/30">
                      <div className="text-[10px] font-bold text-gray-500 uppercase mb-3 tracking-widest">Members in this server</div>
                      <div className="grid grid-cols-2 gap-2">
                        {room.members.map(m => (
                          <div key={m.username} className="flex items-center space-x-2 py-1 px-3 bg-[#1E1F22] rounded text-sm">
                            <span className="text-gray-300 font-medium">{m.username}</span>
                            {m.role === 'owner' && <span className="text-[10px] text-yellow-500 font-bold uppercase tracking-tighter">Owner</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4">
              <h2 className="text-xl font-bold text-white mb-4">Registered Members ({users.length})</h2>
              {users.map(u => (
                <div key={u.username} className="flex flex-col bg-[#2B2D31] rounded-lg border border-[#1E1F22] overflow-hidden">
                  <div className="p-4 flex items-center justify-between">
                    <div className="flex items-center space-x-4 cursor-pointer group" onClick={() => toggleExpand(u.username)}>
                      <svg className={`w-4 h-4 text-gray-500 transition-transform ${expandedId === u.username ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20"><path d="M6 6L14 10L6 14V6Z" /></svg>
                      <div 
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold overflow-hidden"
                        style={{ backgroundColor: u.avatarColor || '#5865F2' }}
                      >
                        {u.avatarUrl ? <img src={u.avatarUrl} className="w-full h-full object-cover" /> : u.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-bold group-hover:text-indigo-400 transition-colors">{u.username}</div>
                        <div className="text-[10px] text-gray-400 font-medium uppercase">{u.serverCount} Servers Joined</div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteUser(u.username)}
                      disabled={u.username === username}
                      className="p-2 text-gray-500 hover:text-red-400 transition disabled:opacity-0"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>

                  {expandedId === u.username && (
                    <div className="px-14 pb-5 pt-2 border-t border-[#1E1F22] bg-[#232428]/30">
                      <div className="text-[10px] font-bold text-gray-500 uppercase mb-3 tracking-widest">Joined Servers</div>
                      <div className="space-y-2">
                        {u.servers && u.servers.length > 0 ? u.servers.map(sid => (
                          <div key={sid} className="text-sm font-medium text-indigo-300 bg-[#1E1F22] px-3 py-1.5 rounded">#{sid.split(':')[0]}</div>
                        )) : <div className="text-xs text-gray-600 italic">No servers joined yet.</div>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
