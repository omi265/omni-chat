const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: (origin, callback) => callback(null, true), methods: ['GET', 'POST'], credentials: true }
});

const PORT = process.env.PORT || 2650;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const SUPER_ADMIN = process.env.SUPER_ADMIN_USERNAME || 'admin';

const db = new Database(path.join(DATA_DIR, 'p2p.db'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use(express.static(path.join(__dirname, 'public')));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, publicKey TEXT NOT NULL, avatarColor TEXT, avatarUrl TEXT);
  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT, 
    username TEXT, 
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (room_id, username),
    FOREIGN KEY(username) REFERENCES users(username)
  );
  CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'text');
  CREATE TABLE IF NOT EXISTS offline_messages (id TEXT PRIMARY KEY, recipient_username TEXT NOT NULL, sender_username TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, ephemeral_pub_key TEXT NOT NULL, timestamp INTEGER NOT NULL, FOREIGN KEY(recipient_username) REFERENCES users(username));
  CREATE TABLE IF NOT EXISTS room_messages (id TEXT PRIMARY KEY, room_id TEXT NOT NULL, channel_id TEXT NOT NULL, sender TEXT NOT NULL, ciphertext TEXT NOT NULL, nonce TEXT NOT NULL, timestamp INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS room_files (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    name TEXT NOT NULL, -- Encrypted filename
    type TEXT NOT NULL, -- Encrypted mime-type
    size INTEGER NOT NULL,
    data BLOB NOT NULL, -- Encrypted file data
    nonce TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
`);

// Migration: Safely add columns for existing DBs
try {
  const roomMessagesInfo = db.prepare("PRAGMA table_info(room_messages)").all();
  if (!roomMessagesInfo.some(col => col.name === 'channel_id')) {
    db.prepare("ALTER TABLE room_messages ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'general'").run();
  }
  const roomMembersInfo = db.prepare("PRAGMA table_info(room_members)").all();
  if (!roomMembersInfo.some(col => col.name === 'role')) {
    db.prepare("ALTER TABLE room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'").run();
  }
  const usersInfo = db.prepare("PRAGMA table_info(users)").all();
  if (!usersInfo.some(col => col.name === 'avatarColor')) db.prepare("ALTER TABLE users ADD COLUMN avatarColor TEXT").run();
  if (!usersInfo.some(col => col.name === 'avatarUrl')) db.prepare("ALTER TABLE users ADD COLUMN avatarUrl TEXT").run();
} catch (e) { console.error('Migration error', e); }

const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('register-user', ({ username, publicKey, avatarColor, avatarUrl }) => {
    const user = db.prepare('SELECT publicKey, avatarColor, avatarUrl FROM users WHERE username = ?').get(username);
    if (user && user.publicKey !== publicKey) return socket.emit('error', { message: 'Incorrect password' });
    if (!user) db.prepare('INSERT INTO users (username, publicKey, avatarColor, avatarUrl) VALUES (?, ?, ?, ?)').run(username, publicKey, avatarColor || null, avatarUrl || null);
    else if (avatarColor || avatarUrl) db.prepare('UPDATE users SET avatarColor = COALESCE(?, avatarColor), avatarUrl = COALESCE(?, avatarUrl) WHERE username = ?').run(avatarColor || null, avatarUrl || null, username);
    
    const finalUser = db.prepare('SELECT avatarColor, avatarUrl FROM users WHERE username = ?').get(username);
    socket.emit('verified', { hasProfile: !!(finalUser.avatarColor || finalUser.avatarUrl), avatarColor: finalUser.avatarColor, avatarUrl: finalUser.avatarUrl, isAdmin: username === SUPER_ADMIN });
  });

  socket.on('admin-get-rooms', ({ username }) => {
    if (username !== SUPER_ADMIN) return;
    const rooms = db.prepare('SELECT DISTINCT room_id FROM room_members').all();
    socket.emit('admin-rooms-list', rooms.map(r => ({ id: r.room_id, members: db.prepare('SELECT username, role FROM room_members WHERE room_id = ?').all(r.room_id) })));
  });

  socket.on('admin-get-users', ({ username }) => {
    if (username !== SUPER_ADMIN) return;
    const users = db.prepare('SELECT username, avatarColor, avatarUrl FROM users').all();
    const usersWithStats = users.map(u => {
      const joinedRooms = db.prepare('SELECT room_id FROM room_members WHERE username = ?').all(u.username);
      return { ...u, serverCount: joinedRooms.length, servers: joinedRooms.map(r => r.room_id) };
    });
    socket.emit('admin-users-list', usersWithStats);
  });

  socket.on('admin-delete-user', ({ username, targetUsername }) => {
    if (username !== SUPER_ADMIN || targetUsername === SUPER_ADMIN) return;
    db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
    db.prepare('DELETE FROM room_members WHERE username = ?').run(targetUsername);
    db.prepare('DELETE FROM offline_messages WHERE recipient_username = ? OR sender_username = ?').run(targetUsername, targetUsername);
    socket.emit('admin-action-success', { message: `User ${targetUsername} deleted.` });
  });

  socket.on('admin-delete-room', ({ username, roomId }) => {
    if (username !== SUPER_ADMIN) return;
    db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_messages WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_files WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM channels WHERE room_id = ?').run(roomId);
    const rooms = db.prepare('SELECT DISTINCT room_id FROM room_members').all();
    socket.emit('admin-rooms-list', rooms.map(r => ({ id: r.room_id, members: db.prepare('SELECT username, role FROM room_members WHERE room_id = ?').all(r.room_id) })));
  });

  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    onlineUsers.set(socket.id, { username, roomId, voiceChannelId: null });

    const memberCount = db.prepare('SELECT count(*) as count FROM room_members WHERE room_id = ?').get(roomId).count;
    const role = memberCount === 0 ? 'owner' : 'member';
    db.prepare('INSERT OR IGNORE INTO room_members (room_id, username, role) VALUES (?, ?, ?)').run(roomId, username, role);

    const userRow = db.prepare('SELECT publicKey, avatarColor, avatarUrl FROM users WHERE username = ?').get(username);
    socket.to(roomId).emit('user-joined', { socketId: socket.id, username, publicKey: userRow?.publicKey, avatarColor: userRow?.avatarColor, avatarUrl: userRow?.avatarUrl, role, voiceChannelId: null });

    const allMembers = db.prepare('SELECT u.username, u.publicKey, u.avatarColor, u.avatarUrl, rm.role FROM users u JOIN room_members rm ON u.username = rm.username WHERE rm.room_id = ?').all(roomId);
    socket.emit('room-members-list', allMembers.map(m => {
      const online = Array.from(onlineUsers.values()).find(u => u.username === m.username && u.roomId === roomId);
      return { ...m, isOnline: !!online, voiceChannelId: online ? online.voiceChannelId : null };
    }));

    let channels = db.prepare('SELECT * FROM channels WHERE room_id = ?').all(roomId);
    if (channels.length === 0) {
      db.prepare('INSERT OR IGNORE INTO channels (id, room_id, name, type) VALUES (?, ?, ?, ?)').run(roomId + ':general', roomId, 'general', 'text');
      db.prepare('INSERT OR IGNORE INTO channels (id, room_id, name, type) VALUES (?, ?, ?, ?)').run(roomId + ':voice-gen', roomId, 'General Voice', 'voice');
      channels = db.prepare('SELECT * FROM channels WHERE room_id = ?').all(roomId);
    }
    socket.emit('channel-list', channels);

    const history = db.prepare('SELECT * FROM room_messages WHERE room_id = ? ORDER BY timestamp ASC LIMIT 500').all(roomId);
    socket.emit('room-history-bulk', history.map(m => ({ id: m.id, sender: m.sender, timestamp: m.timestamp, channelId: m.channel_id, payload: { ciphertext: m.ciphertext, nonce: m.nonce } })));

    const files = db.prepare('SELECT id, channel_id, sender, name, type, size, nonce, timestamp FROM room_files WHERE room_id = ? ORDER BY timestamp ASC LIMIT 100').all(roomId);
    socket.emit('room-files-bulk', files);
  });

  socket.on('join-voice', ({ roomId, channelId }) => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      user.voiceChannelId = channelId;
      io.to(roomId).emit('voice-state-update', { username: user.username, channelId });
    }
  });

  socket.on('leave-voice', ({ roomId }) => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      user.voiceChannelId = null;
      io.to(roomId).emit('voice-state-update', { username: user.username, channelId: null });
    }
  });

  socket.on('get-channel-history', ({ roomId, channelId }) => {
    const history = db.prepare('SELECT * FROM room_messages WHERE room_id = ? AND channel_id = ? ORDER BY timestamp ASC LIMIT 100').all(roomId, channelId);
    socket.emit('room-history', { channelId, messages: history.map(m => ({ id: m.id, sender: m.sender, timestamp: m.timestamp, payload: { ciphertext: m.ciphertext, nonce: m.nonce } })) });
  });

  socket.on('create-channel', ({ roomId, name, type }) => {
    const id = roomId + ':' + Math.random().toString(36).substring(7);
    db.prepare('INSERT INTO channels (id, room_id, name, type) VALUES (?, ?, ?, ?)').run(id, roomId, name, type);
    io.to(roomId).emit('channel-list', db.prepare('SELECT * FROM channels WHERE room_id = ?').all(roomId));
  });

  socket.on('delete-channel', ({ roomId, channelId }) => {
    if (channelId.endsWith(':general')) return;
    db.prepare('DELETE FROM channels WHERE id = ?').run(channelId);
    db.prepare('DELETE FROM room_messages WHERE channel_id = ?').run(channelId);
    db.prepare('DELETE FROM room_files WHERE channel_id = ?').run(channelId);
    io.to(roomId).emit('channel-list', db.prepare('SELECT * FROM channels WHERE room_id = ?').all(roomId));
  });

  socket.on('send-room-message', ({ roomId, channelId, message }) => {
    db.prepare('INSERT INTO room_messages (id, room_id, channel_id, sender, ciphertext, nonce, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)').run(message.id, roomId, channelId, message.sender, message.payload.ciphertext, message.payload.nonce, message.timestamp);
    io.to(roomId).emit('room-message', { ...message, channelId });
  });

  socket.on('send-room-file', ({ roomId, channelId, file }) => {
    const { id, sender, name, type, size, data, nonce, timestamp } = file;
    try {
      db.prepare(`
        INSERT INTO room_files (id, room_id, channel_id, sender, name, type, size, data, nonce, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, roomId, channelId, sender, name, type, size, data, nonce, timestamp);
      
      io.to(roomId).emit('room-file', { ...file, channelId });
    } catch (err) {
      console.error('Failed to store/broadcast room file', err);
    }
  });

  socket.on('get-room-file', ({ roomId, fileId }) => {
    const file = db.prepare('SELECT * FROM room_files WHERE id = ? AND room_id = ?').get(fileId, roomId);
    if (file) {
      socket.emit('room-file-data', file);
    }
  });

  socket.on('webrtc-offer', (data) => socket.to(data.targetSocketId).emit('webrtc-offer', { senderSocketId: socket.id, offer: data.offer }));
  socket.on('webrtc-answer', (data) => socket.to(data.targetSocketId).emit('webrtc-answer', { senderSocketId: socket.id, answer: data.answer }));
  socket.on('ice-candidate', (data) => socket.to(data.targetSocketId).emit('ice-candidate', { senderSocketId: socket.id, candidate: data.candidate }));
  socket.on('speaking-update', (data) => socket.to(data.roomId).emit('speaking-update', { username: data.username, isSpeaking: data.isSpeaking }));

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      socket.to(user.roomId).emit('user-left', { socketId: socket.id, username: user.username });
      onlineUsers.delete(socket.id);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Signaling server running on port ${PORT}`));
