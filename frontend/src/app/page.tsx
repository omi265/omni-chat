'use client';

import { useState, useEffect } from 'react';
import AdminPanel from '../components/AdminPanel';
import ServerWorkspace from '../components/ServerWorkspace';
import UserSettingsModal from '../components/UserSettingsModal';
import { deriveKeyPair } from '../lib/crypto';
import { getSocket } from '../lib/socket';

interface ServerInfo {
  id: string;
  name: string;
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const [view, setView] = useState<'home' | 'admin' | 'server'>('home');
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [joinedServers, setJoinedServers] = useState<ServerInfo[]>([]);
  
  const [isAddingServer, setIsAddingServer] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [newServerSecret, setNewServerSecret] = useState('');
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarColor, setAvatarColor] = useState('#5865F2');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('p2p_username');
    const savedServers = localStorage.getItem('p2p_joined_servers');
    const savedColor = localStorage.getItem('p2p_avatar_color');
    const savedUrl = localStorage.getItem('p2p_avatar_url');

    if (savedUser) {
      setUsername(savedUser);
      // Auto-authenticate if keys exist
      const savedKeys = localStorage.getItem('p2p_chat_keys_' + savedUser);
      if (savedKeys) {
        setIsAuthenticated(true);
        // We still need to check if user is admin, so we connect and register
        const socket = getSocket();
        socket.connect();
        socket.emit('register-user', { username: savedUser, publicKey: JSON.parse(savedKeys).publicKey });
        socket.once('verified', (res: any) => setIsAdmin(res.isAdmin));
      }
    }
    
    if (savedServers) setJoinedServers(JSON.parse(savedServers));
    if (savedColor) setAvatarColor(savedColor);
    if (savedUrl) setAvatarUrl(savedUrl);

    // Handle Invite Codes
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('invite');
    if (inviteCode) {
      try {
        const data = JSON.parse(atob(inviteCode));
        if (data.r) {
          const parts = data.r.split(':');
          setNewServerName(parts[0]);
          if (parts[1]) setNewServerSecret(parts[1]);
          setIsAddingServer(true);
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (e) {}
    }
  }, []);

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
      
      const res: any = await new Promise((resolve, reject) => {
        socket.once('verified', (data: any) => resolve(data));
        socket.once('error', (err: any) => reject(new Error(err.message)));
        socket.emit('register-user', { username, publicKey: kp.publicKey });
      });

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
    } catch (e: any) {
      setError(e.message);
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
      avatarUrl: url 
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

  const handleAddServer = () => {
    if (newServerName.trim() && newServerSecret.trim()) {
      const fullId = `${newServerName.trim()}:${newServerSecret.trim()}`;
      const updated = [...joinedServers.filter(s => s.id !== fullId), { id: fullId, name: newServerName.trim() }];
      setJoinedServers(updated);
      localStorage.setItem('p2p_joined_servers', JSON.stringify(updated));
      setActiveServerId(fullId);
      setView('server');
      setIsAddingServer(false);
      setNewServerName('');
      setNewServerSecret('');
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
              {avatarUrl ? <img src={avatarUrl} className="w-full h-full object-cover" /> : username[0]?.toUpperCase()}
            </div>
            <button onClick={() => saveProfile(avatarColor, avatarUrl)} className="w-full bg-[#23a559] hover:bg-[#1a8344] text-white font-bold py-3 rounded-md shadow-lg">Enter Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#313338] text-gray-200 font-sans overflow-hidden">
      {/* GLOBAL SERVER RAIL - The only one! */}
      <div className="w-[72px] bg-[#1E1F22] flex flex-col items-center py-3 space-y-2 shrink-0 border-r border-[#1E1F22]">
        <div 
          onClick={() => { setView('home'); setActiveServerId(null); }}
          className={`w-12 h-12 rounded-3xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl hover:bg-indigo-500 hover:text-white ${view === 'home' ? 'bg-indigo-500 text-white rounded-xl shadow-lg' : 'bg-[#313338] text-gray-300'}`}
        >
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
        </div>
        
        {isAdmin && (
          <div 
            onClick={() => { setView('admin'); setActiveServerId(null); }}
            className={`w-12 h-12 rounded-3xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl hover:bg-yellow-600 hover:text-white ${view === 'admin' ? 'bg-yellow-600 text-white rounded-xl shadow-lg' : 'bg-[#313338] text-gray-300'}`}
            title="Admin Dashboard"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
          </div>
        )}

        <div className="w-8 h-[2px] bg-[#35363C] rounded-full mx-auto" />
        
        {joinedServers.map(server => (
          <div 
            key={server.id} 
            onClick={() => { setActiveServerId(server.id); setView('server'); }}
            className={`w-12 h-12 rounded-3xl flex items-center justify-center cursor-pointer transition-all hover:rounded-xl hover:bg-indigo-500 hover:text-white font-bold ${activeServerId === server.id && view === 'server' ? 'bg-indigo-500 text-white rounded-xl shadow-lg' : 'bg-[#313338] text-gray-300'}`}
          >
            {server.name.substring(0, 2).toUpperCase()}
          </div>
        ))}
        
        <div onClick={() => { setIsAddingServer(true); setView('home'); setActiveServerId(null); }} className="w-12 h-12 bg-[#313338] rounded-3xl flex items-center justify-center text-[#23a559] cursor-pointer hover:rounded-xl hover:bg-[#23a559] hover:text-white transition-all">
          <span className="text-2xl font-light">+</span>
        </div>

        {/* PERMANENT LOGOUT BUTTON */}
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {view === 'server' && activeServerId ? (
          <ServerWorkspace
            key={activeServerId}
            roomId={activeServerId} 
            username={username} 
            joinedServers={joinedServers}
            onSwitchServer={(id) => { setActiveServerId(id); setView('server'); }}
            onLeaveHome={() => { setView('home'); setActiveServerId(null); }} 
          />
        ) : view === 'admin' ? (
          <AdminPanel username={username} onClose={() => setView('home')} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#313338]">
            {isAddingServer ? (
              <div className="bg-[#2B2D31] p-8 rounded-lg shadow-xl w-full max-w-sm border border-[#1E1F22]">
                <h2 className="text-2xl font-bold text-white mb-4">Join a Server</h2>
                <div className="space-y-4 text-left">
                  <input type="text" value={newServerName} onChange={(e) => setNewServerName(e.target.value)} className="w-full bg-[#1E1F22] border-none rounded-md px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500" placeholder="Server Name" autoFocus />
                  <input type="password" value={newServerSecret} onChange={(e) => setNewServerSecret(e.target.value)} className="w-full bg-[#1E1F22] border-none rounded-md px-4 py-2 text-white focus:ring-2 focus:ring-indigo-500" placeholder="Secret Passphrase" />
                  <div className="flex space-x-2">
                    <button onClick={() => setIsAddingServer(false)} className="flex-1 text-gray-400 hover:underline">Cancel</button>
                    <button onClick={handleAddServer} className="flex-1 bg-indigo-500 hover:bg-indigo-600 py-2 rounded font-bold">Join</button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="max-w-md">
                <div className="w-24 h-24 bg-[#41434A] rounded-full flex items-center justify-center mx-auto mb-6 shadow-xl text-indigo-400">
                  <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 20 20"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"></path></svg>
                </div>
                <h1 className="text-3xl font-bold text-white mb-2">Welcome to Omni, {username}!</h1>
                <p className="text-[#b5bac1] mb-8 leading-relaxed">Select a server to start chatting securely.</p>
                <div className="flex flex-col space-y-2">
                  <button onClick={() => setShowSettings(true)} className="bg-[#4e5058] hover:bg-[#6d6f78] text-white py-2 rounded font-bold transition">User Settings</button>
                  <button onClick={clearData} className="text-red-400 text-xs py-2 hover:underline transition">Reset This Device (Destructive)</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

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
