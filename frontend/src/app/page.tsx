'use client';

import { useEffect, useState } from 'react';
import AdminPanel from '../components/AdminPanel';
import ServerWorkspace from '../components/ServerWorkspace';
import UserSettingsModal from '../components/UserSettingsModal';
import { deriveKeyPair } from '../lib/crypto';
import { getSocket } from '../lib/socket';

type View = 'home' | 'admin' | 'server';
type HomeModal = 'create' | 'join-private' | null;
type ServerVisibility = 'public' | 'private';

interface ServerInfo {
  id: string;
  name: string;
  visibility: ServerVisibility;
  memberCount?: number;
  joined?: boolean;
}

const parseSavedServers = (value: string | null): ServerInfo[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = typeof entry.id === 'string' ? entry.id : '';
        const name = typeof entry.name === 'string' ? entry.name : id.split(':')[0] || id;
        if (!id || !name) return null;
        return {
          id,
          name,
          visibility: entry.visibility === 'public' ? 'public' : 'private',
          memberCount: typeof entry.memberCount === 'number' ? entry.memberCount : undefined,
          joined: true,
        };
      })
      .filter(Boolean) as ServerInfo[];
  } catch {
    return [];
  }
};

const parseRoomId = (roomId: string) => {
  const separatorIndex = roomId.indexOf(':');
  if (separatorIndex === -1) {
    return { name: roomId, passphrase: '' };
  }

  return {
    name: roomId.slice(0, separatorIndex),
    passphrase: roomId.slice(separatorIndex + 1),
  };
};

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [view, setView] = useState<View>('home');
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [joinedServers, setJoinedServers] = useState<ServerInfo[]>([]);
  const [publicServers, setPublicServers] = useState<ServerInfo[]>([]);
  const [homeModal, setHomeModal] = useState<HomeModal>(null);

  const [newServerName, setNewServerName] = useState('');
  const [newServerSecret, setNewServerSecret] = useState('');
  const [newServerVisibility, setNewServerVisibility] = useState<ServerVisibility>('public');

  const [isAdmin, setIsAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarColor, setAvatarColor] = useState('#5865F2');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [pendingInviteRoomId, setPendingInviteRoomId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('p2p_username');
    const savedColor = localStorage.getItem('p2p_avatar_color');
    const savedUrl = localStorage.getItem('p2p_avatar_url');
    const savedServers = parseSavedServers(localStorage.getItem('p2p_joined_servers'));

    if (savedUser) {
      setUsername(savedUser);
      const savedKeys = localStorage.getItem('p2p_chat_keys_' + savedUser);
      if (savedKeys) {
        const socket = getSocket();
        socket.connect();
        socket.emit('register-user', { username: savedUser, publicKey: JSON.parse(savedKeys).publicKey });
        socket.once('verified', (res: { isAdmin: boolean }) => {
          setIsAdmin(res.isAdmin);
          setIsAuthenticated(true);
        });
      }
    }

    setJoinedServers(savedServers);
    if (savedColor) setAvatarColor(savedColor);
    if (savedUrl) setAvatarUrl(savedUrl);

    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite');
    if (inviteCode) {
      try {
        const data = JSON.parse(atob(inviteCode));
        if (data.r) {
          setPendingInviteRoomId(String(data.r));
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !username) return;

    const socket = getSocket();
    socket.connect();

    const refreshRooms = () => {
      socket.emit('rooms-user-list-request', { username });
      socket.emit('rooms-public-list-request', { username });
    };

    const onUserRooms = (payload: { rooms: ServerInfo[] }) => {
      setJoinedServers(payload.rooms);
      localStorage.setItem('p2p_joined_servers', JSON.stringify(payload.rooms));
      setActiveServerId((current) => {
        if (!current) return current;
        return payload.rooms.some((room) => room.id === current) ? current : null;
      });
      setView((current) =>
        current === 'server' && activeServerId && !payload.rooms.some((room) => room.id === activeServerId) ? 'home' : current
      );
    };

    const onPublicRooms = (payload: { rooms: ServerInfo[] }) => {
      setPublicServers(payload.rooms);
    };

    const onRoomsChanged = () => {
      refreshRooms();
    };

    const onRoomDeleted = ({ roomId }: { roomId: string }) => {
      setJoinedServers((current) => {
        const next = current.filter((room) => room.id !== roomId);
        localStorage.setItem('p2p_joined_servers', JSON.stringify(next));
        return next;
      });
      setPublicServers((current) => current.filter((room) => room.id !== roomId));
      setActiveServerId((current) => (current === roomId ? null : current));
      setView((current) => (current === 'server' && activeServerId === roomId ? 'home' : current));
    };

    socket.on('rooms-user-list', onUserRooms);
    socket.on('rooms-public-list', onPublicRooms);
    socket.on('rooms-changed', onRoomsChanged);
    socket.on('room-deleted', onRoomDeleted);

    refreshRooms();

    return () => {
      socket.off('rooms-user-list', onUserRooms);
      socket.off('rooms-public-list', onPublicRooms);
      socket.off('rooms-changed', onRoomsChanged);
      socket.off('room-deleted', onRoomDeleted);
    };
  }, [isAuthenticated, username, activeServerId]);

  useEffect(() => {
    if (!isAuthenticated || !pendingInviteRoomId) return;

    const { name, passphrase } = parseRoomId(pendingInviteRoomId);
    if (passphrase) {
      setNewServerName(name);
      setNewServerSecret(passphrase);
      setNewServerVisibility('private');
      setHomeModal('join-private');
      setPendingInviteRoomId(null);
      return;
    }

    const socket = getSocket();
    socket.emit(
      'room-access',
      { username, name, visibility: 'public', createIfMissing: false },
      (response: { ok: boolean; room?: ServerInfo; message?: string }) => {
        if (!response.ok || !response.room) {
          setError(response.message || 'Public server not found');
          setPendingInviteRoomId(null);
          return;
        }
        setActiveServerId(response.room.id);
        setView('server');
        setPendingInviteRoomId(null);
      }
    );
  }, [isAuthenticated, pendingInviteRoomId, username]);

  const resetServerForm = () => {
    setNewServerName('');
    setNewServerSecret('');
    setNewServerVisibility('public');
    setHomeModal(null);
  };

  const accessRoom = ({
    name,
    passphrase = '',
    visibility,
    createIfMissing,
  }: {
    name: string;
    passphrase?: string;
    visibility: ServerVisibility;
    createIfMissing: boolean;
  }) =>
    new Promise<ServerInfo>((resolve, reject) => {
      const socket = getSocket();
      socket.emit(
        'room-access',
        {
          username,
          name,
          passphrase,
          visibility,
          createIfMissing,
        },
        (response: { ok: boolean; room?: ServerInfo; message?: string }) => {
          if (!response.ok || !response.room) {
            reject(new Error(response.message || 'Unable to access server'));
            return;
          }
          resolve(response.room);
        }
      );
    });

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError('Username and Password are required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const kp = deriveKeyPair(username, password);
      const socket = getSocket();
      socket.connect();

      const res: { isAdmin: boolean; hasProfile: boolean; avatarColor?: string | null; avatarUrl?: string | null } = await new Promise(
        (resolve, reject) => {
          socket.once('verified', (data) => resolve(data));
          socket.once('error', (err: { message: string }) => reject(new Error(err.message)));
          socket.emit('register-user', { username, publicKey: kp.publicKey });
        }
      );

      localStorage.setItem('p2p_username', username);
      setIsAdmin(res.isAdmin);

      if (!res.hasProfile) {
        setNeedsProfile(true);
      } else {
        setAvatarColor(res.avatarColor || '#5865F2');
        setAvatarUrl(res.avatarUrl || null);
        localStorage.setItem('p2p_avatar_color', res.avatarColor || '#5865F2');
        if (res.avatarUrl) localStorage.setItem('p2p_avatar_url', res.avatarUrl);
        setIsAuthenticated(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to log in');
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = (color: string, url: string | null) => {
    const socket = getSocket();
    const savedKeys = localStorage.getItem('p2p_chat_keys_' + username);
    socket.emit('register-user', {
      username,
      publicKey: savedKeys ? JSON.parse(savedKeys).publicKey : '',
      avatarColor: color,
      avatarUrl: url,
    });
    setAvatarColor(color);
    setAvatarUrl(url);
    localStorage.setItem('p2p_avatar_color', color);
    if (url) localStorage.setItem('p2p_avatar_url', url);
    else localStorage.removeItem('p2p_avatar_url');
    setNeedsProfile(false);
    setIsAuthenticated(true);
    setShowSettings(false);
  };

  const handleCreateServer = async () => {
    try {
      const room = await accessRoom({
        name: newServerName,
        passphrase: newServerSecret,
        visibility: newServerVisibility,
        createIfMissing: true,
      });
      resetServerForm();
      setActiveServerId(room.id);
      setView('server');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to create server');
    }
  };

  const handleJoinPrivateServer = async () => {
    try {
      const room = await accessRoom({
        name: newServerName,
        passphrase: newServerSecret,
        visibility: 'private',
        createIfMissing: true,
      });
      resetServerForm();
      setActiveServerId(room.id);
      setView('server');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to join private server');
    }
  };

  const handleJoinPublicServer = async (server: ServerInfo) => {
    try {
      const room = await accessRoom({
        name: server.name,
        visibility: 'public',
        createIfMissing: false,
      });
      setActiveServerId(room.id);
      setView('server');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to join public server');
    }
  };

  const logout = () => {
    setIsAuthenticated(false);
    setActiveServerId(null);
    setView('home');
  };

  const clearData = () => {
    if (confirm('DANGER: This will delete ALL servers, keys, and history from this device. Continue?')) {
      localStorage.clear();
      window.location.reload();
    }
  };

  if (!isAuthenticated && !needsProfile) {
    return (
      <div className="min-h-screen bg-[#313338] flex items-center justify-center p-4 font-sans text-white">
        <div className="bg-[#2B2D31] p-8 rounded-lg shadow-2xl w-full max-w-md border border-[#1E1F22]">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2 font-sans">Omni</h1>
            <p className="text-gray-400 text-sm">Secure, private P2P workspace.</p>
          </div>
          {error && <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 text-red-200 text-xs rounded">{error}</div>}
          <div className="space-y-4">
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full bg-[#1E1F22] border-none rounded-md px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 transition-all" placeholder="Username" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-[#1E1F22] border-none rounded-md px-4 py-3 text-white focus:ring-2 focus:ring-indigo-500 transition-all" placeholder="Password" />
            <button onClick={handleLogin} disabled={loading} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 rounded-md transition-all disabled:opacity-50 shadow-lg">
              {loading ? 'Verifying...' : 'Log In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (needsProfile) {
    return (
      <div className="min-h-screen bg-[#313338] flex items-center justify-center p-4 font-sans text-white">
        <div className="bg-[#2B2D31] p-8 rounded-lg shadow-2xl w-full max-w-md border border-[#1E1F22]">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-white mb-2">Setup Your Profile</h1>
            <p className="text-gray-400 text-sm">This is how your team will see you.</p>
          </div>
          <div className="space-y-8 flex flex-col items-center">
            <div className="w-24 h-24 rounded-full flex items-center justify-center text-4xl font-bold border-4 border-[#1E1F22] overflow-hidden" style={{ backgroundColor: avatarColor }}>
              {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" alt="" /> : username[0]?.toUpperCase()}
            </div>
            <button onClick={() => saveProfile(avatarColor, avatarUrl)} className="w-full bg-[#23a559] hover:bg-[#1a8344] text-white font-bold py-3 rounded-md shadow-lg">Enter Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#313338] text-gray-200 font-sans overflow-hidden">
      <div className="w-[72px] bg-[#1E1F22] flex flex-col items-center py-3 space-y-2 shrink-0 border-r border-[#1E1F22]">
        <div
          onClick={() => {
            setView('home');
            setActiveServerId(null);
          }}
          className={`w-12 h-12 rounded-3xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl hover:bg-indigo-500 hover:text-white ${view === 'home' ? 'bg-indigo-500 text-white rounded-xl shadow-lg' : 'bg-[#313338] text-gray-300'}`}
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        </div>

        {isAdmin && (
          <div
            onClick={() => {
              setView('admin');
              setActiveServerId(null);
            }}
            className={`w-12 h-12 rounded-3xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl hover:bg-yellow-600 hover:text-white ${view === 'admin' ? 'bg-yellow-600 text-white rounded-xl shadow-lg' : 'bg-[#313338] text-gray-300'}`}
            title="Admin Dashboard"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          </div>
        )}

        <div className="w-8 h-[2px] bg-[#35363C] rounded-full mx-auto" />

        {joinedServers.map((server) => (
          <div
            key={server.id}
            onClick={() => {
              setActiveServerId(server.id);
              setView('server');
            }}
            className={`w-12 h-12 rounded-3xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl hover:bg-indigo-500 hover:text-white font-bold ${activeServerId === server.id && view === 'server' ? 'bg-indigo-500 text-white rounded-xl shadow-lg' : 'bg-[#313338] text-gray-300'}`}
            title={`${server.name} (${server.visibility})`}
          >
            {server.name.substring(0, 2).toUpperCase()}
          </div>
        ))}

        <div
          onClick={() => {
            setHomeModal('create');
            setView('home');
            setActiveServerId(null);
          }}
          className="w-12 h-12 bg-[#313338] rounded-3xl flex items-center justify-center text-[#23a559] cursor-pointer hover:rounded-xl hover:bg-[#23a559] hover:text-white transition-all"
          title="Create Server"
        >
          <span className="text-2xl font-light">+</span>
        </div>

        <div className="mt-auto flex flex-col items-center space-y-2">
          <div className="w-8 h-[2px] bg-[#35363C] rounded-full mx-auto" />
          <div
            onClick={logout}
            className="w-12 h-12 bg-[#313338] rounded-3xl flex items-center justify-center text-red-500 cursor-pointer hover:rounded-xl hover:bg-red-500 hover:text-white transition-all group relative"
            title="Log Out"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {view === 'server' && activeServerId ? (
          <ServerWorkspace
            key={activeServerId}
            roomId={activeServerId}
            username={username}
            joinedServers={joinedServers}
            onSwitchServer={(id) => {
              setActiveServerId(id);
              setView('server');
            }}
            onLeaveHome={() => {
              setView('home');
              setActiveServerId(null);
            }}
          />
        ) : view === 'admin' ? (
          <AdminPanel username={username} onClose={() => setView('home')} />
        ) : (
          <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.16),_transparent_42%),linear-gradient(180deg,_#313338_0%,_#2b2d31_100%)] p-6 md:p-10">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
              {error && <div className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

              <section className="rounded-[32px] border border-white/5 bg-[#2B2D31]/95 p-8 shadow-2xl">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="text-[11px] uppercase tracking-[0.26em] text-[#949ba4]">Workspace Home</div>
                    <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Welcome back, {username}.</h1>
                    <p className="mt-4 text-base leading-7 text-[#b5bac1]">
                      Public servers are open to everyone in the workspace. Private servers still use the current name plus passphrase flow and stay off the public home feed.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => {
                        setNewServerVisibility('public');
                        setHomeModal('create');
                      }}
                      className="rounded-full bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-600"
                    >
                      Create Server
                    </button>
                    <button
                      onClick={() => {
                        setNewServerVisibility('private');
                        setHomeModal('join-private');
                      }}
                      className="rounded-full border border-[#3F4147] bg-[#232428] px-5 py-2.5 text-sm font-semibold text-[#dbdee1] transition hover:bg-[#313338]"
                    >
                      Join Private Server
                    </button>
                    <button onClick={() => setShowSettings(true)} className="rounded-full border border-[#3F4147] bg-[#232428] px-5 py-2.5 text-sm font-semibold text-[#dbdee1] transition hover:bg-[#313338]">
                      User Settings
                    </button>
                  </div>
                </div>

                <div className="mt-8 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-[#232428] p-5">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Joined</div>
                    <div className="mt-2 text-3xl font-semibold text-white">{joinedServers.length}</div>
                    <div className="mt-2 text-sm text-[#b5bac1]">Servers in your sidebar.</div>
                  </div>
                  <div className="rounded-2xl bg-[#232428] p-5">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Public</div>
                    <div className="mt-2 text-3xl font-semibold text-white">{publicServers.length}</div>
                    <div className="mt-2 text-sm text-[#b5bac1]">Open servers anyone can join.</div>
                  </div>
                  <div className="rounded-2xl bg-[#232428] p-5">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Private</div>
                    <div className="mt-2 text-3xl font-semibold text-white">{joinedServers.filter((server) => server.visibility === 'private').length}</div>
                    <div className="mt-2 text-sm text-[#b5bac1]">Passphrase-protected spaces.</div>
                  </div>
                </div>
              </section>

              <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-[28px] border border-white/5 bg-[#2B2D31] p-6 shadow-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Public Servers</div>
                      <h2 className="mt-2 text-2xl font-semibold text-white">Joinable for everyone</h2>
                    </div>
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {publicServers.map((server) => {
                      const isJoined = joinedServers.some((joined) => joined.id === server.id);
                      return (
                        <div key={server.id} className="rounded-2xl border border-[#3F4147] bg-[#232428] p-5">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-lg font-semibold text-white">{server.name}</div>
                              <div className="mt-1 text-xs uppercase tracking-[0.2em] text-emerald-300">Public Server</div>
                            </div>
                            <div className="rounded-full bg-[#1E1F22] px-2.5 py-1 text-[11px] text-[#b5bac1]">{server.memberCount || 0} members</div>
                          </div>
                          <button
                            onClick={() => handleJoinPublicServer(server)}
                            className="mt-5 w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600"
                          >
                            {isJoined ? 'Open Server' : 'Join Server'}
                          </button>
                        </div>
                      );
                    })}

                    {!publicServers.length && (
                      <div className="md:col-span-2 rounded-2xl border border-dashed border-[#3F4147] bg-[#232428]/60 p-6 text-sm text-[#b5bac1]">
                        No public servers yet. Create one from the home screen to make it available to everyone after login.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/5 bg-[#2B2D31] p-6 shadow-xl">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Your Sidebar</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Active servers only</h2>
                  <div className="mt-6 space-y-3">
                    {joinedServers.map((server) => (
                      <button
                        key={server.id}
                        onClick={() => {
                          setActiveServerId(server.id);
                          setView('server');
                        }}
                        className="flex w-full items-center justify-between rounded-2xl border border-[#3F4147] bg-[#232428] px-4 py-3 text-left transition hover:bg-[#313338]"
                      >
                        <div>
                          <div className="font-semibold text-white">{server.name}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-[#949ba4]">{server.visibility}</div>
                        </div>
                        <div className="text-sm text-[#b5bac1]">{server.memberCount || 0} members</div>
                      </button>
                    ))}
                    {!joinedServers.length && (
                      <div className="rounded-2xl border border-dashed border-[#3F4147] bg-[#232428]/60 p-5 text-sm text-[#b5bac1]">
                        You have not joined any active servers yet.
                      </div>
                    )}
                  </div>

                  <button onClick={clearData} className="mt-6 text-xs text-red-400 hover:underline transition">
                    Reset This Device (Destructive)
                  </button>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      {homeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-[28px] border border-[#1E1F22] bg-[#313338] p-6 shadow-2xl">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">
              {homeModal === 'create' ? 'Create Server' : 'Join Private Server'}
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              {homeModal === 'create' ? 'Create a public or private server' : 'Join or create a private server'}
            </h2>

            <div className="mt-5 space-y-4">
              {homeModal === 'create' && (
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setNewServerVisibility('public')}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${newServerVisibility === 'public' ? 'border-emerald-400 bg-emerald-500/10 text-white' : 'border-[#3F4147] bg-[#1E1F22] text-[#b5bac1]'}`}
                  >
                    <div className="font-semibold">Public</div>
                    <div className="mt-1 text-xs">Visible on the home screen and joinable by anyone.</div>
                  </button>
                  <button
                    onClick={() => setNewServerVisibility('private')}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${newServerVisibility === 'private' ? 'border-indigo-400 bg-indigo-500/10 text-white' : 'border-[#3F4147] bg-[#1E1F22] text-[#b5bac1]'}`}
                  >
                    <div className="font-semibold">Private</div>
                    <div className="mt-1 text-xs">Hidden from home and protected with a passphrase.</div>
                  </button>
                </div>
              )}

              <input
                value={newServerName}
                onChange={(event) => setNewServerName(event.target.value)}
                placeholder="Server name"
                className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
              />

              {(homeModal === 'join-private' || newServerVisibility === 'private') && (
                <input
                  type="password"
                  value={newServerSecret}
                  onChange={(event) => setNewServerSecret(event.target.value)}
                  placeholder="Secret passphrase"
                  className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                />
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={resetServerForm}
                className="rounded-full px-4 py-2 text-sm font-medium text-[#b5bac1] transition hover:bg-[#3F4147] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={homeModal === 'join-private' ? handleJoinPrivateServer : handleCreateServer}
                className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
              >
                {homeModal === 'join-private' ? 'Join Private Server' : 'Create Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <UserSettingsModal
          username={username}
          avatarColor={avatarColor}
          avatarUrl={avatarUrl}
          onSave={saveProfile}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
