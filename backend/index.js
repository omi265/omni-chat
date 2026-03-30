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
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const SUPER_ADMIN = process.env.SUPER_ADMIN_USERNAME || 'admin';

const db = new Database(path.join(DATA_DIR, 'p2p.db'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use(express.static(path.join(__dirname, 'public')));

const randomId = (prefix = '') => `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    publicKey TEXT NOT NULL,
    avatarColor TEXT,
    avatarUrl TEXT
  );

  CREATE TABLE IF NOT EXISTS room_members (
    room_id TEXT,
    username TEXT,
    role TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (room_id, username),
    FOREIGN KEY(username) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'text'
  );

  CREATE TABLE IF NOT EXISTS offline_messages (
    id TEXT PRIMARY KEY,
    recipient_username TEXT NOT NULL,
    sender_username TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    ephemeral_pub_key TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(recipient_username) REFERENCES users(username)
  );

  CREATE TABLE IF NOT EXISTS room_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS room_files (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    nonce TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY (project_id, username)
  );

  CREATE TABLE IF NOT EXISTS task_statuses (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    order_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status_id TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    created_by TEXT NOT NULL,
    assignee_username TEXT,
    due_at INTEGER,
    position REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS task_checklist_items (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    text TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    order_index INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS task_comments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    author_username TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workspace_nodes (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    parent_id TEXT,
    node_type TEXT NOT NULL,
    title TEXT NOT NULL,
    icon TEXT,
    description TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS page_blocks (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    block_type TEXT NOT NULL,
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS database_schemas (
    node_id TEXT PRIMARY KEY,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS database_properties (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    name TEXT NOT NULL,
    property_type TEXT NOT NULL,
    config_json TEXT,
    order_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS database_records (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    title TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS database_record_values (
    record_id TEXT NOT NULL,
    property_id TEXT NOT NULL,
    value_json TEXT,
    PRIMARY KEY (record_id, property_id)
  );

  CREATE TABLE IF NOT EXISTS database_views (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    name TEXT NOT NULL,
    view_type TEXT NOT NULL,
    config_json TEXT,
    order_index INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS record_relations (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL,
    source_record_id TEXT,
    target_node_id TEXT NOT NULL,
    target_record_id TEXT,
    target_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS project_pages (
    node_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    task_database_node_id TEXT NOT NULL
  );
`);

try {
  const roomMessagesInfo = db.prepare('PRAGMA table_info(room_messages)').all();
  if (!roomMessagesInfo.some((col) => col.name === 'channel_id')) {
    db.prepare("ALTER TABLE room_messages ADD COLUMN channel_id TEXT NOT NULL DEFAULT 'general'").run();
  }

  const roomMembersInfo = db.prepare('PRAGMA table_info(room_members)').all();
  if (!roomMembersInfo.some((col) => col.name === 'role')) {
    db.prepare("ALTER TABLE room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member'").run();
  }

  const usersInfo = db.prepare('PRAGMA table_info(users)').all();
  if (!usersInfo.some((col) => col.name === 'avatarColor')) {
    db.prepare('ALTER TABLE users ADD COLUMN avatarColor TEXT').run();
  }
  if (!usersInfo.some((col) => col.name === 'avatarUrl')) {
    db.prepare('ALTER TABLE users ADD COLUMN avatarUrl TEXT').run();
  }
} catch (error) {
  console.error('Migration error', error);
}

const onlineUsers = new Map();

const getRoomRole = (roomId, username) => {
  const row = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND username = ?').get(roomId, username);
  return row ? row.role : null;
};

const ensureRoomMembership = (roomId, username) => {
  const existingRole = getRoomRole(roomId, username);
  if (existingRole) return existingRole;

  const memberCount = db.prepare('SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?').get(roomId).count;
  const role = memberCount === 0 ? 'owner' : 'member';
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, username, role) VALUES (?, ?, ?)').run(roomId, username, role);
  return role;
};

const isRoomMember = (roomId, username) => !!getRoomRole(roomId, username);

const getWorkspaceMembers = (roomId) =>
  db
    .prepare(
      `SELECT u.username, u.avatarColor, u.avatarUrl, rm.role
       FROM room_members rm
       JOIN users u ON u.username = rm.username
       WHERE rm.room_id = ?
       ORDER BY CASE rm.role WHEN 'owner' THEN 0 ELSE 1 END, u.username COLLATE NOCASE ASC`
    )
    .all(roomId);

const getProjectRow = (projectId) =>
  db.prepare('SELECT * FROM projects WHERE id = ? AND archived_at IS NULL').get(projectId);

const getProjectRole = (projectId, username) => {
  const project = getProjectRow(projectId);
  if (!project) return null;

  const roomRole = getRoomRole(project.room_id, username);
  if (roomRole === 'owner') return 'project_owner';

  const member = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND username = ?').get(projectId, username);
  return member ? member.role : null;
};

const requireProjectRole = (projectId, username, allowedRoles) => {
  const project = getProjectRow(projectId);
  if (!project) {
    return { ok: false, error: 'Project not found' };
  }

  const role = getProjectRole(projectId, username);
  if (!role || !allowedRoles.includes(role)) {
    return { ok: false, error: 'Insufficient project permissions' };
  }

  return { ok: true, project, role };
};

const listProjectsForUser = (roomId, username) => {
  if (!isRoomMember(roomId, username)) return [];

  const roomRole = getRoomRole(roomId, username);
  const rows = db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
              (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL) AS task_count
       FROM projects p
       WHERE p.room_id = ? AND p.archived_at IS NULL
       ORDER BY p.updated_at DESC`
    )
    .all(roomId);

  return rows
    .map((row) => {
      const role = roomRole === 'owner'
        ? 'project_owner'
        : (db.prepare('SELECT role FROM project_members WHERE project_id = ? AND username = ?').get(row.id, username)?.role || null);
      if (!role) return null;

      return {
        id: row.id,
        roomId: row.room_id,
        name: row.name,
        description: row.description || '',
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        memberCount: row.member_count,
        taskCount: row.task_count,
        role,
      };
    })
    .filter(Boolean);
};

const listProjectMembers = (projectId) =>
  db
    .prepare(
      `SELECT pm.username, pm.role, u.avatarColor, u.avatarUrl
       FROM project_members pm
       JOIN users u ON u.username = pm.username
       WHERE pm.project_id = ?
       ORDER BY CASE pm.role WHEN 'project_owner' THEN 0 WHEN 'project_editor' THEN 1 ELSE 2 END, pm.username COLLATE NOCASE ASC`
    )
    .all(projectId);

const listTaskStatuses = (projectId) =>
  db
    .prepare('SELECT id, name, color, order_index FROM task_statuses WHERE project_id = ? ORDER BY order_index ASC')
    .all(projectId)
    .map((status) => ({
      id: status.id,
      name: status.name,
      color: status.color || '#5865F2',
      orderIndex: status.order_index,
    }));

const serializeTask = (task) => {
  const checklist = db
    .prepare(
      'SELECT id, text, completed, order_index FROM task_checklist_items WHERE task_id = ? ORDER BY order_index ASC, rowid ASC'
    )
    .all(task.id)
    .map((item) => ({
      id: item.id,
      text: item.text,
      completed: Boolean(item.completed),
      orderIndex: item.order_index,
    }));

  const comments = db
    .prepare(
      `SELECT tc.id, tc.author_username, tc.body, tc.created_at, tc.updated_at, u.avatarColor, u.avatarUrl
       FROM task_comments tc
       JOIN users u ON u.username = tc.author_username
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`
    )
    .all(task.id)
    .map((comment) => ({
      id: comment.id,
      authorUsername: comment.author_username,
      body: comment.body,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      avatarColor: comment.avatarColor,
      avatarUrl: comment.avatarUrl,
    }));

  const attachments = db
    .prepare(
      'SELECT id, sender, name, type, size, created_at FROM task_attachments WHERE task_id = ? ORDER BY created_at DESC'
    )
    .all(task.id)
    .map((attachment) => ({
      id: attachment.id,
      sender: attachment.sender,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      createdAt: attachment.created_at,
    }));

  return {
    id: task.id,
    projectId: task.project_id,
    title: task.title,
    description: task.description || '',
    statusId: task.status_id,
    priority: task.priority,
    createdBy: task.created_by,
    assigneeUsername: task.assignee_username,
    dueAt: task.due_at,
    position: task.position,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    checklist,
    comments,
    attachments,
  };
};

const listProjectTasks = (projectId) =>
  db
    .prepare(
      `SELECT *
       FROM tasks
       WHERE project_id = ? AND archived_at IS NULL
       ORDER BY status_id ASC, position ASC, created_at ASC`
    )
    .all(projectId)
    .map(serializeTask);

const getProjectDetail = (projectId, username) => {
  const project = getProjectRow(projectId);
  if (!project) return null;

  const role = getProjectRole(projectId, username);
  if (!role) return null;

  return {
    id: project.id,
    roomId: project.room_id,
    name: project.name,
    description: project.description || '',
    createdBy: project.created_by,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    role,
    members: listProjectMembers(projectId),
    statuses: listTaskStatuses(projectId),
    tasks: listProjectTasks(projectId),
  };
};

const emitProjectsChanged = (roomId, projectId = null) => {
  io.to(roomId).emit('projects-changed', { roomId, projectId });
};

const emitProjectError = (socket, message) => {
  socket.emit('project-error', { message });
};

const createWorkspaceNode = ({ roomId, parentId = null, nodeType, title, description = '', icon = null, username, now = Date.now() }) => {
  const prefix = nodeType === 'database' ? 'db_' : nodeType === 'project_page' ? 'projpage_' : 'page_';
  const nodeId = randomId(prefix);
  db.prepare(
    'INSERT INTO workspace_nodes (id, room_id, parent_id, node_type, title, icon, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(nodeId, roomId, parentId, nodeType, title, icon, description, username, now, now);
  return nodeId;
};

const seedPageNode = (nodeId, username, content = '', blockType = 'paragraph', now = Date.now()) => {
  db.prepare(
    'INSERT INTO page_blocks (id, node_id, block_type, content, order_index, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(randomId('blk_'), nodeId, blockType, content, 0, username, now, now);
};

const ensureDefaultStatuses = (projectId) => {
  const count = db.prepare('SELECT COUNT(*) AS count FROM task_statuses WHERE project_id = ?').get(projectId).count;
  if (count > 0) return;

  const insert = db.prepare('INSERT INTO task_statuses (id, project_id, name, color, order_index) VALUES (?, ?, ?, ?, ?)');
  insert.run(randomId('status_'), projectId, 'Backlog', '#5865F2', 0);
  insert.run(randomId('status_'), projectId, 'In Progress', '#F59E0B', 1);
  insert.run(randomId('status_'), projectId, 'Done', '#23A559', 2);
};

const getNextTaskPosition = (projectId, statusId) => {
  const row = db.prepare('SELECT COALESCE(MAX(position), 0) AS max_position FROM tasks WHERE project_id = ? AND status_id = ? AND archived_at IS NULL').get(projectId, statusId);
  return Number(row.max_position || 0) + 1;
};

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
};

const emitWorkspaceChanged = (roomId, nodeId = null) => {
  io.to(roomId).emit('workspace-changed', { roomId, nodeId });
};

const emitWorkspaceError = (socket, message) => {
  socket.emit('workspace-error', { message });
};

const listWorkspaceNodes = (roomId) =>
  db
    .prepare(
      `SELECT id, room_id, parent_id, node_type, title, icon, description, created_by, created_at, updated_at
       FROM workspace_nodes
       WHERE room_id = ? AND archived_at IS NULL
       ORDER BY COALESCE(parent_id, ''), updated_at DESC, title COLLATE NOCASE ASC`
    )
    .all(roomId)
    .map((node) => ({
      id: node.id,
      roomId: node.room_id,
      parentId: node.parent_id,
      nodeType: node.node_type,
      title: node.title,
      icon: node.icon,
      description: node.description || '',
      createdBy: node.created_by,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
    }));

const listChildWorkspaceNodes = (parentId) =>
  db
    .prepare(
      `SELECT id, room_id, parent_id, node_type, title, icon, description, created_by, created_at, updated_at
       FROM workspace_nodes
       WHERE parent_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC, title COLLATE NOCASE ASC`
    )
    .all(parentId)
    .map((node) => ({
      id: node.id,
      roomId: node.room_id,
      parentId: node.parent_id,
      nodeType: node.node_type,
      title: node.title,
      icon: node.icon,
      description: node.description || '',
      createdBy: node.created_by,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
    }));

const getWorkspaceNode = (nodeId) =>
  db.prepare('SELECT * FROM workspace_nodes WHERE id = ? AND archived_at IS NULL').get(nodeId);

const listPageBlocks = (nodeId) =>
  db
    .prepare(
      `SELECT id, block_type, content, order_index, created_by, created_at, updated_at
       FROM page_blocks
       WHERE node_id = ?
       ORDER BY order_index ASC, created_at ASC`
    )
    .all(nodeId)
    .map((block) => ({
      id: block.id,
      blockType: block.block_type,
      content: block.content,
      orderIndex: block.order_index,
      createdBy: block.created_by,
      createdAt: block.created_at,
      updatedAt: block.updated_at,
    }));

const listNodeBacklinks = (nodeId) =>
  db
    .prepare(
      `SELECT source_node_id, source_record_id, target_type
       FROM record_relations
       WHERE target_node_id = ?
       ORDER BY created_at DESC`
    )
    .all(nodeId)
    .map((relation) => ({
      sourceNodeId: relation.source_node_id,
      sourceRecordId: relation.source_record_id,
      targetType: relation.target_type,
    }));

const getPageDetail = (nodeId) => {
  const node = getWorkspaceNode(nodeId);
  if (!node || !['page', 'project_page'].includes(node.node_type)) return null;

  return {
    id: node.id,
    roomId: node.room_id,
    parentId: node.parent_id,
    nodeType: node.node_type,
    title: node.title,
    icon: node.icon,
    description: node.description || '',
    createdBy: node.created_by,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
    blocks: listPageBlocks(nodeId),
    backlinks: listNodeBacklinks(nodeId),
    childNodes: listChildWorkspaceNodes(nodeId),
  };
};

const getProjectPageDetail = (nodeId, username) => {
  const page = getPageDetail(nodeId);
  if (!page || page.nodeType !== 'project_page') return null;

  const projectPageLink = getProjectPageLinkByNodeId(nodeId);
  if (!projectPageLink) return null;

  return {
    ...page,
    project: getProjectDetail(projectPageLink.project_id, username),
    taskDatabaseNodeId: projectPageLink.task_database_node_id,
  };
};

const listDatabaseProperties = (nodeId) =>
  db
    .prepare(
      `SELECT id, name, property_type, config_json, order_index
       FROM database_properties
       WHERE node_id = ?
       ORDER BY order_index ASC, rowid ASC`
    )
    .all(nodeId)
    .map((property) => ({
      id: property.id,
      name: property.name,
      propertyType: property.property_type,
      config: parseJson(property.config_json, {}),
      orderIndex: property.order_index,
    }));

const listDatabaseViews = (nodeId) =>
  db
    .prepare(
      `SELECT id, name, view_type, config_json, order_index
       FROM database_views
       WHERE node_id = ?
       ORDER BY order_index ASC, rowid ASC`
    )
    .all(nodeId)
    .map((view) => ({
      id: view.id,
      name: view.name,
      viewType: view.view_type,
      config: parseJson(view.config_json, {}),
      orderIndex: view.order_index,
    }));

const listDatabaseRecords = (nodeId) => {
  const properties = listDatabaseProperties(nodeId);
  const propertyIds = new Set(properties.map((property) => property.id));

  return db
    .prepare(
      `SELECT id, title, created_by, created_at, updated_at
       FROM database_records
       WHERE node_id = ? AND archived_at IS NULL
       ORDER BY updated_at DESC, title COLLATE NOCASE ASC`
    )
    .all(nodeId)
    .map((record) => {
      const values = db
        .prepare('SELECT property_id, value_json FROM database_record_values WHERE record_id = ?')
        .all(record.id)
        .reduce((acc, valueRow) => {
          if (propertyIds.has(valueRow.property_id)) {
            acc[valueRow.property_id] = parseJson(valueRow.value_json, null);
          }
          return acc;
        }, {});

      return {
        id: record.id,
        nodeId,
        title: record.title,
        createdBy: record.created_by,
        createdAt: record.created_at,
        updatedAt: record.updated_at,
        values,
      };
    });
};

const getDatabaseDetail = (nodeId) => {
  const node = getWorkspaceNode(nodeId);
  if (!node || node.node_type !== 'database') return null;

  const schema = db.prepare('SELECT description FROM database_schemas WHERE node_id = ?').get(nodeId);

  return {
    id: node.id,
    roomId: node.room_id,
    parentId: node.parent_id,
    nodeType: node.node_type,
    title: node.title,
    icon: node.icon,
    description: schema?.description || node.description || '',
    createdBy: node.created_by,
    createdAt: node.created_at,
    updatedAt: node.updated_at,
    properties: listDatabaseProperties(nodeId),
    views: listDatabaseViews(nodeId),
    records: listDatabaseRecords(nodeId),
    backlinks: listNodeBacklinks(nodeId),
  };
};

const upsertRecordRelations = (nodeId, recordId, value) => {
  db.prepare('DELETE FROM record_relations WHERE source_node_id = ? AND source_record_id = ?').run(nodeId, recordId);

  if (!Array.isArray(value)) return;

  const insert = db.prepare(
    'INSERT INTO record_relations (id, source_node_id, source_record_id, target_node_id, target_record_id, target_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const now = Date.now();

  for (const relation of value) {
    if (!relation || !relation.targetNodeId) continue;
    insert.run(
      randomId('rel_'),
      nodeId,
      recordId,
      relation.targetNodeId,
      relation.targetRecordId || null,
      relation.targetType || (relation.targetRecordId ? 'record' : 'page'),
      now
    );
  }
};

const ensureDefaultDatabaseTemplate = (nodeId) => {
  const propertyCount = db.prepare('SELECT COUNT(*) AS count FROM database_properties WHERE node_id = ?').get(nodeId).count;
  if (propertyCount === 0) {
    const insertProperty = db.prepare(
      'INSERT INTO database_properties (id, node_id, name, property_type, config_json, order_index) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertProperty.run(randomId('prop_'), nodeId, 'Status', 'status', JSON.stringify({ options: ['Backlog', 'In Progress', 'Done'] }), 0);
    insertProperty.run(randomId('prop_'), nodeId, 'Assignee', 'person', JSON.stringify({ multiple: false }), 1);
    insertProperty.run(randomId('prop_'), nodeId, 'Due Date', 'date', JSON.stringify({}), 2);
  }

  const viewCount = db.prepare('SELECT COUNT(*) AS count FROM database_views WHERE node_id = ?').get(nodeId).count;
  if (viewCount === 0) {
    const insertView = db.prepare(
      'INSERT INTO database_views (id, node_id, name, view_type, config_json, order_index) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insertView.run(randomId('view_'), nodeId, 'Table', 'table', JSON.stringify({}), 0);
    insertView.run(randomId('view_'), nodeId, 'Board', 'board', JSON.stringify({ groupByPropertyName: 'Status' }), 1);
    insertView.run(randomId('view_'), nodeId, 'List', 'list', JSON.stringify({}), 2);
  }
};

const getProjectPageLinkByProjectId = (projectId) =>
  db.prepare('SELECT node_id, project_id, task_database_node_id FROM project_pages WHERE project_id = ?').get(projectId);

const getProjectPageLinkByNodeId = (nodeId) =>
  db.prepare('SELECT node_id, project_id, task_database_node_id FROM project_pages WHERE node_id = ?').get(nodeId);

const createProjectWorkspaceArtifacts = ({ roomId, projectId, username, name, description = '', now = Date.now() }) => {
  const existing = getProjectPageLinkByProjectId(projectId);
  if (existing) {
    return {
      nodeId: existing.node_id,
      projectId: existing.project_id,
      taskDatabaseNodeId: existing.task_database_node_id,
    };
  }

  const projectPageNodeId = createWorkspaceNode({
    roomId,
    nodeType: 'project_page',
    title: name,
    description,
    icon: '◫',
    username,
    now,
  });
  seedPageNode(
    projectPageNodeId,
    username,
    'Project overview\n\nUse this page as the home for scope, notes, decisions, and the linked task board below.',
    'paragraph',
    now
  );

  const taskDatabaseNodeId = createWorkspaceNode({
    roomId,
    parentId: projectPageNodeId,
    nodeType: 'database',
    title: `${name} Tasks`,
    description: 'Canonical task tracker for this project.',
    icon: '≣',
    username,
    now,
  });
  db.prepare('INSERT INTO database_schemas (node_id, description) VALUES (?, ?)').run(
    taskDatabaseNodeId,
    'Project task tracker'
  );
  ensureDefaultDatabaseTemplate(taskDatabaseNodeId);

  const notesNodeId = createWorkspaceNode({
    roomId,
    parentId: projectPageNodeId,
    nodeType: 'page',
    title: 'Notes',
    description: 'Working notes and meeting captures.',
    icon: '•',
    username,
    now,
  });
  seedPageNode(notesNodeId, username, 'Capture raw thinking, meeting notes, and loose research here.', 'paragraph', now);

  const decisionsNodeId = createWorkspaceNode({
    roomId,
    parentId: projectPageNodeId,
    nodeType: 'page',
    title: 'Decisions',
    description: 'Resolved decisions and rationale.',
    icon: '•',
    username,
    now,
  });
  seedPageNode(decisionsNodeId, username, 'Document decisions, tradeoffs, and who approved them.', 'paragraph', now);

  db.prepare('INSERT INTO project_pages (node_id, project_id, task_database_node_id) VALUES (?, ?, ?)').run(
    projectPageNodeId,
    projectId,
    taskDatabaseNodeId
  );

  return {
    nodeId: projectPageNodeId,
    projectId,
    taskDatabaseNodeId,
  };
};

const ensureProjectWorkspaceArtifacts = (roomId) => {
  const projects = db
    .prepare('SELECT id, room_id, name, description, created_by, created_at FROM projects WHERE room_id = ? AND archived_at IS NULL')
    .all(roomId);

  for (const project of projects) {
    createProjectWorkspaceArtifacts({
      roomId: project.room_id,
      projectId: project.id,
      username: project.created_by,
      name: project.name,
      description: project.description || '',
      now: project.created_at || Date.now(),
    });
  }
};

io.on('connection', (socket) => {
  socket.on('register-user', ({ username, publicKey, avatarColor, avatarUrl }) => {
    const user = db.prepare('SELECT publicKey, avatarColor, avatarUrl FROM users WHERE username = ?').get(username);
    if (user && user.publicKey !== publicKey) {
      return socket.emit('error', { message: 'Incorrect password' });
    }

    if (!user) {
      db.prepare('INSERT INTO users (username, publicKey, avatarColor, avatarUrl) VALUES (?, ?, ?, ?)').run(
        username,
        publicKey,
        avatarColor || null,
        avatarUrl || null
      );
    } else if (avatarColor || avatarUrl) {
      db.prepare(
        'UPDATE users SET avatarColor = COALESCE(?, avatarColor), avatarUrl = COALESCE(?, avatarUrl) WHERE username = ?'
      ).run(avatarColor || null, avatarUrl || null, username);
    }

    const finalUser = db.prepare('SELECT avatarColor, avatarUrl FROM users WHERE username = ?').get(username);
    socket.emit('verified', {
      hasProfile: !!(finalUser.avatarColor || finalUser.avatarUrl),
      avatarColor: finalUser.avatarColor,
      avatarUrl: finalUser.avatarUrl,
      isAdmin: username === SUPER_ADMIN,
    });
  });

  socket.on('admin-get-rooms', ({ username }) => {
    if (username !== SUPER_ADMIN) return;
    const rooms = db.prepare('SELECT DISTINCT room_id FROM room_members').all();
    socket.emit(
      'admin-rooms-list',
      rooms.map((room) => ({
        id: room.room_id,
        members: db.prepare('SELECT username, role FROM room_members WHERE room_id = ?').all(room.room_id),
      }))
    );
  });

  socket.on('admin-get-users', ({ username }) => {
    if (username !== SUPER_ADMIN) return;
    const users = db.prepare('SELECT username, avatarColor, avatarUrl FROM users').all();
    const usersWithStats = users.map((user) => {
      const joinedRooms = db.prepare('SELECT room_id FROM room_members WHERE username = ?').all(user.username);
      return { ...user, serverCount: joinedRooms.length, servers: joinedRooms.map((room) => room.room_id) };
    });
    socket.emit('admin-users-list', usersWithStats);
  });

  socket.on('admin-delete-user', ({ username, targetUsername }) => {
    if (username !== SUPER_ADMIN || targetUsername === SUPER_ADMIN) return;
    db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
    db.prepare('DELETE FROM room_members WHERE username = ?').run(targetUsername);
    db.prepare('DELETE FROM offline_messages WHERE recipient_username = ? OR sender_username = ?').run(
      targetUsername,
      targetUsername
    );
    db.prepare('DELETE FROM project_members WHERE username = ?').run(targetUsername);
    socket.emit('admin-action-success', { message: `User ${targetUsername} deleted.` });
  });

  socket.on('admin-delete-room', ({ username, roomId }) => {
    if (username !== SUPER_ADMIN) return;

    const projectIds = db.prepare('SELECT id FROM projects WHERE room_id = ?').all(roomId).map((row) => row.id);
    for (const projectId of projectIds) {
      db.prepare('DELETE FROM task_attachments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(projectId);
      db.prepare('DELETE FROM task_comments WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(projectId);
      db.prepare('DELETE FROM task_checklist_items WHERE task_id IN (SELECT id FROM tasks WHERE project_id = ?)').run(projectId);
      db.prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM task_statuses WHERE project_id = ?').run(projectId);
      db.prepare('DELETE FROM project_members WHERE project_id = ?').run(projectId);
    }

    db.prepare('DELETE FROM projects WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_messages WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM room_files WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM channels WHERE room_id = ?').run(roomId);

    const rooms = db.prepare('SELECT DISTINCT room_id FROM room_members').all();
    socket.emit(
      'admin-rooms-list',
      rooms.map((room) => ({
        id: room.room_id,
        members: db.prepare('SELECT username, role FROM room_members WHERE room_id = ?').all(room.room_id),
      }))
    );
  });

  socket.on('workspace-join', ({ roomId, username }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const user = db.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (!user) {
      ack({ ok: false, message: 'User must be registered before joining a workspace' });
      return emitWorkspaceError(socket, 'User must be registered before joining a workspace');
    }

    socket.join(roomId);
    const role = ensureRoomMembership(roomId, username);
    const existing = onlineUsers.get(socket.id);
    onlineUsers.set(socket.id, {
      username,
      roomId,
      voiceChannelId: existing?.voiceChannelId || null,
    });

    const response = { ok: true, roomId, roomRole: role };
    ack(response);
    socket.emit('workspace-ready', response);
  });

  socket.on('join-room', ({ roomId, username }) => {
    socket.join(roomId);
    const existing = onlineUsers.get(socket.id);
    onlineUsers.set(socket.id, { username, roomId, voiceChannelId: existing?.voiceChannelId || null });

    const role = ensureRoomMembership(roomId, username);

    const userRow = db.prepare('SELECT publicKey, avatarColor, avatarUrl FROM users WHERE username = ?').get(username);
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      username,
      publicKey: userRow?.publicKey,
      avatarColor: userRow?.avatarColor,
      avatarUrl: userRow?.avatarUrl,
      role,
      voiceChannelId: null,
    });

    const allMembers = db
      .prepare(
        `SELECT u.username, u.publicKey, u.avatarColor, u.avatarUrl, rm.role
         FROM users u
         JOIN room_members rm ON u.username = rm.username
         WHERE rm.room_id = ?`
      )
      .all(roomId);

    socket.emit(
      'room-members-list',
      allMembers.map((member) => {
        const onlineEntry = Array.from(onlineUsers.entries()).find(
          ([, onlineUser]) => onlineUser.username === member.username && onlineUser.roomId === roomId
        );
        return {
          ...member,
          isOnline: !!onlineEntry,
          socketId: onlineEntry ? onlineEntry[0] : null,
          voiceChannelId: onlineEntry ? onlineEntry[1].voiceChannelId : null,
        };
      })
    );

    let channels = db.prepare('SELECT * FROM channels WHERE room_id = ?').all(roomId);
    if (channels.length === 0) {
      db.prepare('INSERT OR IGNORE INTO channels (id, room_id, name, type) VALUES (?, ?, ?, ?)').run(
        `${roomId}:general`,
        roomId,
        'general',
        'text'
      );
      db.prepare('INSERT OR IGNORE INTO channels (id, room_id, name, type) VALUES (?, ?, ?, ?)').run(
        `${roomId}:voice-gen`,
        roomId,
        'General Voice',
        'voice'
      );
      channels = db.prepare('SELECT * FROM channels WHERE room_id = ?').all(roomId);
    }
    socket.emit('channel-list', channels);

    const history = db.prepare('SELECT * FROM room_messages WHERE room_id = ? ORDER BY timestamp ASC LIMIT 500').all(roomId);
    socket.emit(
      'room-history-bulk',
      history.map((message) => ({
        id: message.id,
        sender: message.sender,
        timestamp: message.timestamp,
        channelId: message.channel_id,
        payload: { ciphertext: message.ciphertext, nonce: message.nonce },
      }))
    );

    const files = db
      .prepare(
        'SELECT id, channel_id, sender, name, type, size, nonce, timestamp FROM room_files WHERE room_id = ? ORDER BY timestamp ASC LIMIT 100'
      )
      .all(roomId);
    socket.emit('room-files-bulk', files);
  });

  socket.on('join-voice', ({ roomId, channelId }) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    user.voiceChannelId = channelId;
    io.to(roomId).emit('voice-state-update', { username: user.username, channelId });
  });

  socket.on('leave-voice', ({ roomId }) => {
    const user = onlineUsers.get(socket.id);
    if (!user) return;
    user.voiceChannelId = null;
    io.to(roomId).emit('voice-state-update', { username: user.username, channelId: null });
  });

  socket.on('get-channel-history', ({ roomId, channelId }) => {
    const history = db
      .prepare('SELECT * FROM room_messages WHERE room_id = ? AND channel_id = ? ORDER BY timestamp ASC LIMIT 100')
      .all(roomId, channelId);
    socket.emit('room-history', {
      channelId,
      messages: history.map((message) => ({
        id: message.id,
        sender: message.sender,
        timestamp: message.timestamp,
        payload: { ciphertext: message.ciphertext, nonce: message.nonce },
      })),
    });
  });

  socket.on('create-channel', ({ roomId, name, type }) => {
    const id = `${roomId}:${Math.random().toString(36).substring(7)}`;
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
    db.prepare(
      'INSERT INTO room_messages (id, room_id, channel_id, sender, ciphertext, nonce, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(message.id, roomId, channelId, message.sender, message.payload.ciphertext, message.payload.nonce, message.timestamp);
    io.to(roomId).emit('room-message', { ...message, channelId });
  });

  socket.on('send-room-file', ({ roomId, channelId, file }) => {
    const { id, sender, name, type, size, data, nonce, timestamp } = file;
    try {
      db.prepare(
        `INSERT INTO room_files (id, room_id, channel_id, sender, name, type, size, data, nonce, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, roomId, channelId, sender, name, type, size, data, nonce, timestamp);
      io.to(roomId).emit('room-file', { ...file, channelId });
    } catch (error) {
      console.error('Failed to store/broadcast room file', error);
    }
  });

  socket.on('get-room-file', ({ roomId, fileId }) => {
    const file = db.prepare('SELECT * FROM room_files WHERE id = ? AND room_id = ?').get(fileId, roomId);
    if (file) socket.emit('room-file-data', file);
  });

  socket.on('workspace-get-members', ({ roomId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitProjectError(socket, 'You are not a member of this workspace');
    }
    socket.emit('workspace-members-data', { roomId, members: getWorkspaceMembers(roomId) });
  });

  socket.on('projects-list-request', ({ roomId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitProjectError(socket, 'You are not a member of this workspace');
    }
    socket.emit('projects-list-data', { roomId, projects: listProjectsForUser(roomId, username) });
  });

  socket.on('project-get', ({ roomId, projectId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitProjectError(socket, 'You are not a member of this workspace');
    }

    const detail = getProjectDetail(projectId, username);
    if (!detail || detail.roomId !== roomId) {
      return emitProjectError(socket, 'Project not found or inaccessible');
    }

    socket.emit('project-detail-data', { roomId, project: detail });
  });

  socket.on('project-create', ({ roomId, username, name, description }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    if (!isRoomMember(roomId, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitProjectError(socket, 'You are not a member of this workspace');
    }
    if (!name || !name.trim()) {
      ack({ ok: false, message: 'Project name is required' });
      return emitProjectError(socket, 'Project name is required');
    }

    const now = Date.now();
    const projectId = randomId('proj_');
    db.prepare(
      'INSERT INTO projects (id, room_id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(projectId, roomId, name.trim(), description?.trim() || '', username, now, now);
    db.prepare('INSERT INTO project_members (project_id, username, role) VALUES (?, ?, ?)').run(
      projectId,
      username,
      'project_owner'
    );
    ensureDefaultStatuses(projectId);
    const workspaceProject = createProjectWorkspaceArtifacts({
      roomId,
      projectId,
      username,
      name: name.trim(),
      description: description?.trim() || '',
      now,
    });
    emitProjectsChanged(roomId, projectId);
    emitWorkspaceChanged(roomId, workspaceProject.nodeId);
    ack({ ok: true, projectId, nodeId: workspaceProject.nodeId, taskDatabaseNodeId: workspaceProject.taskDatabaseNodeId });
  });

  socket.on('workspace-project-create', ({ roomId, username, title, description }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    if (!isRoomMember(roomId, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    if (!title || !title.trim()) {
      ack({ ok: false, message: 'Project title is required' });
      return emitWorkspaceError(socket, 'Project title is required');
    }

    const now = Date.now();
    const trimmedTitle = title.trim();
    const trimmedDescription = description?.trim() || '';
    const projectId = randomId('proj_');

    db.prepare(
      'INSERT INTO projects (id, room_id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(projectId, roomId, trimmedTitle, trimmedDescription, username, now, now);
    db.prepare('INSERT INTO project_members (project_id, username, role) VALUES (?, ?, ?)').run(
      projectId,
      username,
      'project_owner'
    );
    ensureDefaultStatuses(projectId);

    const workspaceProject = createProjectWorkspaceArtifacts({
      roomId,
      projectId,
      username,
      name: trimmedTitle,
      description: trimmedDescription,
      now,
    });

    emitProjectsChanged(roomId, projectId);
    emitWorkspaceChanged(roomId, workspaceProject.nodeId);
    ack({ ok: true, projectId, nodeId: workspaceProject.nodeId, taskDatabaseNodeId: workspaceProject.taskDatabaseNodeId });
  });

  socket.on('workspace-tree-request', ({ roomId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    ensureProjectWorkspaceArtifacts(roomId);
    socket.emit('workspace-tree-data', { roomId, nodes: listWorkspaceNodes(roomId) });
  });

  socket.on('workspace-node-create', ({ roomId, username, parentId, nodeType, title, description, icon }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    if (!isRoomMember(roomId, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    if (!['page', 'database'].includes(nodeType)) {
      ack({ ok: false, message: 'Invalid workspace node type' });
      return emitWorkspaceError(socket, 'Invalid workspace node type');
    }

    const now = Date.now();
    const nodeId = randomId(nodeType === 'page' ? 'page_' : 'db_');
    db.prepare(
      'INSERT INTO workspace_nodes (id, room_id, parent_id, node_type, title, icon, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      nodeId,
      roomId,
      parentId || null,
      nodeType,
      title?.trim() || (nodeType === 'page' ? 'Untitled Page' : 'Untitled Database'),
      icon || null,
      description?.trim() || '',
      username,
      now,
      now
    );

    if (nodeType === 'page') {
      db.prepare(
        'INSERT INTO page_blocks (id, node_id, block_type, content, order_index, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(randomId('blk_'), nodeId, 'paragraph', '', 0, username, now, now);
    } else {
      db.prepare('INSERT INTO database_schemas (node_id, description) VALUES (?, ?)').run(nodeId, description?.trim() || '');
      ensureDefaultDatabaseTemplate(nodeId);
    }

    emitWorkspaceChanged(roomId, nodeId);
    ack({ ok: true, nodeId });
  });

  socket.on('workspace-page-get', ({ roomId, nodeId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    const page = getPageDetail(nodeId);
    if (!page || page.roomId !== roomId) {
      return emitWorkspaceError(socket, 'Page not found');
    }
    socket.emit('workspace-page-data', { roomId, page });
  });

  socket.on('workspace-project-page-get', ({ roomId, nodeId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    const projectPage = getProjectPageDetail(nodeId, username);
    if (!projectPage || projectPage.roomId !== roomId) {
      return emitWorkspaceError(socket, 'Project page not found');
    }
    socket.emit('workspace-project-page-data', { roomId, projectPage });
  });

  socket.on('workspace-page-update', ({ nodeId, username, title, description }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || !['page', 'project_page'].includes(node.node_type)) {
      ack({ ok: false, message: 'Page not found' });
      return emitWorkspaceError(socket, 'Page not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }

    db.prepare('UPDATE workspace_nodes SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
      title?.trim() || 'Untitled Page',
      description?.trim() || '',
      Date.now(),
      nodeId
    );
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true });
  });

  socket.on('workspace-page-block-upsert', ({ nodeId, username, blockId, blockType, content, orderIndex }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || !['page', 'project_page'].includes(node.node_type)) {
      ack({ ok: false, message: 'Page not found' });
      return emitWorkspaceError(socket, 'Page not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }

    const now = Date.now();
    const id = blockId || randomId('blk_');
    db.prepare(
      `INSERT INTO page_blocks (id, node_id, block_type, content, order_index, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET block_type = excluded.block_type, content = excluded.content, order_index = excluded.order_index, updated_at = excluded.updated_at`
    ).run(id, nodeId, blockType || 'paragraph', content || '', Number(orderIndex || 0), username, now, now);
    db.prepare('UPDATE workspace_nodes SET updated_at = ? WHERE id = ?').run(now, nodeId);
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true, blockId: id });
  });

  socket.on('workspace-page-block-delete', ({ nodeId, username, blockId }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || !['page', 'project_page'].includes(node.node_type)) {
      ack({ ok: false, message: 'Page not found' });
      return emitWorkspaceError(socket, 'Page not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    db.prepare('DELETE FROM page_blocks WHERE id = ? AND node_id = ?').run(blockId, nodeId);
    db.prepare('UPDATE workspace_nodes SET updated_at = ? WHERE id = ?').run(Date.now(), nodeId);
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true });
  });

  socket.on('workspace-database-get', ({ roomId, nodeId, username }) => {
    if (!isRoomMember(roomId, username)) {
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    const database = getDatabaseDetail(nodeId);
    if (!database || database.roomId !== roomId) {
      return emitWorkspaceError(socket, 'Database not found');
    }
    socket.emit('workspace-database-data', { roomId, database });
  });

  socket.on('workspace-database-update', ({ nodeId, username, title, description }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || node.node_type !== 'database') {
      ack({ ok: false, message: 'Database not found' });
      return emitWorkspaceError(socket, 'Database not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    db.prepare('UPDATE workspace_nodes SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
      title?.trim() || 'Untitled Database',
      description?.trim() || '',
      Date.now(),
      nodeId
    );
    db.prepare('INSERT INTO database_schemas (node_id, description) VALUES (?, ?) ON CONFLICT(node_id) DO UPDATE SET description = excluded.description').run(
      nodeId,
      description?.trim() || ''
    );
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true });
  });

  socket.on('workspace-database-property-create', ({ nodeId, username, name, propertyType }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || node.node_type !== 'database') {
      ack({ ok: false, message: 'Database not found' });
      return emitWorkspaceError(socket, 'Database not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }
    if (!['text', 'number', 'checkbox', 'select', 'multi_select', 'date', 'person', 'status', 'relation'].includes(propertyType)) {
      ack({ ok: false, message: 'Unsupported property type' });
      return emitWorkspaceError(socket, 'Unsupported property type');
    }

    const orderIndex = db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM database_properties WHERE node_id = ?').get(nodeId).next_index;
    const propertyId = randomId('prop_');
    db.prepare(
      'INSERT INTO database_properties (id, node_id, name, property_type, config_json, order_index) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(propertyId, nodeId, name?.trim() || 'Untitled Property', propertyType, JSON.stringify({}), orderIndex);
    db.prepare('UPDATE workspace_nodes SET updated_at = ? WHERE id = ?').run(Date.now(), nodeId);
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true, propertyId });
  });

  socket.on('workspace-database-record-create', ({ nodeId, username, title }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || node.node_type !== 'database') {
      ack({ ok: false, message: 'Database not found' });
      return emitWorkspaceError(socket, 'Database not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }

    const now = Date.now();
    const recordId = randomId('rec_');
    db.prepare(
      'INSERT INTO database_records (id, node_id, title, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(recordId, nodeId, title?.trim() || 'Untitled Record', username, now, now);
    db.prepare('UPDATE workspace_nodes SET updated_at = ? WHERE id = ?').run(now, nodeId);
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true, recordId });
  });

  socket.on('workspace-database-record-update', ({ nodeId, recordId, username, title, values }, callback) => {
    const ack = typeof callback === 'function' ? callback : () => {};
    const node = getWorkspaceNode(nodeId);
    if (!node || node.node_type !== 'database') {
      ack({ ok: false, message: 'Database not found' });
      return emitWorkspaceError(socket, 'Database not found');
    }
    if (!isRoomMember(node.room_id, username)) {
      ack({ ok: false, message: 'You are not a member of this workspace' });
      return emitWorkspaceError(socket, 'You are not a member of this workspace');
    }

    const record = db.prepare('SELECT id FROM database_records WHERE id = ? AND node_id = ? AND archived_at IS NULL').get(recordId, nodeId);
    if (!record) {
      ack({ ok: false, message: 'Record not found' });
      return emitWorkspaceError(socket, 'Record not found');
    }

    db.prepare('UPDATE database_records SET title = ?, updated_at = ? WHERE id = ?').run(
      title?.trim() || 'Untitled Record',
      Date.now(),
      recordId
    );

    if (values && typeof values === 'object') {
      const properties = listDatabaseProperties(nodeId).reduce((acc, property) => {
        acc[property.id] = property;
        return acc;
      }, {});

      const upsertValue = db.prepare(
        `INSERT INTO database_record_values (record_id, property_id, value_json)
         VALUES (?, ?, ?)
         ON CONFLICT(record_id, property_id) DO UPDATE SET value_json = excluded.value_json`
      );

      for (const [propertyId, value] of Object.entries(values)) {
        if (!properties[propertyId]) continue;
        upsertValue.run(recordId, propertyId, JSON.stringify(value));
        if (properties[propertyId].propertyType === 'relation') {
          upsertRecordRelations(nodeId, recordId, value);
        }
      }
    }

    db.prepare('UPDATE workspace_nodes SET updated_at = ? WHERE id = ?').run(Date.now(), nodeId);
    emitWorkspaceChanged(node.room_id, nodeId);
    ack({ ok: true });
  });

  socket.on('project-update', ({ projectId, username, name, description }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    const nextName = name?.trim() || 'Untitled Project';
    const nextDescription = description?.trim() || '';
    const now = Date.now();
    db.prepare('UPDATE projects SET name = ?, description = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      nextDescription,
      now,
      projectId
    );
    const projectPageLink = getProjectPageLinkByProjectId(projectId);
    if (projectPageLink) {
      db.prepare('UPDATE workspace_nodes SET title = ?, description = ?, updated_at = ? WHERE id = ?').run(
        nextName,
        nextDescription,
        now,
        projectPageLink.node_id
      );
      db.prepare('UPDATE workspace_nodes SET title = ?, updated_at = ? WHERE id = ?').run(
        `${nextName} Tasks`,
        now,
        projectPageLink.task_database_node_id
      );
      emitWorkspaceChanged(permission.project.room_id, projectPageLink.node_id);
    }
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('project-archive', ({ projectId, username }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    const now = Date.now();
    db.prepare('UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ?').run(now, now, projectId);
    const projectPageLink = getProjectPageLinkByProjectId(projectId);
    if (projectPageLink) {
      db.prepare('UPDATE workspace_nodes SET archived_at = ?, updated_at = ? WHERE id = ? OR parent_id = ?').run(
        now,
        now,
        projectPageLink.node_id,
        projectPageLink.node_id
      );
      emitWorkspaceChanged(permission.project.room_id, projectPageLink.node_id);
    }
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('project-member-set', ({ projectId, username, targetUsername, role }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (!['project_owner', 'project_editor', 'project_viewer'].includes(role)) {
      return emitProjectError(socket, 'Invalid project role');
    }
    if (!isRoomMember(permission.project.room_id, targetUsername)) {
      return emitProjectError(socket, 'Target user is not in the workspace');
    }

    db.prepare('INSERT INTO project_members (project_id, username, role) VALUES (?, ?, ?) ON CONFLICT(project_id, username) DO UPDATE SET role = excluded.role').run(
      projectId,
      targetUsername,
      role
    );
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('project-member-remove', ({ projectId, username, targetUsername }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (targetUsername === username) {
      return emitProjectError(socket, 'Transfer ownership before removing yourself');
    }

    db.prepare('DELETE FROM project_members WHERE project_id = ? AND username = ?').run(projectId, targetUsername);
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('project-status-create', ({ projectId, username, name, color }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (!name || !name.trim()) return emitProjectError(socket, 'Status name is required');

    const orderIndex = db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM task_statuses WHERE project_id = ?').get(projectId).next_index;
    db.prepare('INSERT INTO task_statuses (id, project_id, name, color, order_index) VALUES (?, ?, ?, ?, ?)').run(
      randomId('status_'),
      projectId,
      name.trim(),
      color || '#5865F2',
      orderIndex
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId);
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('project-status-update', ({ projectId, statusId, username, name, color }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    db.prepare('UPDATE task_statuses SET name = ?, color = ? WHERE id = ? AND project_id = ?').run(
      name?.trim() || 'Status',
      color || '#5865F2',
      statusId,
      projectId
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId);
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('project-status-delete', ({ projectId, statusId, username }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    const statuses = listTaskStatuses(projectId);
    if (statuses.length <= 1) {
      return emitProjectError(socket, 'A project must keep at least one status');
    }

    const fallback = statuses.find((status) => status.id !== statusId);
    db.prepare('UPDATE tasks SET status_id = ?, position = position + 1000, updated_at = ? WHERE project_id = ? AND status_id = ? AND archived_at IS NULL').run(
      fallback.id,
      Date.now(),
      projectId,
      statusId
    );
    db.prepare('DELETE FROM task_statuses WHERE id = ? AND project_id = ?').run(statusId, projectId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), projectId);
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('task-create', ({ projectId, username, title, description, statusId, priority, assigneeUsername, dueAt }) => {
    const permission = requireProjectRole(projectId, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (!title || !title.trim()) return emitProjectError(socket, 'Task title is required');

    const chosenStatusId = statusId || listTaskStatuses(projectId)[0]?.id;
    if (!chosenStatusId) return emitProjectError(socket, 'Project has no statuses');

    const now = Date.now();
    db.prepare(
      `INSERT INTO tasks
       (id, project_id, title, description, status_id, priority, created_by, assignee_username, due_at, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      randomId('task_'),
      projectId,
      title.trim(),
      description?.trim() || '',
      chosenStatusId,
      priority || 'medium',
      username,
      assigneeUsername || null,
      dueAt || null,
      getNextTaskPosition(projectId, chosenStatusId),
      now,
      now
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, projectId);
    emitProjectsChanged(permission.project.room_id, projectId);
  });

  socket.on('task-update', ({ taskId, username, updates }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    const nextStatusId = updates.statusId || task.status_id;
    const nextPosition = updates.position != null
      ? Number(updates.position)
      : (nextStatusId !== task.status_id ? getNextTaskPosition(task.project_id, nextStatusId) : task.position);

    db.prepare(
      `UPDATE tasks
       SET title = ?, description = ?, status_id = ?, priority = ?, assignee_username = ?, due_at = ?, position = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      (updates.title ?? task.title).trim(),
      (updates.description ?? task.description ?? '').trim(),
      nextStatusId,
      updates.priority || task.priority,
      updates.assigneeUsername === '' ? null : (updates.assigneeUsername ?? task.assignee_username),
      updates.dueAt === '' ? null : (updates.dueAt ?? task.due_at),
      nextPosition,
      Date.now(),
      taskId
    );
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-archive', ({ taskId, username }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    db.prepare('UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), taskId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-checklist-add', ({ taskId, username, text }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (!text || !text.trim()) return emitProjectError(socket, 'Checklist text is required');

    const orderIndex = db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_index FROM task_checklist_items WHERE task_id = ?').get(taskId).next_index;
    db.prepare('INSERT INTO task_checklist_items (id, task_id, text, completed, order_index) VALUES (?, ?, ?, 0, ?)').run(
      randomId('chk_'),
      taskId,
      text.trim(),
      orderIndex
    );
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-checklist-update', ({ taskId, itemId, username, text, completed }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    const current = db.prepare('SELECT * FROM task_checklist_items WHERE id = ? AND task_id = ?').get(itemId, taskId);
    if (!current) return emitProjectError(socket, 'Checklist item not found');

    db.prepare('UPDATE task_checklist_items SET text = ?, completed = ? WHERE id = ? AND task_id = ?').run(
      text?.trim() || current.text,
      completed == null ? current.completed : (completed ? 1 : 0),
      itemId,
      taskId
    );
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-checklist-delete', ({ taskId, itemId, username }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    db.prepare('DELETE FROM task_checklist_items WHERE id = ? AND task_id = ?').run(itemId, taskId);
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-comment-add', ({ taskId, username, body }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor', 'project_viewer']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (!body || !body.trim()) return emitProjectError(socket, 'Comment body is required');

    const now = Date.now();
    db.prepare(
      'INSERT INTO task_comments (id, task_id, author_username, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(randomId('cmt_'), taskId, username, body.trim(), now, now);
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(now, taskId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-attachment-upload', ({ taskId, username, attachment }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor']);
    if (!permission.ok) return emitProjectError(socket, permission.error);
    if (!attachment?.name || !attachment?.data) return emitProjectError(socket, 'Attachment payload is invalid');

    db.prepare(
      'INSERT INTO task_attachments (id, task_id, sender, name, type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      randomId('att_'),
      taskId,
      username,
      attachment.name,
      attachment.type || 'application/octet-stream',
      attachment.size || 0,
      attachment.data,
      Date.now()
    );
    db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(Date.now(), taskId);
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(Date.now(), task.project_id);
    emitProjectsChanged(permission.project.room_id, task.project_id);
  });

  socket.on('task-attachment-get', ({ taskId, attachmentId, username }) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL').get(taskId);
    if (!task) return emitProjectError(socket, 'Task not found');

    const permission = requireProjectRole(task.project_id, username, ['project_owner', 'project_editor', 'project_viewer']);
    if (!permission.ok) return emitProjectError(socket, permission.error);

    const attachment = db.prepare('SELECT * FROM task_attachments WHERE id = ? AND task_id = ?').get(attachmentId, taskId);
    if (!attachment) return emitProjectError(socket, 'Attachment not found');

    socket.emit('task-attachment-data', {
      taskId,
      attachmentId,
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      data: attachment.data,
    });
  });

  socket.on('webrtc-offer', (data) => {
    socket.to(data.targetSocketId).emit('webrtc-offer', { senderSocketId: socket.id, offer: data.offer });
  });

  socket.on('webrtc-answer', (data) => {
    socket.to(data.targetSocketId).emit('webrtc-answer', { senderSocketId: socket.id, answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetSocketId).emit('ice-candidate', { senderSocketId: socket.id, candidate: data.candidate });
  });

  socket.on('speaking-update', (data) => {
    socket.to(data.roomId).emit('speaking-update', { username: data.username, isSpeaking: data.isSpeaking });
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      socket.to(user.roomId).emit('user-left', { socketId: socket.id, username: user.username });
      onlineUsers.delete(socket.id);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Signaling server running on port ${PORT}`));
