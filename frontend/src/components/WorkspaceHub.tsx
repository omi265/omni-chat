'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { getSocket } from '../lib/socket';

type NodeType = 'page' | 'project_page' | 'database';
type PropertyType = 'text' | 'number' | 'checkbox' | 'select' | 'multi_select' | 'date' | 'person' | 'status' | 'relation';
type Priority = 'low' | 'medium' | 'high' | 'urgent';
type ProjectRole = 'project_owner' | 'project_editor' | 'project_viewer';

interface WorkspaceHubProps {
  roomId: string;
  username: string;
  workspaceReady: boolean;
}

interface WorkspaceNode {
  id: string;
  roomId: string;
  parentId: string | null;
  nodeType: NodeType;
  title: string;
  icon?: string | null;
  description: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

interface PageBlock {
  id: string;
  blockType: string;
  content: string;
  orderIndex: number;
}

interface Backlink {
  sourceNodeId: string;
  sourceRecordId?: string | null;
  targetType: string;
}

interface PageDetail extends WorkspaceNode {
  blocks: PageBlock[];
  backlinks: Backlink[];
  childNodes: WorkspaceNode[];
}

interface WorkspaceMember {
  username: string;
  role: string;
  avatarColor?: string | null;
  avatarUrl?: string | null;
}

interface ProjectMember {
  username: string;
  role: ProjectRole;
  avatarColor?: string | null;
  avatarUrl?: string | null;
}

interface ProjectStatus {
  id: string;
  name: string;
  color: string;
  orderIndex: number;
}

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  orderIndex: number;
}

interface TaskComment {
  id: string;
  authorUsername: string;
  body: string;
  createdAt: number;
  updatedAt: number;
  avatarColor?: string | null;
  avatarUrl?: string | null;
}

interface TaskAttachment {
  id: string;
  sender: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

interface ProjectTask {
  id: string;
  projectId: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  createdBy: string;
  assigneeUsername: string | null;
  dueAt: number | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  checklist: ChecklistItem[];
  comments: TaskComment[];
  attachments: TaskAttachment[];
}

interface ProjectDetail {
  id: string;
  roomId: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  role: ProjectRole;
  members: ProjectMember[];
  statuses: ProjectStatus[];
  tasks: ProjectTask[];
}

interface ProjectPageDetail extends PageDetail {
  project: ProjectDetail | null;
  taskDatabaseNodeId: string;
}

interface DatabaseProperty {
  id: string;
  name: string;
  propertyType: PropertyType;
}

interface DatabaseRecord {
  id: string;
  title: string;
  values: Record<string, unknown>;
}

interface DatabaseView {
  id: string;
  name: string;
  viewType: string;
}

interface DatabaseDetail extends WorkspaceNode {
  properties: DatabaseProperty[];
  records: DatabaseRecord[];
  views: DatabaseView[];
  backlinks: Backlink[];
}

interface TaskDraft {
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeUsername: string;
  dueAt: string;
}

interface CreateModalState {
  kind: 'page' | 'database' | 'project' | null;
  parentId: string | null;
}

const priorityClasses: Record<Priority, string> = {
  low: 'bg-slate-500/20 text-slate-200',
  medium: 'bg-blue-500/20 text-blue-200',
  high: 'bg-orange-500/20 text-orange-200',
  urgent: 'bg-red-500/20 text-red-200',
};

const blockPlaceholders: Record<string, string> = {
  paragraph: 'Write something...',
  heading: 'Heading',
  checklist: 'Checklist item',
  quote: 'Callout or quote',
  code: 'Code snippet',
};

const toDateInputValue = (timestamp: number | null) => {
  if (!timestamp) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
};

const prettyValue = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const toAttachmentBytes = (payload: unknown): Uint8Array => {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload);
  if (payload && typeof payload === 'object' && 'data' in payload && Array.isArray((payload as { data: number[] }).data)) {
    return Uint8Array.from((payload as { data: number[] }).data);
  }
  return new Uint8Array();
};

const iconForNode = (nodeType: NodeType) => {
  if (nodeType === 'project_page') return '◫';
  if (nodeType === 'database') return '≣';
  return '•';
};

const IconButton = ({
  title,
  active = false,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    title={title}
    onClick={onClick}
    className={`flex h-8 w-8 items-center justify-center rounded-md border text-[#b5bac1] transition hover:border-[#3F4147] hover:bg-[#313338] hover:text-white ${
      active ? 'border-[#3F4147] bg-[#313338] text-white shadow-sm' : 'border-transparent'
    }`}
  >
    {children}
  </button>
);

export default function WorkspaceHub({ roomId, username, workspaceReady }: WorkspaceHubProps) {
  const socket = getSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<NodeType | null>(null);
  const [pageDetail, setPageDetail] = useState<PageDetail | null>(null);
  const [projectPageDetail, setProjectPageDetail] = useState<ProjectPageDetail | null>(null);
  const [databaseDetail, setDatabaseDetail] = useState<DatabaseDetail | null>(null);
  const [createModal, setCreateModal] = useState<CreateModalState>({ kind: null, parentId: null });
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<PropertyType>('text');
  const [newRecordTitle, setNewRecordTitle] = useState('');
  const [projectViewMode, setProjectViewMode] = useState<'board' | 'list'>('board');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [newTaskTitleByStatus, setNewTaskTitleByStatus] = useState<Record<string, string>>({});
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newComment, setNewComment] = useState('');
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#4f7cff');
  const [isManagingMembers, setIsManagingMembers] = useState(false);

  const requestTree = () => socket.emit('workspace-tree-request', { roomId, username });
  const requestMembers = () => socket.emit('workspace-get-members', { roomId, username });

  const openNode = (node: WorkspaceNode) => {
    setSelectedNodeId(node.id);
    setSelectedNodeType(node.nodeType);
    if (node.nodeType === 'database') {
      socket.emit('workspace-database-get', { roomId, nodeId: node.id, username });
      return;
    }
    if (node.nodeType === 'project_page') {
      socket.emit('workspace-project-page-get', { roomId, nodeId: node.id, username });
      return;
    }
    socket.emit('workspace-page-get', { roomId, nodeId: node.id, username });
  };

  useEffect(() => {
    if (!workspaceReady) return;

    requestTree();
    requestMembers();

    const onTree = (payload: { roomId: string; nodes: WorkspaceNode[] }) => {
      if (payload.roomId !== roomId) return;
      setNodes(payload.nodes);
    };

    const onWorkspaceChanged = (payload: { roomId: string; nodeId?: string | null }) => {
      if (payload.roomId !== roomId) return;
      requestTree();
      if (!selectedNodeId && !payload.nodeId) return;
      const refreshNodeId = payload.nodeId || selectedNodeId;
      if (!refreshNodeId) return;
      const type = payload.nodeId ? nodes.find((node) => node.id === payload.nodeId)?.nodeType || selectedNodeType : selectedNodeType;
      if (type === 'database') {
        socket.emit('workspace-database-get', { roomId, nodeId: refreshNodeId, username });
      } else if (type === 'project_page') {
        socket.emit('workspace-project-page-get', { roomId, nodeId: refreshNodeId, username });
      } else if (type === 'page') {
        socket.emit('workspace-page-get', { roomId, nodeId: refreshNodeId, username });
      }
    };

    const onPage = (payload: { roomId: string; page: PageDetail }) => {
      if (payload.roomId !== roomId) return;
      setPageDetail(payload.page);
      setProjectPageDetail(null);
      setDatabaseDetail(null);
      setSelectedNodeId(payload.page.id);
      setSelectedNodeType(payload.page.nodeType);
    };

    const onProjectPage = (payload: { roomId: string; projectPage: ProjectPageDetail }) => {
      if (payload.roomId !== roomId) return;
      setProjectPageDetail(payload.projectPage);
      setPageDetail(null);
      setDatabaseDetail(null);
      setSelectedNodeId(payload.projectPage.id);
      setSelectedNodeType('project_page');
    };

    const onDatabase = (payload: { roomId: string; database: DatabaseDetail }) => {
      if (payload.roomId !== roomId) return;
      setDatabaseDetail(payload.database);
      setPageDetail(null);
      setProjectPageDetail(null);
      setSelectedNodeId(payload.database.id);
      setSelectedNodeType('database');
    };

    const onMembers = (payload: { roomId: string; members: WorkspaceMember[] }) => {
      if (payload.roomId !== roomId) return;
      setWorkspaceMembers(payload.members);
    };

    const onProjectsChanged = (payload: { roomId: string; projectId?: string | null }) => {
      if (payload.roomId !== roomId) return;
      requestTree();
      requestMembers();
      if (selectedNodeType === 'project_page' && selectedNodeId) {
        socket.emit('workspace-project-page-get', { roomId, nodeId: selectedNodeId, username });
      }
    };

    const onWorkspaceError = (payload: { message: string }) => {
      setError(payload.message);
      window.setTimeout(() => setError(null), 4000);
    };

    const onProjectError = (payload: { message: string }) => {
      setError(payload.message);
      window.setTimeout(() => setError(null), 4000);
    };

    const onAttachmentData = (payload: { name: string; type: string; data: unknown }) => {
      const bytes = toAttachmentBytes(payload.data);
      const blob = new Blob([bytes as BlobPart], { type: payload.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.name;
      anchor.click();
      URL.revokeObjectURL(url);
    };

    socket.on('workspace-tree-data', onTree);
    socket.on('workspace-changed', onWorkspaceChanged);
    socket.on('workspace-page-data', onPage);
    socket.on('workspace-project-page-data', onProjectPage);
    socket.on('workspace-database-data', onDatabase);
    socket.on('workspace-members-data', onMembers);
    socket.on('projects-changed', onProjectsChanged);
    socket.on('workspace-error', onWorkspaceError);
    socket.on('project-error', onProjectError);
    socket.on('task-attachment-data', onAttachmentData);

    return () => {
      socket.off('workspace-tree-data', onTree);
      socket.off('workspace-changed', onWorkspaceChanged);
      socket.off('workspace-page-data', onPage);
      socket.off('workspace-project-page-data', onProjectPage);
      socket.off('workspace-database-data', onDatabase);
      socket.off('workspace-members-data', onMembers);
      socket.off('projects-changed', onProjectsChanged);
      socket.off('workspace-error', onWorkspaceError);
      socket.off('project-error', onProjectError);
      socket.off('task-attachment-data', onAttachmentData);
    };
  }, [workspaceReady, roomId, username, socket, selectedNodeId, selectedNodeType, nodes]);

  useEffect(() => {
    if (!workspaceReady || selectedNodeId || nodes.length === 0) return;
    const firstNode = nodes[0];
    openNode(firstNode);
  }, [workspaceReady, selectedNodeId, nodes]);

  useEffect(() => {
    const currentTask =
      projectPageDetail?.project?.tasks.find((task) => task.id === selectedTaskId) || null;
    if (!currentTask) {
      setTaskDraft(null);
      return;
    }

    setTaskDraft({
      title: currentTask.title,
      description: currentTask.description,
      statusId: currentTask.statusId,
      priority: currentTask.priority,
      assigneeUsername: currentTask.assigneeUsername || '',
      dueAt: toDateInputValue(currentTask.dueAt),
    });
  }, [projectPageDetail, selectedTaskId]);

  const rootNodes = useMemo(() => nodes.filter((node) => !node.parentId), [nodes]);
  const childMap = useMemo(() => {
    const map = new Map<string, WorkspaceNode[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const bucket = map.get(node.parentId) || [];
      bucket.push(node);
      map.set(node.parentId, bucket);
    }
    for (const entry of map.values()) {
      entry.sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title));
    }
    return map;
  }, [nodes]);

  const projectNodes = useMemo(() => rootNodes.filter((node) => node.nodeType === 'project_page'), [rootNodes]);
  const pageNodes = useMemo(() => rootNodes.filter((node) => node.nodeType === 'page'), [rootNodes]);
  const databaseNodes = useMemo(() => rootNodes.filter((node) => node.nodeType === 'database'), [rootNodes]);

  const statusesWithTasks = useMemo(() => {
    const project = projectPageDetail?.project;
    if (!project) return [];
    return project.statuses.map((status) => ({
      ...status,
      tasks: project.tasks
        .filter((task) => task.statusId === status.id)
        .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),
    }));
  }, [projectPageDetail]);

  const currentTask = useMemo(
    () => projectPageDetail?.project?.tasks.find((task) => task.id === selectedTaskId) || null,
    [projectPageDetail, selectedTaskId]
  );

  const canEditProject =
    projectPageDetail?.project?.role === 'project_owner' || projectPageDetail?.project?.role === 'project_editor';
  const canManageProject = projectPageDetail?.project?.role === 'project_owner';

  const openCreateModal = (kind: 'page' | 'database' | 'project', parentId: string | null = null) => {
    setCreateModal({ kind, parentId });
    setNewTitle('');
    setNewDescription('');
  };

  const createNode = () => {
    if (!createModal.kind || !newTitle.trim()) return;

    if (createModal.kind === 'project') {
      socket.emit(
        'workspace-project-create',
        {
          roomId,
          username,
          title: newTitle,
          description: newDescription,
        },
        (response: { ok: boolean; nodeId?: string; message?: string }) => {
          if (!response.ok || !response.nodeId) {
            setError(response.message || 'Failed to create project');
            return;
          }
          setCreateModal({ kind: null, parentId: null });
          const nextNode = nodes.find((node) => node.id === response.nodeId) || {
            id: response.nodeId,
            roomId,
            parentId: null,
            nodeType: 'project_page' as NodeType,
            title: newTitle.trim(),
            description: newDescription.trim(),
            createdBy: username,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          openNode(nextNode);
        }
      );
      return;
    }

    socket.emit(
      'workspace-node-create',
      {
        roomId,
        username,
        parentId: createModal.parentId,
        nodeType: createModal.kind,
        title: newTitle,
        description: newDescription,
      },
      (response: { ok: boolean; nodeId?: string; message?: string }) => {
        if (!response.ok || !response.nodeId) {
          setError(response.message || 'Failed to create item');
          return;
        }
        setCreateModal({ kind: null, parentId: null });
        const nextNode = {
          id: response.nodeId,
          roomId,
          parentId: createModal.parentId,
          nodeType: createModal.kind as NodeType,
          title: newTitle.trim(),
          description: newDescription.trim(),
          createdBy: username,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        openNode(nextNode);
      }
    );
  };

  const savePageMeta = (page: PageDetail | ProjectPageDetail) => {
    if (page.nodeType === 'project_page' && projectPageDetail?.project) {
      socket.emit('project-update', {
        projectId: projectPageDetail.project.id,
        username,
        name: page.title,
        description: page.description,
      });
      return;
    }

    socket.emit('workspace-page-update', {
      nodeId: page.id,
      username,
      title: page.title,
      description: page.description,
    });
  };

  const saveBlock = (page: PageDetail | ProjectPageDetail, block: PageBlock, nextContent: string) => {
    socket.emit('workspace-page-block-upsert', {
      nodeId: page.id,
      username,
      blockId: block.id,
      blockType: block.blockType,
      content: nextContent,
      orderIndex: block.orderIndex,
    });
  };

  const addBlock = (page: PageDetail | ProjectPageDetail, blockType: string) => {
    socket.emit('workspace-page-block-upsert', {
      nodeId: page.id,
      username,
      blockType,
      content: '',
      orderIndex: page.blocks.length,
    });
  };

  const saveDatabaseMeta = () => {
    if (!databaseDetail) return;
    socket.emit('workspace-database-update', {
      nodeId: databaseDetail.id,
      username,
      title: databaseDetail.title,
      description: databaseDetail.description,
    });
  };

  const addProperty = () => {
    if (!databaseDetail || !newPropertyName.trim()) return;
    socket.emit('workspace-database-property-create', {
      nodeId: databaseDetail.id,
      username,
      name: newPropertyName,
      propertyType: newPropertyType,
    });
    setNewPropertyName('');
    setNewPropertyType('text');
  };

  const addRecord = () => {
    if (!databaseDetail || !newRecordTitle.trim()) return;
    socket.emit('workspace-database-record-create', {
      nodeId: databaseDetail.id,
      username,
      title: newRecordTitle,
    });
    setNewRecordTitle('');
  };

  const updateRecord = (recordId: string, title: string, propertyId?: string, value?: unknown) => {
    if (!databaseDetail) return;
    socket.emit('workspace-database-record-update', {
      nodeId: databaseDetail.id,
      recordId,
      username,
      title,
      values: propertyId ? { [propertyId]: value } : undefined,
    });
  };

  const createTask = (statusId: string) => {
    if (!projectPageDetail?.project) return;
    const title = newTaskTitleByStatus[statusId]?.trim();
    if (!title) return;
    socket.emit('task-create', {
      projectId: projectPageDetail.project.id,
      username,
      title,
      statusId,
      priority: 'medium',
    });
    setNewTaskTitleByStatus((prev) => ({ ...prev, [statusId]: '' }));
  };

  const createStatus = () => {
    if (!projectPageDetail?.project || !newStatusName.trim()) return;
    socket.emit('project-status-create', {
      projectId: projectPageDetail.project.id,
      username,
      name: newStatusName,
      color: newStatusColor,
    });
    setNewStatusName('');
    setNewStatusColor('#4f7cff');
  };

  const saveTaskDraft = () => {
    if (!currentTask || !taskDraft) return;
    socket.emit('task-update', {
      taskId: currentTask.id,
      username,
      updates: {
        title: taskDraft.title,
        description: taskDraft.description,
        statusId: taskDraft.statusId,
        priority: taskDraft.priority,
        assigneeUsername: taskDraft.assigneeUsername,
        dueAt: taskDraft.dueAt ? new Date(taskDraft.dueAt).getTime() : '',
      },
    });
  };

  const addChecklistItem = () => {
    if (!currentTask || !newChecklistText.trim()) return;
    socket.emit('task-checklist-add', {
      taskId: currentTask.id,
      username,
      text: newChecklistText,
    });
    setNewChecklistText('');
  };

  const addComment = () => {
    if (!currentTask || !newComment.trim()) return;
    socket.emit('task-comment-add', {
      taskId: currentTask.id,
      username,
      body: newComment,
    });
    setNewComment('');
  };

  const updateMemberRole = (targetUsername: string, role: string) => {
    if (!projectPageDetail?.project) return;
    if (!role) {
      socket.emit('project-member-remove', { projectId: projectPageDetail.project.id, username, targetUsername });
      return;
    }
    socket.emit('project-member-set', {
      projectId: projectPageDetail.project.id,
      username,
      targetUsername,
      role,
    });
  };

  const uploadAttachment = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentTask) return;
    const buffer = await file.arrayBuffer();
    socket.emit('task-attachment-upload', {
      taskId: currentTask.id,
      username,
      attachment: {
        name: file.name,
        type: file.type,
        size: file.size,
        data: new Uint8Array(buffer),
      },
    });
    event.target.value = '';
  };

  const renderTree = (items: WorkspaceNode[], depth = 0): React.ReactNode =>
    items.map((node) => {
      const children = childMap.get(node.id) || [];
      return (
        <div key={node.id}>
          <button
            onClick={() => openNode(node)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
              selectedNodeId === node.id
                ? 'bg-[#3F4147] text-white shadow-sm'
                : 'text-[#b5bac1] hover:bg-[#313338] hover:text-white'
            }`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <span className="w-4 text-center text-[#949ba4]">{node.icon || iconForNode(node.nodeType)}</span>
            <span className="truncate">{node.title}</span>
            {node.nodeType === 'project_page' && (
              <span className="ml-auto rounded-full bg-[#1E1F22] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#949ba4]">
                Project
              </span>
            )}
          </button>
          {children.length > 0 && <div className="mt-0.5 space-y-0.5">{renderTree(children, depth + 1)}</div>}
        </div>
      );
    });

  if (!workspaceReady) {
    return (
      <div className="flex h-full items-center justify-center bg-[#313338] text-[#b5bac1]">
        <div className="rounded-xl border border-[#1E1F22] bg-[#2B2D31] px-6 py-5 text-sm shadow-sm">
          Preparing workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#313338] text-gray-200">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-[#1E1F22] bg-[#232428]">
        <div className="border-b border-[#1E1F22] px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#949ba4]">Workspace</div>
              <div className="mt-1 text-lg font-semibold text-white">Omni</div>
            </div>
            <div className="flex items-center gap-1">
              <IconButton title="New Page" onClick={() => openCreateModal('page')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14M5 12h14" /></svg>
              </IconButton>
              <IconButton title="New Project" onClick={() => openCreateModal('project')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 7h16M7 4v6m10-6v6M5 11h14v8H5z" /></svg>
              </IconButton>
              <IconButton title="New Database" onClick={() => openCreateModal('database')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3" strokeWidth="1.8" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6m-14 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></svg>
              </IconButton>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-[#1E1F22] bg-[#2B2D31] px-3 py-2 text-xs leading-relaxed text-[#b5bac1]">
            Projects, pages, and databases now live in one tree. Each project opens as a page with its task board embedded below.
          </div>
        </div>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="space-y-6">
            <div>
              <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Projects</div>
              <div className="space-y-1">{renderTree(projectNodes)}</div>
              {!projectNodes.length && <div className="px-2 text-sm text-[#949ba4]">No projects yet.</div>}
            </div>

            <div>
              <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Pages</div>
              <div className="space-y-1">{renderTree(pageNodes)}</div>
              {!pageNodes.length && <div className="px-2 text-sm text-[#949ba4]">No standalone pages.</div>}
            </div>

            <div>
              <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Databases</div>
              <div className="space-y-1">{renderTree(databaseNodes)}</div>
              {!databaseNodes.length && <div className="px-2 text-sm text-[#949ba4]">No standalone databases.</div>}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#313338]">
        <div className="border-b border-[#1E1F22] bg-[#2B2D31]/95 px-8 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Unified Workspace</div>
              <div className="mt-1 truncate text-sm text-[#b5bac1]">
                {selectedNodeType === 'project_page'
                  ? 'Project page'
                  : selectedNodeType === 'database'
                    ? 'Object database'
                    : selectedNodeType === 'page'
                      ? 'Document page'
                      : 'Select a page, database, or project'}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {selectedNodeType === 'project_page' && selectedNodeId && (
                <IconButton title="New Subpage" onClick={() => openCreateModal('page', selectedNodeId)}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 7h8M8 12h8M8 17h5M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z" /></svg>
                </IconButton>
              )}
              <IconButton title="Refresh" onClick={() => { requestTree(); requestMembers(); selectedNodeId && selectedNodeType && openNode(nodes.find((node) => node.id === selectedNodeId) || { id: selectedNodeId, roomId, parentId: null, nodeType: selectedNodeType, title: '', description: '', createdBy: username, createdAt: 0, updatedAt: 0 }); }}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 4v6h6M20 20v-6h-6M20 9a8 8 0 00-14.85-3M4 15a8 8 0 0014.85 3" /></svg>
              </IconButton>
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {!selectedNodeType && (
            <div className="flex h-full items-center justify-center px-8">
              <div className="max-w-xl rounded-[28px] border border-[#1E1F22] bg-[#2B2D31] px-10 py-12 text-center shadow-2xl">
                <div className="text-[11px] uppercase tracking-[0.24em] text-[#949ba4]">Workspace Canvas</div>
                <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">Build pages, trackers, and project homes in one place.</h1>
                <p className="mt-4 text-base leading-7 text-[#b5bac1]">
                  Create a project to get an overview page, a default Notes and Decisions structure, and an embedded kanban board without leaving the sidebar tree.
                </p>
                <div className="mt-8 flex justify-center gap-3">
                  <button
                    onClick={() => openCreateModal('project')}
                    className="rounded-full bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-600"
                  >
                    New Project
                  </button>
                  <button
                    onClick={() => openCreateModal('page')}
                    className="rounded-full border border-[#3F4147] bg-[#313338] px-5 py-2.5 text-sm font-semibold text-[#dbdee1] transition hover:bg-[#3F4147]"
                  >
                    New Page
                  </button>
                </div>
              </div>
            </div>
          )}

          {pageDetail && selectedNodeType === 'page' && (
            <section className="mx-auto w-full max-w-5xl px-8 py-10">
              <div className="mb-8">
                <input
                  value={pageDetail.title}
                  onChange={(event) => setPageDetail((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                  onBlur={() => pageDetail && savePageMeta(pageDetail)}
                  className="w-full border-none bg-transparent px-0 text-5xl font-semibold tracking-tight text-white focus:outline-none"
                />
                <textarea
                  value={pageDetail.description}
                  onChange={(event) => setPageDetail((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                  onBlur={() => pageDetail && savePageMeta(pageDetail)}
                  rows={2}
                  className="mt-3 w-full resize-none border-none bg-transparent px-0 text-base leading-7 text-[#b5bac1] focus:outline-none"
                  placeholder="Describe this page..."
                />
              </div>

              <div className="space-y-4">
                {pageDetail.blocks.map((block) => (
                  <textarea
                    key={block.id}
                    value={block.content}
                    onChange={(event) =>
                      setPageDetail((prev) =>
                        prev
                          ? {
                              ...prev,
                              blocks: prev.blocks.map((entry) =>
                                entry.id === block.id ? { ...entry, content: event.target.value } : entry
                              ),
                            }
                          : prev
                      )
                    }
                    onBlur={(event) => saveBlock(pageDetail, block, event.target.value)}
                    rows={block.blockType === 'heading' ? 2 : 4}
                    className={`w-full resize-none rounded-2xl border border-transparent bg-transparent px-4 py-3 transition focus:border-[#3F4147] focus:bg-[#2B2D31] focus:outline-none ${
                      block.blockType === 'heading' ? 'text-2xl font-semibold text-white' : 'text-base leading-7 text-[#dbdee1]'
                    }`}
                    placeholder={blockPlaceholders[block.blockType] || 'Write...'}
                  />
                ))}
              </div>

              <div className="mt-8 flex flex-wrap gap-2">
                {['paragraph', 'heading', 'checklist', 'quote', 'code'].map((blockType) => (
                  <button
                    key={blockType}
                    onClick={() => addBlock(pageDetail, blockType)}
                    className="rounded-full border border-[#3F4147] bg-[#2B2D31] px-3 py-1.5 text-sm text-[#b5bac1] transition hover:bg-[#3F4147] hover:text-white"
                  >
                    Add {blockType}
                  </button>
                ))}
              </div>
            </section>
          )}

          {projectPageDetail && projectPageDetail.project && selectedNodeType === 'project_page' && (
            <section className="mx-auto w-full max-w-6xl px-8 py-10">
              <div className="mb-8">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Project</div>
                <input
                  value={projectPageDetail.title}
                  onChange={(event) =>
                    setProjectPageDetail((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                  }
                  onBlur={() => projectPageDetail && savePageMeta(projectPageDetail)}
                  className="mt-3 w-full border-none bg-transparent px-0 text-5xl font-semibold tracking-tight text-white focus:outline-none"
                />
                <textarea
                  value={projectPageDetail.description}
                  onChange={(event) =>
                    setProjectPageDetail((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                  }
                  onBlur={() => projectPageDetail && savePageMeta(projectPageDetail)}
                  rows={2}
                  className="mt-3 w-full resize-none border-none bg-transparent px-0 text-base leading-7 text-[#b5bac1] focus:outline-none"
                  placeholder="Describe the project..."
                />
              </div>

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-5">
                  <section className="rounded-[24px] border border-[#1E1F22] bg-[#2B2D31] p-6 shadow-xl">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Overview</div>
                        <h2 className="mt-2 text-xl font-semibold text-white">Project home</h2>
                        <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
                          This project is a page-backed workspace with subpages and a linked task database.
                        </p>
                      </div>
                      {canManageProject && (
                        <button
                          onClick={() => setIsManagingMembers(true)}
                          className="rounded-full border border-[#3F4147] px-3 py-1.5 text-sm font-medium text-[#dbdee1] transition hover:bg-[#313338]"
                        >
                          Manage Access
                        </button>
                      )}
                    </div>

                    <div className="mt-6 grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl bg-[#232428] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#949ba4]">Members</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{projectPageDetail.project.members.length}</div>
                      </div>
                      <div className="rounded-2xl bg-[#232428] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#949ba4]">Tasks</div>
                        <div className="mt-2 text-2xl font-semibold text-white">{projectPageDetail.project.tasks.length}</div>
                      </div>
                      <div className="rounded-2xl bg-[#232428] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#949ba4]">Linked DB</div>
                        <div className="mt-2 truncate text-sm font-medium text-[#dbdee1]">{projectPageDetail.taskDatabaseNodeId}</div>
                      </div>
                    </div>

                    <div className="mt-6 space-y-3">
                      {projectPageDetail.blocks.map((block) => (
                        <textarea
                          key={block.id}
                          value={block.content}
                          onChange={(event) =>
                            setProjectPageDetail((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    blocks: prev.blocks.map((entry) =>
                                      entry.id === block.id ? { ...entry, content: event.target.value } : entry
                                    ),
                                  }
                                : prev
                            )
                          }
                          onBlur={(event) => saveBlock(projectPageDetail, block, event.target.value)}
                          rows={block.blockType === 'heading' ? 2 : 4}
                          className="w-full resize-none rounded-2xl border border-transparent bg-[#232428] px-4 py-3 text-base leading-7 text-[#dbdee1] transition focus:border-[#3F4147] focus:bg-[#313338] focus:outline-none"
                          placeholder={blockPlaceholders[block.blockType] || 'Write...'}
                        />
                      ))}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {['paragraph', 'heading', 'checklist', 'quote'].map((blockType) => (
                        <button
                          key={blockType}
                          onClick={() => addBlock(projectPageDetail, blockType)}
                          className="rounded-full border border-[#3F4147] bg-[#232428] px-3 py-1.5 text-sm text-[#b5bac1] transition hover:bg-[#313338] hover:text-white"
                        >
                          Add {blockType}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-[24px] border border-[#1E1F22] bg-[#2B2D31] p-6 shadow-xl">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Project Management</div>
                        <h2 className="mt-2 text-xl font-semibold text-white">Task board</h2>
                        <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
                          Every project ships with a default kanban board and list view.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setProjectViewMode('board')}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                            projectViewMode === 'board' ? 'bg-indigo-500 text-white' : 'bg-[#232428] text-[#b5bac1]'
                          }`}
                        >
                          Board
                        </button>
                        <button
                          onClick={() => setProjectViewMode('list')}
                          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                            projectViewMode === 'list' ? 'bg-indigo-500 text-white' : 'bg-[#232428] text-[#b5bac1]'
                          }`}
                        >
                          List
                        </button>
                      </div>
                    </div>

                    {projectViewMode === 'board' ? (
                      <div className="mt-6 flex gap-4 overflow-x-auto overflow-y-hidden pb-2">
                        {statusesWithTasks.map((status) => (
                          <section key={status.id} className="flex h-full min-h-0 w-[310px] shrink-0 flex-col rounded-[22px] border border-[#1E1F22] bg-[#232428] p-4">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} />
                              <div className="font-semibold text-white">{status.name}</div>
                              <span className="rounded-full bg-[#1E1F22] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#949ba4]">
                                {status.tasks.length}
                              </span>
                            </div>

                            {canEditProject && (
                              <div className="mt-4 space-y-2">
                                <input
                                  value={newTaskTitleByStatus[status.id] || ''}
                                  onChange={(event) =>
                                    setNewTaskTitleByStatus((prev) => ({ ...prev, [status.id]: event.target.value }))
                                  }
                                  placeholder="Quick add task"
                                  className="w-full rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                                />
                                <button
                                  onClick={() => createTask(status.id)}
                                  className="w-full rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                                >
                                  Add task
                                </button>
                              </div>
                            )}

                            <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
                              {status.tasks.map((task) => (
                                <button
                                  key={task.id}
                                  onClick={() => setSelectedTaskId(task.id)}
                                  className="w-full rounded-[18px] border border-[#3F4147] bg-[#2B2D31] p-3 text-left transition hover:border-indigo-400 hover:bg-[#313338]"
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="font-medium text-white">{task.title}</div>
                                    <span className={`rounded-full px-2 py-1 text-[10px] uppercase ${priorityClasses[task.priority]}`}>
                                      {task.priority}
                                    </span>
                                  </div>
                                  {task.description && (
                                    <div className="mt-2 line-clamp-3 text-xs leading-5 text-[#b5bac1]">{task.description}</div>
                                  )}
                                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#949ba4]">
                                    {task.assigneeUsername && <span>@{task.assigneeUsername}</span>}
                                    {task.dueAt && <span>{new Date(task.dueAt).toLocaleDateString()}</span>}
                                    <span>{task.comments.length} comments</span>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </section>
                        ))}

                        {canEditProject && (
                          <section className="w-[260px] shrink-0 rounded-[22px] border border-dashed border-[#3F4147] bg-[#232428] p-4">
                            <div className="font-semibold text-white">New column</div>
                            <div className="mt-3 space-y-2">
                              <input
                                value={newStatusName}
                                onChange={(event) => setNewStatusName(event.target.value)}
                                placeholder="Status name"
                                className="w-full rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                              />
                              <input
                                type="color"
                                value={newStatusColor}
                                onChange={(event) => setNewStatusColor(event.target.value)}
                                className="h-10 w-full rounded-xl border border-[#3F4147] bg-[#313338] px-2"
                              />
                              <button
                                onClick={createStatus}
                                className="w-full rounded-xl bg-indigo-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                              >
                                Create column
                              </button>
                            </div>
                          </section>
                        )}
                      </div>
                    ) : (
                      <div className="mt-6 overflow-hidden rounded-[20px] border border-[#1E1F22]">
                        <table className="min-w-full divide-y divide-[#ebe3d6] text-left">
                          <thead className="bg-[#232428] text-xs uppercase tracking-[0.18em] text-[#949ba4]">
                            <tr>
                              <th className="px-4 py-3">Task</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3">Assignee</th>
                              <th className="px-4 py-3">Due</th>
                              <th className="px-4 py-3">Priority</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1E1F22] bg-[#2B2D31]">
                            {projectPageDetail.project.tasks.map((task) => (
                              <tr key={task.id} onClick={() => setSelectedTaskId(task.id)} className="cursor-pointer transition hover:bg-[#313338]">
                                <td className="px-4 py-4">
                                  <div className="font-medium text-white">{task.title}</div>
                                  {task.description && <div className="mt-1 text-xs text-[#b5bac1]">{task.description}</div>}
                                </td>
                                <td className="px-4 py-4 text-sm text-[#b5bac1]">
                                  {projectPageDetail.project?.statuses.find((status) => status.id === task.statusId)?.name || 'Unknown'}
                                </td>
                                <td className="px-4 py-4 text-sm text-[#b5bac1]">{task.assigneeUsername || 'Unassigned'}</td>
                                <td className="px-4 py-4 text-sm text-[#b5bac1]">
                                  {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No date'}
                                </td>
                                <td className="px-4 py-4">
                                  <span className={`rounded-full px-2 py-1 text-[10px] uppercase ${priorityClasses[task.priority]}`}>
                                    {task.priority}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>

                <aside className="space-y-5">
                  <section className="rounded-[24px] border border-[#1E1F22] bg-[#2B2D31] p-5 shadow-xl">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Subpages</div>
                    <div className="mt-4 space-y-2">
                      {projectPageDetail.childNodes
                        .filter((child) => child.nodeType !== 'database')
                        .map((child) => (
                          <button
                            key={child.id}
                            onClick={() => openNode(child)}
                            className="flex w-full items-center gap-2 rounded-xl bg-[#232428] px-3 py-2 text-left text-sm text-[#dbdee1] transition hover:bg-[#313338]"
                          >
                            <span className="w-4 text-center text-[#949ba4]">{child.icon || iconForNode(child.nodeType)}</span>
                            <span className="truncate">{child.title}</span>
                          </button>
                        ))}
                    </div>
                    <button
                      onClick={() => openCreateModal('page', projectPageDetail.id)}
                      className="mt-4 w-full rounded-xl border border-[#3F4147] px-3 py-2 text-sm font-medium text-[#dbdee1] transition hover:bg-[#313338]"
                    >
                      New subpage
                    </button>
                  </section>

                  <section className="rounded-[24px] border border-[#1E1F22] bg-[#2B2D31] p-5 shadow-xl">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Team</div>
                    <div className="mt-4 space-y-3">
                      {projectPageDetail.project.members.map((member) => (
                        <div key={member.username} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-white">{member.username}</div>
                            <div className="text-xs text-[#949ba4]">{member.role.replace('project_', '')}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </aside>
              </div>
            </section>
          )}

          {databaseDetail && selectedNodeType === 'database' && (
            <section className="mx-auto w-full max-w-6xl px-8 py-10">
              <div className="mb-8">
                <input
                  value={databaseDetail.title}
                  onChange={(event) =>
                    setDatabaseDetail((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                  }
                  onBlur={saveDatabaseMeta}
                  className="w-full border-none bg-transparent px-0 text-5xl font-semibold tracking-tight text-[#1e1a14] focus:outline-none"
                />
                <textarea
                  value={databaseDetail.description}
                  onChange={(event) =>
                    setDatabaseDetail((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                  }
                  onBlur={saveDatabaseMeta}
                  rows={2}
                  className="mt-3 w-full resize-none border-none bg-transparent px-0 text-base leading-7 text-[#746b61] focus:outline-none"
                  placeholder="Describe this database..."
                />
              </div>

              <div className="rounded-[24px] border border-[#1E1F22] bg-[#2B2D31] p-6 shadow-xl">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Schema</div>
                    <div className="mt-2 text-lg font-semibold text-white">Properties and records</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={newPropertyName}
                      onChange={(event) => setNewPropertyName(event.target.value)}
                      placeholder="New property"
                      className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                    />
                    <select
                      value={newPropertyType}
                      onChange={(event) => setNewPropertyType(event.target.value as PropertyType)}
                      className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="checkbox">Checkbox</option>
                      <option value="select">Select</option>
                      <option value="multi_select">Multi Select</option>
                      <option value="date">Date</option>
                      <option value="person">Person</option>
                      <option value="status">Status</option>
                      <option value="relation">Relation</option>
                    </select>
                    <button
                      onClick={addProperty}
                      className="rounded-xl bg-indigo-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                    >
                      Add property
                    </button>
                  </div>
                </div>

                <div className="mt-6 overflow-hidden rounded-[20px] border border-[#1E1F22]">
                  <table className="min-w-full divide-y divide-[#1E1F22] text-left">
                    <thead className="bg-[#232428] text-xs uppercase tracking-[0.18em] text-[#949ba4]">
                      <tr>
                        <th className="px-4 py-3">Title</th>
                        {databaseDetail.properties.map((property) => (
                          <th key={property.id} className="px-4 py-3">
                            {property.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E1F22] bg-[#2B2D31]">
                      {databaseDetail.records.map((record) => (
                        <tr key={record.id}>
                          <td className="px-4 py-3">
                            <input
                              value={record.title}
                              onChange={(event) =>
                                setDatabaseDetail((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        records: prev.records.map((entry) =>
                                          entry.id === record.id ? { ...entry, title: event.target.value } : entry
                                        ),
                                      }
                                    : prev
                                )
                              }
                              onBlur={(event) => updateRecord(record.id, event.target.value)}
                              className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-white outline-none transition focus:border-[#3F4147] focus:bg-[#313338]"
                            />
                          </td>
                          {databaseDetail.properties.map((property) => (
                            <td key={property.id} className="px-4 py-3">
                              <input
                                value={prettyValue(record.values[property.id])}
                                onChange={(event) =>
                                  setDatabaseDetail((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          records: prev.records.map((entry) =>
                                            entry.id === record.id
                                              ? {
                                                  ...entry,
                                                  values: { ...entry.values, [property.id]: event.target.value },
                                                }
                                              : entry
                                          ),
                                        }
                                      : prev
                                  )
                                }
                                onBlur={(event) => updateRecord(record.id, record.title, property.id, event.target.value)}
                                className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-[#b5bac1] outline-none transition focus:border-[#3F4147] focus:bg-[#313338]"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex gap-2">
                  <input
                    value={newRecordTitle}
                    onChange={(event) => setNewRecordTitle(event.target.value)}
                    placeholder="New record title"
                    className="flex-1 rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                  />
                  <button
                    onClick={addRecord}
                    className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                  >
                    Add record
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {createModal.kind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-[#1E1F22] bg-[#313338] p-6 shadow-2xl">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">
              {createModal.kind === 'project' ? 'New Project' : createModal.kind === 'database' ? 'New Database' : 'New Page'}
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              {createModal.kind === 'project'
                ? 'Create a project home with a built-in task board'
                : createModal.kind === 'database'
                  ? 'Create a reusable object database'
                  : 'Create a new page'}
            </h2>

            <div className="mt-5 space-y-4">
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={createModal.kind === 'project' ? 'Project name' : createModal.kind === 'database' ? 'Database name' : 'Page title'}
                className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
              />
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                rows={4}
                placeholder="Description"
                className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
              />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setCreateModal({ kind: null, parentId: null })}
                className="rounded-full px-4 py-2 text-sm font-medium text-[#b5bac1] transition hover:bg-[#3F4147] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={createNode}
                className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {isManagingMembers && projectPageDetail?.project && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-[28px] border border-[#1E1F22] bg-[#313338] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Project Access</div>
                <h2 className="mt-2 text-2xl font-semibold text-white">Manage project roles</h2>
              </div>
              <button onClick={() => setIsManagingMembers(false)} className="text-sm text-[#b5bac1] hover:text-white">
                Close
              </button>
            </div>

            <div className="mt-6 max-h-[60vh] space-y-3 overflow-y-auto">
              {workspaceMembers.map((member) => {
                const projectMembership = projectPageDetail.project?.members.find((entry) => entry.username === member.username);
                const effectiveRole = member.role === 'owner' ? 'project_owner' : projectMembership?.role || '';

                return (
                  <div key={member.username} className="flex items-center justify-between gap-4 rounded-2xl border border-[#1E1F22] bg-[#2B2D31] p-4">
                    <div>
                      <div className="font-medium text-white">{member.username}</div>
                      <div className="text-xs text-[#949ba4]">Workspace role: {member.role}</div>
                    </div>
                    <select
                      disabled={member.role === 'owner'}
                      value={effectiveRole}
                      onChange={(event) => updateMemberRole(member.username, event.target.value)}
                      className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none disabled:opacity-50"
                    >
                      <option value="">No access</option>
                      <option value="project_viewer">Viewer</option>
                      <option value="project_editor">Editor</option>
                      <option value="project_owner">Owner</option>
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {currentTask && taskDraft && projectPageDetail?.project && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/70">
          <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[#1E1F22] bg-[#313338] shadow-2xl">
            <div className="border-b border-[#1E1F22] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Task Detail</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">{currentTask.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {canEditProject && (
                    <button
                      onClick={() => socket.emit('task-archive', { taskId: currentTask.id, username })}
                      className="rounded-full border border-red-500/40 px-3 py-1.5 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedTaskId(null)}
                    className="rounded-full border border-[#3F4147] px-3 py-1.5 text-sm font-medium text-[#b5bac1] transition hover:bg-[#3F4147] hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">Title</label>
                  <input
                    value={taskDraft.title}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                    className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">Status</label>
                  <select
                    value={taskDraft.statusId}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, statusId: event.target.value } : prev))}
                    className="mt-2 w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  >
                    {projectPageDetail.project.statuses.map((status) => (
                      <option key={status.id} value={status.id}>{status.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">Priority</label>
                  <select
                    value={taskDraft.priority}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, priority: event.target.value as Priority } : prev))}
                    className="mt-2 w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">Assignee</label>
                  <select
                    value={taskDraft.assigneeUsername}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, assigneeUsername: event.target.value } : prev))}
                    className="mt-2 w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="">Unassigned</option>
                    {projectPageDetail.project.members.map((member) => (
                      <option key={member.username} value={member.username}>{member.username}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">Due Date</label>
                  <input
                    type="date"
                    value={taskDraft.dueAt}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, dueAt: event.target.value } : prev))}
                    className="mt-2 w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.18em] text-[#949ba4]">Description</label>
                  <textarea
                    value={taskDraft.description}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                    rows={5}
                    className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  />
                </div>
              </div>

              <button
                onClick={saveTaskDraft}
                className="mt-5 rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
              >
                Save changes
              </button>

              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <section className="rounded-[22px] border border-[#1E1F22] bg-[#2B2D31] p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Checklist</div>
                  <div className="mt-4 space-y-3">
                    {currentTask.checklist.map((item) => (
                      <label key={item.id} className="flex items-center gap-3 text-sm text-[#dbdee1]">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={(event) =>
                            socket.emit('task-checklist-update', {
                              taskId: currentTask.id,
                              itemId: item.id,
                              username,
                              completed: event.target.checked,
                            })
                          }
                        />
                        <span>{item.text}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <input
                      value={newChecklistText}
                      onChange={(event) => setNewChecklistText(event.target.value)}
                      placeholder="New checklist item"
                      className="flex-1 rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                    />
                    <button
                      onClick={addChecklistItem}
                      className="rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                    >
                      Add
                    </button>
                  </div>
                </section>

                <section className="rounded-[22px] border border-[#1E1F22] bg-[#2B2D31] p-5">
                  <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Attachments</div>
                  <div className="mt-4 space-y-2">
                    {currentTask.attachments.map((attachment) => (
                      <button
                        key={attachment.id}
                        onClick={() =>
                          socket.emit('task-attachment-download', {
                            taskId: currentTask.id,
                            attachmentId: attachment.id,
                            username,
                          })
                        }
                        className="flex w-full items-center justify-between rounded-xl bg-[#232428] px-3 py-2 text-left text-sm text-[#dbdee1] transition hover:bg-[#313338]"
                      >
                        <span className="truncate">{attachment.name}</span>
                        <span className="ml-3 text-xs text-[#949ba4]">{Math.round(attachment.size / 1024)} KB</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-4 rounded-xl border border-[#3F4147] px-3 py-2 text-sm font-medium text-[#dbdee1] transition hover:bg-[#313338]"
                  >
                    Upload file
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={uploadAttachment} />
                </section>
              </div>

              <section className="mt-6 rounded-[22px] border border-[#1E1F22] bg-[#2B2D31] p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Comments</div>
                <div className="mt-4 space-y-4">
                  {currentTask.comments.map((comment) => (
                    <div key={comment.id} className="rounded-xl bg-[#232428] px-4 py-3">
                      <div className="text-sm font-medium text-white">{comment.authorUsername}</div>
                      <div className="mt-1 text-sm leading-6 text-[#dbdee1]">{comment.body}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <textarea
                    value={newComment}
                    onChange={(event) => setNewComment(event.target.value)}
                    rows={3}
                    placeholder="Add a comment"
                    className="flex-1 rounded-2xl border border-[#3F4147] bg-[#313338] px-4 py-3 text-sm text-white outline-none transition focus:border-indigo-500"
                  />
                  <button
                    onClick={addComment}
                    className="self-end rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                  >
                    Post
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
