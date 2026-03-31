'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { getSocket } from '../lib/socket';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

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
  ancestors: WorkspaceNode[];
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
  config?: Record<string, unknown>;
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
  config?: Record<string, unknown>;
}

interface DatabaseDetail extends WorkspaceNode {
  properties: DatabaseProperty[];
  records: DatabaseRecord[];
  views: DatabaseView[];
  backlinks: Backlink[];
  project?: ProjectDetail | null;
  ancestors?: WorkspaceNode[];
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
  kind: 'page' | 'project' | null;
  parentId: string | null;
}

interface TrashNodeItem extends WorkspaceNode {
  archivedAt: number;
}

interface TrashProjectItem {
  id: string;
  roomId: string;
  title: string;
  description: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number;
  nodeType: 'project_page';
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
  callout: 'Helpful note or highlight',
  bulleted_list: 'Bullet list item',
  numbered_list: 'Numbered list item',
  divider: '',
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

const relationTargetLabel = (value: unknown, nodes: WorkspaceNode[]) => {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || !('targetNodeId' in entry)) return '';
      const targetId = String((entry as { targetNodeId?: unknown }).targetNodeId || '');
      return nodes.find((node) => node.id === targetId)?.title || targetId;
    })
    .filter(Boolean)
    .join(', ');
};

const parseChecklistContent = (content: string) => {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return {
        checked: Boolean((parsed as { checked?: unknown }).checked),
        text: String((parsed as { text?: unknown }).text || ''),
      };
    }
  } catch {}

  return {
    checked: false,
    text: content || '',
  };
};

const serializeChecklistContent = (checked: boolean, text: string) =>
  JSON.stringify({ checked, text });

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
  const [showTrash, setShowTrash] = useState(false);
  const [trashNodes, setTrashNodes] = useState<TrashNodeItem[]>([]);
  const [trashProjects, setTrashProjects] = useState<TrashProjectItem[]>([]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [pageParentId, setPageParentId] = useState<string>('standalone');
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
  const [selectedDatabaseViewId, setSelectedDatabaseViewId] = useState<string | null>(null);
  const [databaseSearch, setDatabaseSearch] = useState('');
  const [draggingTreeNodeId, setDraggingTreeNodeId] = useState<string | null>(null);

  const requestTree = () => socket.emit('workspace-tree-request', { roomId, username });
  const requestMembers = () => socket.emit('workspace-get-members', { roomId, username });
  const requestTrash = () => socket.emit('workspace-trash-request', { roomId, username });

  const clearSelection = () => {
    setSelectedNodeId(null);
    setSelectedNodeType(null);
    setPageDetail(null);
    setProjectPageDetail(null);
    setDatabaseDetail(null);
  };

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
    requestTrash();

    const onTree = (payload: { roomId: string; nodes: WorkspaceNode[] }) => {
      if (payload.roomId !== roomId) return;
      setNodes(payload.nodes);
    };

    const onWorkspaceChanged = (payload: { roomId: string; nodeId?: string | null }) => {
      if (payload.roomId !== roomId) return;
      requestTree();
      requestTrash();
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

    const onTrash = (payload: { roomId: string; nodes: TrashNodeItem[]; projects: TrashProjectItem[] }) => {
      if (payload.roomId !== roomId) return;
      setTrashNodes(payload.nodes);
      setTrashProjects(payload.projects);
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
    socket.on('workspace-trash-data', onTrash);
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
      socket.off('workspace-trash-data', onTrash);
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

  useEffect(() => {
    if (!databaseDetail?.views?.length) {
      setSelectedDatabaseViewId(null);
      return;
    }
    const nextViewId = databaseDetail.views.some((view) => view.id === selectedDatabaseViewId)
      ? selectedDatabaseViewId
      : databaseDetail.views[0].id;
    setSelectedDatabaseViewId(nextViewId);
  }, [databaseDetail, selectedDatabaseViewId]);

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
    const project = databaseDetail?.project || projectPageDetail?.project;
    if (!project) return [];
    return project.statuses.map((status) => ({
      ...status,
      tasks: project.tasks
        .filter((task) => task.statusId === status.id)
        .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),
    }));
  }, [projectPageDetail, databaseDetail]);

  const currentTask = useMemo(() => {
    const project = databaseDetail?.project || projectPageDetail?.project;
    return project?.tasks.find((task) => task.id === selectedTaskId) || null;
  }, [projectPageDetail, databaseDetail, selectedTaskId]);
  const activeProject = databaseDetail?.project || projectPageDetail?.project || null;
  const selectedDatabaseView = useMemo(
    () => databaseDetail?.views.find((view) => view.id === selectedDatabaseViewId) || databaseDetail?.views[0] || null,
    [databaseDetail, selectedDatabaseViewId]
  );
  const databaseViewConfig = (selectedDatabaseView?.config || {}) as Record<string, unknown>;

  const selectedWorkspaceDetail = pageDetail || projectPageDetail || databaseDetail;
  const selectedAncestors = selectedWorkspaceDetail?.ancestors || [];

  const canEditProject = useMemo(() => {
    const project = databaseDetail?.project || projectPageDetail?.project;
    return project?.role === 'project_owner' || project?.role === 'project_editor';
  }, [projectPageDetail, databaseDetail]);

  const canManageProject = useMemo(() => {
    const project = databaseDetail?.project || projectPageDetail?.project;
    return project?.role === 'project_owner';
  }, [projectPageDetail, databaseDetail]);

  const filteredDatabaseRecords = useMemo(() => {
    if (!databaseDetail || databaseDetail.project) return [];

    const searchValue = databaseSearch.trim().toLowerCase();
    const filterPropertyId = String(databaseViewConfig.filterPropertyId || '');
    const filterValue = String(databaseViewConfig.filterValue || '').trim().toLowerCase();
    const sortPropertyId = String(databaseViewConfig.sortPropertyId || '');
    const sortDirection = databaseViewConfig.sortDirection === 'desc' ? 'desc' : 'asc';

    let next = [...databaseDetail.records];

    if (searchValue) {
      next = next.filter((record) => {
        if (record.title.toLowerCase().includes(searchValue)) return true;
        return databaseDetail.properties.some((property) => {
          const value = property.propertyType === 'relation'
            ? relationTargetLabel(record.values[property.id], nodes)
            : prettyValue(record.values[property.id]);
          return value.toLowerCase().includes(searchValue);
        });
      });
    }

    if (filterPropertyId && filterValue) {
      next = next.filter((record) => {
        const property = databaseDetail.properties.find((entry) => entry.id === filterPropertyId);
        if (!property) return true;
        const value = property.propertyType === 'relation'
          ? relationTargetLabel(record.values[property.id], nodes)
          : prettyValue(record.values[property.id]);
        return value.toLowerCase().includes(filterValue);
      });
    }

    if (sortPropertyId) {
      next.sort((a, b) => {
        const left = prettyValue(a.values[sortPropertyId]).toLowerCase();
        const right = prettyValue(b.values[sortPropertyId]).toLowerCase();
        return sortDirection === 'desc' ? right.localeCompare(left) : left.localeCompare(right);
      });
    }

    return next;
  }, [databaseDetail, databaseSearch, databaseViewConfig, nodes]);

  const [databaseViewMode, setDatabaseViewMode] = useState<'board' | 'table'>('board');

  const openCreateModal = (kind: 'page' | 'project', parentId: string | null = null) => {
    setCreateModal({ kind, parentId });
    setNewTitle('');
    setNewDescription('');
    setPageParentId(parentId || 'standalone');
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
        parentId: createModal.kind === 'page'
          ? (createModal.parentId || (pageParentId === 'standalone' ? null : pageParentId))
          : createModal.parentId,
        nodeType: 'page',
        title: newTitle,
        description: newDescription,
      },
      (response: { ok: boolean; nodeId?: string; message?: string }) => {
        if (!response.ok || !response.nodeId) {
          setError(response.message || 'Failed to create item');
          return;
        }
        setCreateModal({ kind: null, parentId: null });
        const nextParentId = createModal.kind === 'page'
          ? (createModal.parentId || (pageParentId === 'standalone' ? null : pageParentId))
          : createModal.parentId;
        const nextNode = {
          id: response.nodeId,
          roomId,
          parentId: nextParentId,
          nodeType: 'page' as NodeType,
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
      content: blockType === 'checklist' ? serializeChecklistContent(false, '') : '',
      orderIndex: page.blocks.length,
    });
  };

  const deleteBlock = (page: PageDetail | ProjectPageDetail, blockId: string) => {
    socket.emit('workspace-page-block-delete', {
      nodeId: page.id,
      username,
      blockId,
    });
  };

  const reorderBlocks = (page: PageDetail | ProjectPageDetail, sourceIndex: number, destinationIndex: number) => {
    if (sourceIndex === destinationIndex) return;
    const nextBlocks = [...page.blocks];
    const [moved] = nextBlocks.splice(sourceIndex, 1);
    nextBlocks.splice(destinationIndex, 0, moved);

    const normalizedBlocks = nextBlocks.map((block, index) => ({ ...block, orderIndex: index }));
    if (page.nodeType === 'project_page') {
      setProjectPageDetail((prev) => (prev ? { ...prev, blocks: normalizedBlocks } : prev));
    } else {
      setPageDetail((prev) => (prev ? { ...prev, blocks: normalizedBlocks } : prev));
    }

    normalizedBlocks.forEach((block, index) => {
      socket.emit('workspace-page-block-upsert', {
        nodeId: page.id,
        username,
        blockId: block.id,
        blockType: block.blockType,
        content: block.content,
        orderIndex: index,
      });
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

  const archiveSelectedNode = () => {
    if (!selectedWorkspaceDetail || selectedWorkspaceDetail.nodeType === 'project_page') return;
    if (!confirm(`Archive "${selectedWorkspaceDetail.title}"?`)) return;
    socket.emit(
      'workspace-node-archive',
      { nodeId: selectedWorkspaceDetail.id, username },
      (response: { ok: boolean; message?: string }) => {
        if (!response.ok) {
          setError(response.message || 'Failed to archive item');
          return;
        }
        clearSelection();
      }
    );
  };

  const archiveNode = (node: WorkspaceNode) => {
    if (node.nodeType === 'project_page') return;
    if (!confirm(`Archive "${node.title}"?`)) return;
    socket.emit(
      'workspace-node-archive',
      { nodeId: node.id, username },
      (response: { ok: boolean; message?: string }) => {
        if (!response.ok) {
          setError(response.message || 'Failed to archive item');
          return;
        }
        if (selectedNodeId === node.id) {
          clearSelection();
        }
      }
    );
  };

  const restoreTrashNode = (nodeId: string) => {
    socket.emit('workspace-node-restore', { nodeId, username }, (response: { ok: boolean; message?: string }) => {
      if (!response.ok) {
        setError(response.message || 'Failed to restore item');
        return;
      }
      requestTree();
      requestTrash();
    });
  };

  const restoreTrashProject = (projectId: string) => {
    socket.emit('project-restore', { projectId, username });
    requestTree();
    requestTrash();
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

  const updateProperty = (propertyId: string, updates: { name?: string; config?: Record<string, unknown> }) => {
    if (!databaseDetail) return;
    const property = databaseDetail.properties.find((entry) => entry.id === propertyId);
    if (!property) return;
    socket.emit('workspace-database-property-update', {
      nodeId: databaseDetail.id,
      propertyId,
      username,
      name: updates.name ?? property.name,
      config: updates.config ?? property.config ?? {},
    });
  };

  const deleteProperty = (propertyId: string) => {
    if (!databaseDetail) return;
    socket.emit('workspace-database-property-delete', {
      nodeId: databaseDetail.id,
      propertyId,
      username,
    });
  };

  const updateDatabaseViewConfig = (partialConfig: Record<string, unknown>) => {
    if (!databaseDetail || !selectedDatabaseView) return;
    const nextConfig = { ...(selectedDatabaseView.config || {}), ...partialConfig };
    socket.emit('workspace-database-view-update', {
      nodeId: databaseDetail.id,
      viewId: selectedDatabaseView.id,
      username,
      config: nextConfig,
    });
    setDatabaseDetail((prev) =>
      prev
        ? {
            ...prev,
            views: prev.views.map((view) =>
              view.id === selectedDatabaseView.id ? { ...view, config: nextConfig } : view
            ),
          }
        : prev
    );
  };

  const moveTreeNode = (parentId: string | null) => {
    if (!draggingTreeNodeId) return;
    socket.emit(
      'workspace-node-move',
      {
        nodeId: draggingTreeNodeId,
        parentId,
        username,
      },
      (response: { ok: boolean; message?: string }) => {
        if (!response.ok) {
          setError(response.message || 'Failed to move item');
        }
        setDraggingTreeNodeId(null);
      }
    );
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

  const deleteRecord = (recordId: string) => {
    if (!databaseDetail) return;
    socket.emit('workspace-database-record-delete', {
      nodeId: databaseDetail.id,
      recordId,
      username,
    });
  };

  const renderGenericPropertyInput = (record: DatabaseRecord, property: DatabaseProperty) => {
    const value = record.values[property.id];

    if (property.propertyType === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => updateRecord(record.id, record.title, property.id, event.target.checked)}
          className="h-4 w-4 rounded border-[#3F4147] bg-[#313338]"
        />
      );
    }

    if (property.propertyType === 'relation') {
      const targetNodeId = String(property.config?.targetNodeId || '');
      const relationOptions = nodes.filter((node) => node.id !== databaseDetail?.id);
      const selectedValue = Array.isArray(value) && value[0] && typeof value[0] === 'object' && 'targetNodeId' in value[0]
        ? String((value[0] as { targetNodeId?: unknown }).targetNodeId || '')
        : '';

      return (
        <select
          value={selectedValue}
          onChange={(event) => {
            const nextTarget = nodes.find((node) => node.id === event.target.value);
            updateRecord(
              record.id,
              record.title,
              property.id,
              event.target.value
                ? [{ targetNodeId: event.target.value, targetType: nextTarget?.nodeType || 'page' }]
                : []
            );
          }}
          disabled={!targetNodeId}
          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-[#b5bac1] outline-none transition focus:border-[#3F4147] focus:bg-[#313338] disabled:opacity-50"
        >
          <option value="">{targetNodeId ? 'No relation' : 'Choose target in property header'}</option>
          {relationOptions.map((node) => (
            <option key={node.id} value={node.id}>
              {node.title}
            </option>
          ))}
        </select>
      );
    }

    if (property.propertyType === 'date') {
      const dateValue = typeof value === 'string' ? value : '';
      return (
        <input
          type="date"
          value={dateValue}
          onChange={(event) => updateRecord(record.id, record.title, property.id, event.target.value)}
          className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-[#b5bac1] outline-none transition focus:border-[#3F4147] focus:bg-[#313338]"
        />
      );
    }

    return (
      <input
        value={prettyValue(value)}
        onChange={(event) => updateRecord(record.id, record.title, property.id, event.target.value)}
        className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm text-[#b5bac1] outline-none transition focus:border-[#3F4147] focus:bg-[#313338]"
      />
    );
  };

  const [newTaskPriorityByStatus, setNewTaskPriorityByStatus] = useState<Record<string, Priority>>({});

  const createTask = (statusId: string) => {
    const project = databaseDetail?.project || projectPageDetail?.project;
    if (!project) return;
    const title = newTaskTitleByStatus[statusId]?.trim();
    if (!title) return;
    
    const priority = newTaskPriorityByStatus[statusId] || 'medium';
    const tempId = 'temp_' + Math.random().toString(36).substring(7);
    
    // Optimistic update
    const newTask = {
      id: tempId,
      projectId: project.id,
      title,
      description: '',
      statusId,
      priority,
      createdBy: username,
      assigneeUsername: '',
      dueAt: 0,
      position: 1000000, // High position to put it at the end
      createdAt: Date.now(),
      updatedAt: Date.now(),
      checklist: [],
      comments: [],
      attachments: [],
    };

    if (databaseDetail?.project) {
      setDatabaseDetail({
        ...databaseDetail,
        project: { ...databaseDetail.project, tasks: [...databaseDetail.project.tasks, newTask] }
      });
    } else if (projectPageDetail?.project) {
      setProjectPageDetail({
        ...projectPageDetail,
        project: { ...projectPageDetail.project, tasks: [...projectPageDetail.project.tasks, newTask] }
      });
    }

    socket.emit('task-create', {
      projectId: project.id,
      username,
      title,
      statusId,
      priority,
    });
    
    setNewTaskTitleByStatus((prev) => {
      const next = { ...prev };
      delete next[statusId];
      return next;
    });
  };

  const createStatus = () => {
    const project = databaseDetail?.project || projectPageDetail?.project;
    if (!project || !newStatusName.trim()) return;
    socket.emit('project-status-create', {
      projectId: project.id,
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
    const project = databaseDetail?.project || projectPageDetail?.project;
    if (!project) return;
    if (!role) {
      socket.emit('project-member-remove', { projectId: project.id, username, targetUsername });
      return;
    }
    socket.emit('project-member-set', {
      projectId: project.id,
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

  const renderBlockEditor = (page: PageDetail | ProjectPageDetail) => (
    <DragDropContext
      onDragEnd={(result) => {
        if (!result.destination) return;
        reorderBlocks(page, result.source.index, result.destination.index);
      }}
    >
      <Droppable droppableId={`blocks:${page.id}`}>
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
            {page.blocks.map((block, index) => {
              const checklist = block.blockType === 'checklist' ? parseChecklistContent(block.content) : null;

              return (
                <Draggable key={block.id} draggableId={`block:${block.id}`} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`group rounded-2xl border px-3 py-3 transition ${
                        snapshot.isDragging ? 'border-indigo-500 bg-[#2B2D31] shadow-2xl' : 'border-transparent hover:border-[#3F4147] hover:bg-[#2B2D31]/60'
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#949ba4]">
                          <button
                            {...provided.dragHandleProps}
                            className="rounded-md border border-[#3F4147] px-2 py-1 text-[10px] text-[#b5bac1] transition hover:bg-[#313338] hover:text-white"
                          >
                            Move
                          </button>
                          <span>{block.blockType.replace('_', ' ')}</span>
                        </div>
                        <button
                          onClick={() => deleteBlock(page, block.id)}
                          className="rounded-md border border-red-500/30 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-red-300 opacity-0 transition hover:bg-red-500/10 group-hover:opacity-100"
                        >
                          Delete
                        </button>
                      </div>

                      {block.blockType === 'divider' ? (
                        <button
                          onClick={() => saveBlock(page, block, '')}
                          className="w-full py-4"
                        >
                          <div className="h-px w-full bg-[#3F4147]" />
                        </button>
                      ) : block.blockType === 'checklist' && checklist ? (
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={checklist.checked}
                            onChange={(event) => saveBlock(page, block, serializeChecklistContent(event.target.checked, checklist.text))}
                            className="mt-1 h-4 w-4 rounded border-[#3F4147] bg-[#1E1F22]"
                          />
                          <textarea
                            value={checklist.text}
                            onChange={(event) =>
                              page.nodeType === 'project_page'
                                ? setProjectPageDetail((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          blocks: prev.blocks.map((entry) =>
                                            entry.id === block.id
                                              ? { ...entry, content: serializeChecklistContent(checklist.checked, event.target.value) }
                                              : entry
                                          ),
                                        }
                                      : prev
                                  )
                                : setPageDetail((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          blocks: prev.blocks.map((entry) =>
                                            entry.id === block.id
                                              ? { ...entry, content: serializeChecklistContent(checklist.checked, event.target.value) }
                                              : entry
                                          ),
                                        }
                                      : prev
                                  )
                            }
                            onBlur={(event) => saveBlock(page, block, serializeChecklistContent(checklist.checked, event.target.value))}
                            rows={2}
                            placeholder={blockPlaceholders[block.blockType]}
                            className="w-full resize-none rounded-xl border border-transparent bg-transparent px-0 py-0 text-base leading-7 text-[#dbdee1] outline-none transition focus:border-[#3F4147] focus:bg-[#313338] focus:px-3 focus:py-2"
                          />
                        </div>
                      ) : (
                        <textarea
                          value={block.content}
                          onChange={(event) =>
                            page.nodeType === 'project_page'
                              ? setProjectPageDetail((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        blocks: prev.blocks.map((entry) =>
                                          entry.id === block.id ? { ...entry, content: event.target.value } : entry
                                        ),
                                      }
                                    : prev
                                )
                              : setPageDetail((prev) =>
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
                          onBlur={(event) => saveBlock(page, block, event.target.value)}
                          rows={block.blockType === 'heading' ? 2 : block.blockType === 'code' ? 6 : 4}
                          placeholder={blockPlaceholders[block.blockType] || 'Write...'}
                          className={`w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-2 outline-none transition focus:border-[#3F4147] focus:bg-[#313338] ${
                            block.blockType === 'heading'
                              ? 'text-3xl font-semibold tracking-tight text-white'
                              : block.blockType === 'quote'
                                ? 'border-l-4 border-[#6b7280] italic text-[#d1d5db]'
                                : block.blockType === 'code'
                                  ? 'bg-[#1E1F22] font-mono text-sm text-emerald-200'
                                  : block.blockType === 'callout'
                                    ? 'bg-amber-500/10 text-amber-100'
                                    : block.blockType === 'bulleted_list'
                                      ? 'text-[#dbdee1]'
                                      : block.blockType === 'numbered_list'
                                        ? 'text-[#dbdee1]'
                                        : 'text-base leading-7 text-[#dbdee1]'
                          }`}
                        />
                      )}
                    </div>
                  )}
                </Draggable>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );

  const renderTree = (items: WorkspaceNode[], depth = 0): React.ReactNode =>
    items.map((node) => {
      const children = childMap.get(node.id) || [];
      return (
        <div key={node.id}>
          <div
            draggable={node.nodeType !== 'project_page'}
            onDragStart={() => setDraggingTreeNodeId(node.id)}
            onDragEnd={() => setDraggingTreeNodeId(null)}
            onDragOver={(event) => {
              if (node.nodeType === 'page' || node.nodeType === 'project_page') event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (node.nodeType === 'page' || node.nodeType === 'project_page') {
                moveTreeNode(node.id);
              }
            }}
            className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
              selectedNodeId === node.id
                ? 'bg-[#3F4147] text-white shadow-sm'
                : 'text-[#b5bac1] hover:bg-[#313338] hover:text-white'
            }`}
            style={{ paddingLeft: `${isSidebarCollapsed ? 8 : depth * 14 + 8}px` }}
            title={node.title}
          >
            <button onClick={() => openNode(node)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <span className="w-4 text-center text-[#949ba4]">{node.icon || iconForNode(node.nodeType)}</span>
              {!isSidebarCollapsed && <span className="truncate">{node.title}</span>}
            </button>
            {node.nodeType === 'project_page' && !isSidebarCollapsed && (
              <span className="rounded-full bg-[#1E1F22] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#949ba4]">
                Project
              </span>
            )}
            {node.nodeType !== 'project_page' && !isSidebarCollapsed && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  archiveNode(node);
                }}
                className="rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-300 opacity-0 transition hover:bg-red-500/10 group-hover:opacity-100"
                title="Archive"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" /></svg>
              </button>
            )}
            {node.nodeType === 'project_page' && canManageProject && selectedNodeId === node.id && projectPageDetail?.project && !isSidebarCollapsed && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  if (!projectPageDetail?.project) return;
                  socket.emit('project-archive', { projectId: projectPageDetail.project.id, username });
                }}
                className="rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-300 opacity-0 transition hover:bg-red-500/10 group-hover:opacity-100"
                title="Archive Project"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" /></svg>
              </button>
            )}
          </div>
          {children.length > 0 && !isSidebarCollapsed && <div className="mt-0.5 space-y-0.5">{renderTree(children, depth + 1)}</div>}
        </div>
      );
    });

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    const project = databaseDetail?.project || projectPageDetail?.project;

    if (!destination || !project) return;

    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return;
    }

    const taskId = draggableId;
    const nextStatusId = destination.droppableId;

    // Find all tasks in the destination column
    const columnTasks = project.tasks
      .filter((t) => t.statusId === nextStatusId)
      .sort((a, b) => a.position - b.position);

    let nextPosition: number;

    if (columnTasks.length === 0) {
      nextPosition = 1000;
    } else if (destination.index === 0) {
      nextPosition = columnTasks[0].position / 2;
    } else if (destination.index >= columnTasks.length) {
      nextPosition = columnTasks[columnTasks.length - 1].position + 1000;
    } else {
      // If moving within same column and index shifted
      let adjustedTasks = [...columnTasks];
      if (source.droppableId === nextStatusId) {
        const movedTask = adjustedTasks.find(t => t.id === taskId);
        if (movedTask) {
          adjustedTasks = adjustedTasks.filter(t => t.id !== taskId);
        }
      }
      
      if (destination.index === 0) {
        nextPosition = adjustedTasks[0].position / 2;
      } else if (destination.index >= adjustedTasks.length) {
        nextPosition = adjustedTasks[adjustedTasks.length - 1].position + 1000;
      } else {
        const prevTask = adjustedTasks[destination.index - 1];
        const nextTask = adjustedTasks[destination.index];
        nextPosition = (prevTask.position + nextTask.position) / 2;
      }
    }

    socket.emit('task-update', {
      taskId,
      username,
      updates: {
        statusId: nextStatusId,
        position: nextPosition,
      },
    });

    // Optimistic update
    if (databaseDetail?.project) {
      const updatedTasks = databaseDetail.project.tasks.map((t) => {
        if (t.id === taskId) {
          return { ...t, statusId: nextStatusId, position: nextPosition };
        }
        return t;
      });
      setDatabaseDetail({ ...databaseDetail, project: { ...databaseDetail.project, tasks: updatedTasks } });
    } else if (projectPageDetail?.project) {
      const updatedTasks = projectPageDetail.project.tasks.map((t) => {
        if (t.id === taskId) {
          return { ...t, statusId: nextStatusId, position: nextPosition };
        }
        return t;
      });
      setProjectPageDetail({ ...projectPageDetail, project: { ...projectPageDetail.project, tasks: updatedTasks } });
    }
  };

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
      <aside className={`flex shrink-0 flex-col border-r border-[#1E1F22] bg-[#232428] transition-[width] duration-200 ${isSidebarCollapsed ? 'w-[72px]' : 'w-[300px]'}`}>
        <div className="border-b border-[#1E1F22] px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              {isSidebarCollapsed ? (
                <div className="text-lg font-semibold text-white">O</div>
              ) : (
                <>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#949ba4]">Workspace</div>
                  <div className="mt-1 text-lg font-semibold text-white">Omni</div>
                </>
              )}
            </div>
            <div className="flex items-center gap-1">
              <IconButton title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'} onClick={() => setIsSidebarCollapsed((prev) => !prev)}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  {isSidebarCollapsed ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 5l7 7-7 7" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M15 5l-7 7 7 7" />
                  )}
                </svg>
              </IconButton>
              <IconButton title="Trash" onClick={() => { requestTrash(); setShowTrash(true); }}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M6 7h12m-9 0V5a1 1 0 011-1h4a1 1 0 011 1v2m-8 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" /></svg>
              </IconButton>
              <IconButton title="New Page" onClick={() => openCreateModal('page')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 5v14M5 12h14" /></svg>
              </IconButton>
              <IconButton title="New Project" onClick={() => openCreateModal('project')}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 7h16M7 4v6m10-6v6M5 11h14v8H5z" /></svg>
              </IconButton>
            </div>
          </div>
          {!isSidebarCollapsed && (
            <div className="mt-3 rounded-lg border border-[#1E1F22] bg-[#2B2D31] px-3 py-2 text-xs leading-relaxed text-[#b5bac1]">
              Projects and pages now live in one tree. Each project opens as a page with its task database embedded below.
            </div>
          )}
        </div>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className={`flex-1 overflow-y-auto ${isSidebarCollapsed ? 'px-2 py-4' : 'px-3 py-4'}`}>
          <div className="space-y-6">
            <div>
              {!isSidebarCollapsed && <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Projects</div>}
              <div className="space-y-1">{renderTree(projectNodes)}</div>
              {!projectNodes.length && !isSidebarCollapsed && <div className="px-2 text-sm text-[#949ba4]">No projects yet.</div>}
            </div>

            <div>
              {!isSidebarCollapsed && <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Pages</div>}
              <div
                className="space-y-1 rounded-xl border border-dashed border-transparent p-1 transition hover:border-[#3F4147]"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  moveTreeNode(null);
                }}
              >
                {renderTree(pageNodes)}
              </div>
              {!pageNodes.length && !isSidebarCollapsed && <div className="px-2 text-sm text-[#949ba4]">No standalone pages.</div>}
            </div>

            {!isSidebarCollapsed && databaseNodes.length > 0 && (
              <div>
                <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Project Databases</div>
                <div className="space-y-1">{renderTree(databaseNodes)}</div>
              </div>
            )}
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
              {selectedWorkspaceDetail ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#949ba4]">
                  <button onClick={clearSelection} className="transition hover:text-white">Workspace</button>
                  {selectedAncestors.map((ancestor) => (
                    <div key={ancestor.id} className="flex items-center gap-2">
                      <span>/</span>
                      <button onClick={() => openNode(ancestor)} className="transition hover:text-white">
                        {ancestor.title}
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-white">
                    <span>/</span>
                    <span>{selectedWorkspaceDetail.title}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-xs text-[#72757d]">Pages, project homes, and databases now share one connected tree.</div>
              )}
            </div>
            <div className="flex items-center gap-1">
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

              {renderBlockEditor(pageDetail)}

              <div className="mt-8 flex flex-wrap gap-2">
                {['paragraph', 'heading', 'quote', 'checklist', 'code', 'callout', 'bulleted_list', 'numbered_list', 'divider'].map((blockType) => (
                  <button
                    key={blockType}
                    onClick={() => addBlock(pageDetail, blockType)}
                    className="rounded-full border border-[#3F4147] bg-[#2B2D31] px-3 py-1.5 text-sm text-[#b5bac1] transition hover:bg-[#3F4147] hover:text-white"
                  >
                    Add {blockType}
                  </button>
                ))}
              </div>

              {(pageDetail.childNodes.length > 0 || pageDetail.backlinks.length > 0) && (
                <div className="mt-10 grid gap-4 lg:grid-cols-2">
                  <section className="rounded-[22px] border border-[#1E1F22] bg-[#2B2D31] p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Subpages</div>
                    <div className="mt-4 space-y-2">
                      {pageDetail.childNodes.map((child) => (
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
                  </section>

                  <section className="rounded-[22px] border border-[#1E1F22] bg-[#2B2D31] p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Linked References</div>
                    <div className="mt-4 space-y-2">
                      {pageDetail.backlinks.map((backlink, index) => {
                        const sourceNode = nodes.find((node) => node.id === backlink.sourceNodeId);
                        return (
                          <button
                            key={`${backlink.sourceNodeId}-${index}`}
                            onClick={() => sourceNode && openNode(sourceNode)}
                            className="flex w-full items-center justify-between rounded-xl bg-[#232428] px-3 py-2 text-left text-sm text-[#dbdee1] transition hover:bg-[#313338]"
                          >
                            <span className="truncate">{sourceNode?.title || backlink.sourceNodeId}</span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-[#949ba4]">{backlink.targetType}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
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

                    <div className="mt-6">
                      {renderBlockEditor(projectPageDetail)}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2">
                      {['paragraph', 'heading', 'quote', 'checklist', 'code', 'callout', 'bulleted_list', 'numbered_list', 'divider'].map((blockType) => (
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
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Quick Actions</div>
                        <h2 className="mt-2 text-xl font-semibold text-white">Project Tasks</h2>
                        <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
                          The task board has moved to its dedicated "Tasks" page in the sidebar.
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          const tasksNode = nodes.find(n => n.parentId === projectPageDetail.id && n.nodeType === 'database');
                          if (tasksNode) openNode(tasksNode);
                        }}
                        className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                      >
                        Go to Tasks
                      </button>
                    </div>
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
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{databaseDetail.icon || '≣'}</span>
                  <input
                    value={databaseDetail.title}
                    onChange={(event) =>
                      setDatabaseDetail((prev) => (prev ? { ...prev, title: event.target.value } : prev))
                    }
                    onBlur={saveDatabaseMeta}
                    className="w-full border-none bg-transparent px-0 text-5xl font-semibold tracking-tight text-white focus:outline-none"
                  />
                </div>
                <textarea
                  value={databaseDetail.description}
                  onChange={(event) =>
                    setDatabaseDetail((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                  }
                  onBlur={saveDatabaseMeta}
                  rows={2}
                  className="mt-3 w-full resize-none border-none bg-transparent px-0 text-base leading-7 text-[#b5bac1] focus:outline-none"
                  placeholder="Describe this database..."
                />
              </div>

              <div className="rounded-[24px] border border-[#1E1F22] bg-[#2B2D31] p-6 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-[#949ba4]">
                      {databaseDetail.project ? 'Project Task Tracker' : 'Generic Database'}
                    </div>
                    <h2 className="mt-1 text-lg font-semibold text-white">
                      {databaseDetail.project ? 'Kanban Board' : 'Records'}
                    </h2>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {databaseDetail.project && (
                      <div className="mr-4 flex rounded-full bg-[#232428] p-1">
                        <button
                          onClick={() => setDatabaseViewMode('board')}
                          className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                            databaseViewMode === 'board' ? 'bg-indigo-500 text-white shadow-lg' : 'text-[#949ba4] hover:text-white'
                          }`}
                        >
                          Board
                        </button>
                        <button
                          onClick={() => setDatabaseViewMode('table')}
                          className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                            databaseViewMode === 'table' ? 'bg-indigo-500 text-white shadow-lg' : 'text-[#949ba4] hover:text-white'
                          }`}
                        >
                          Table
                        </button>
                      </div>
                    )}

                    {!databaseDetail.project && (
                      <div className="flex flex-wrap gap-2">
                        {databaseDetail.views.length > 0 && (
                          <select
                            value={selectedDatabaseViewId || ''}
                            onChange={(event) => setSelectedDatabaseViewId(event.target.value)}
                            className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                          >
                            {databaseDetail.views.map((view) => (
                              <option key={view.id} value={view.id}>
                                {view.name}
                              </option>
                            ))}
                          </select>
                        )}
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
                    )}
                  </div>
                </div>

                {!databaseDetail.project && (
                  <div className="mt-5 grid gap-3 rounded-2xl border border-[#1E1F22] bg-[#232428] p-4 lg:grid-cols-4">
                    <input
                      value={databaseSearch}
                      onChange={(event) => setDatabaseSearch(event.target.value)}
                      placeholder="Search records"
                      className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                    />
                    <select
                      value={String(databaseViewConfig.filterPropertyId || '')}
                      onChange={(event) => updateDatabaseViewConfig({ filterPropertyId: event.target.value })}
                      className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                    >
                      <option value="">Filter property</option>
                      {databaseDetail.properties.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={String(databaseViewConfig.filterValue || '')}
                      onChange={(event) => updateDatabaseViewConfig({ filterValue: event.target.value })}
                      placeholder="Filter contains"
                      className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={String(databaseViewConfig.sortPropertyId || '')}
                        onChange={(event) => updateDatabaseViewConfig({ sortPropertyId: event.target.value })}
                        className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                      >
                        <option value="">Sort by</option>
                        {databaseDetail.properties.map((property) => (
                          <option key={property.id} value={property.id}>
                            {property.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={String(databaseViewConfig.sortDirection || 'asc')}
                        onChange={(event) => updateDatabaseViewConfig({ sortDirection: event.target.value })}
                        className="rounded-xl border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                      >
                        <option value="asc">A-Z</option>
                        <option value="desc">Z-A</option>
                      </select>
                    </div>
                  </div>
                )}

                {databaseDetail.project && databaseViewMode === 'board' ? (
                  <DragDropContext onDragEnd={onDragEnd}>
                    <div className="mt-6 flex gap-4 overflow-x-auto overflow-y-hidden pb-4 min-h-[400px]">
                      {statusesWithTasks.map((status) => (
                        <section
                          key={status.id}
                          className="flex h-full min-h-0 w-[300px] shrink-0 flex-col rounded-2xl border border-[#1E1F22] bg-[#232428] p-4"
                        >
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} />
                              <div className="font-bold text-white text-sm">{status.name}</div>
                              <span className="rounded-full bg-[#1E1F22] px-2 py-0.5 text-[10px] text-[#949ba4]">
                                {status.tasks.length}
                              </span>
                            </div>
                          </div>

                          <Droppable droppableId={status.id}>
                            {(provided, snapshot) => (
                              <div
                                {...provided.droppableProps}
                                ref={provided.innerRef}
                                className={`flex-1 space-y-3 transition-colors rounded-xl ${
                                  snapshot.isDraggingOver ? 'bg-indigo-500/5' : ''
                                }`}
                              >
                                {status.tasks.map((task, index) => (
                                  <Draggable key={task.id} draggableId={task.id} index={index}>
                                    {(provided, snapshot) => (
                                      <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        {...provided.dragHandleProps}
                                        onClick={() => setSelectedTaskId(task.id)}
                                        className={`w-full rounded-xl border border-[#3F4147] bg-[#2B2D31] p-3 text-left transition shadow-sm cursor-pointer ${
                                          snapshot.isDragging ? 'border-indigo-500 shadow-xl scale-[1.02] z-50' : 'hover:border-indigo-400 hover:bg-[#313338]'
                                        }`}
                                      >
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="font-semibold text-white text-sm">{task.title}</div>
                                          <span className={`rounded-full px-2 py-0.5 text-[9px] uppercase font-bold ${priorityClasses[task.priority]}`}>
                                            {task.priority}
                                          </span>
                                        </div>
                                        {task.description && (
                                          <div className="mt-2 line-clamp-2 text-xs text-[#b5bac1] leading-relaxed">{task.description}</div>
                                        )}
                                        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-[#949ba4] font-medium">
                                          {task.assigneeUsername && (
                                            <div className="flex items-center gap-1 bg-[#1E1F22] px-1.5 py-0.5 rounded-full">
                                              <div className="h-3.5 w-3.5 rounded-full bg-indigo-500 flex items-center justify-center text-[7px] text-white font-black">
                                                {task.assigneeUsername[0].toUpperCase()}
                                              </div>
                                              <span>{task.assigneeUsername}</span>
                                            </div>
                                          )}
                                          {task.dueAt && <span>📅 {new Date(task.dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                                          {task.comments.length > 0 && <span>💬 {task.comments.length}</span>}
                                        </div>
                                      </div>
                                    )}
                                  </Draggable>
                                ))}
                                {provided.placeholder}
                                {!status.tasks.length && !snapshot.isDraggingOver && (
                                  <div className="py-8 text-center text-[11px] text-[#6d6f78] border border-dashed border-[#3F4147] rounded-xl uppercase tracking-widest font-bold">
                                    Empty
                                  </div>
                                )}
                              </div>
                            )}
                          </Droppable>

                          {canEditProject && (
                            <div className="mt-4 pt-4 border-t border-[#1E1F22] space-y-3">
                              {newTaskTitleByStatus[status.id] !== undefined ? (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-200">
                                  <input
                                    autoFocus
                                    value={newTaskTitleByStatus[status.id]}
                                    onChange={(e) => setNewTaskTitleByStatus(prev => ({ ...prev, [status.id]: e.target.value }))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') createTask(status.id);
                                      if (e.key === 'Escape') setNewTaskTitleByStatus(prev => {
                                        const next = { ...prev };
                                        delete next[status.id];
                                        return next;
                                      });
                                    }}
                                    placeholder="Task title..."
                                    className="w-full rounded-lg border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white outline-none transition focus:border-indigo-500"
                                  />
                                  
                                  <div className="flex items-center justify-between gap-1 bg-[#1E1F22] p-1 rounded-lg">
                                    {(['low', 'medium', 'high', 'urgent'] as Priority[]).map((p) => (
                                      <button
                                        key={p}
                                        onClick={() => setNewTaskPriorityByStatus(prev => ({ ...prev, [status.id]: p }))}
                                        className={`flex-1 py-1 text-[9px] font-black uppercase rounded transition ${
                                          (newTaskPriorityByStatus[status.id] || 'medium') === p 
                                          ? priorityClasses[p] + ' shadow-sm' 
                                          : 'text-[#6d6f78] hover:text-[#b5bac1]'
                                        }`}
                                      >
                                        {p}
                                      </button>
                                    ))}
                                  </div>

                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => createTask(status.id)}
                                      className="flex-1 rounded-lg bg-indigo-500 py-1.5 text-xs font-bold text-white hover:bg-indigo-600 transition shadow-lg"
                                    >
                                      Add Task
                                    </button>
                                    <button
                                      onClick={() => setNewTaskTitleByStatus(prev => {
                                        const next = { ...prev };
                                        delete next[status.id];
                                        return next;
                                      })}
                                      className="px-3 rounded-lg bg-[#3F4147] text-[#dbdee1] hover:bg-[#4e5058] transition"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setNewTaskTitleByStatus(prev => ({ ...prev, [status.id]: '' }))}
                                  className="w-full flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold text-[#b5bac1] hover:bg-[#313338] hover:text-white transition group"
                                >
                                  <svg className="w-3 h-3 group-hover:scale-125 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 5v14M5 12h14" /></svg>
                                  <span>ADD TASK</span>
                                </button>
                              )}
                            </div>
                          )}
                        </section>
                      ))}
                      
                      {canEditProject && (
                        <button
                          onClick={() => {/* logic to add status */}}
                          className="w-[200px] shrink-0 rounded-2xl border border-dashed border-[#3F4147] flex flex-col items-center justify-center text-[#b5bac1] hover:bg-[#232428] hover:text-white transition group p-6"
                        >
                          <div className="w-10 h-10 rounded-full bg-[#2B2D31] flex items-center justify-center mb-3 group-hover:bg-indigo-500 transition-colors">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 5v14M5 12h14" /></svg>
                          </div>
                          <span className="text-xs font-bold uppercase tracking-widest">New Column</span>
                        </button>
                      )}
                    </div>
                  </DragDropContext>
                ) : (
                  <div className="mt-6 overflow-hidden rounded-[20px] border border-[#1E1F22]">
                    <table className="min-w-full divide-y divide-[#1E1F22] text-left">
                      <thead className="bg-[#232428] text-xs uppercase tracking-[0.18em] text-[#949ba4]">
                        <tr>
                          <th className="px-4 py-3">{databaseDetail.project ? 'Task' : 'Title'}</th>
                          {databaseDetail.project ? (
                            <>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3">Assignee</th>
                              <th className="px-4 py-3">Due</th>
                              <th className="px-4 py-3">Priority</th>
                            </>
                          ) : (
                            databaseDetail.properties.map((property) => (
                              <th key={property.id} className="px-4 py-3">
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <input
                                      value={property.name}
                                      onChange={(event) =>
                                        setDatabaseDetail((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                properties: prev.properties.map((entry) =>
                                                  entry.id === property.id ? { ...entry, name: event.target.value } : entry
                                                ),
                                              }
                                            : prev
                                        )
                                      }
                                      onBlur={(event) => updateProperty(property.id, { name: event.target.value })}
                                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-[#949ba4] outline-none transition focus:border-[#3F4147] focus:bg-[#313338]"
                                    />
                                    <button
                                      onClick={() => deleteProperty(property.id)}
                                      className="rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-500/10"
                                    >
                                      x
                                    </button>
                                  </div>
                                  {property.propertyType === 'relation' && (
                                    <select
                                      value={String(property.config?.targetNodeId || '')}
                                      onChange={(event) =>
                                        updateProperty(property.id, {
                                          config: { ...(property.config || {}), targetNodeId: event.target.value },
                                        })
                                      }
                                      className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-2 py-1 text-[10px] text-[#b5bac1] outline-none transition focus:border-indigo-500"
                                    >
                                      <option value="">Target object</option>
                                      {nodes.filter((node) => node.id !== databaseDetail.id).map((node) => (
                                        <option key={node.id} value={node.id}>
                                          {node.title}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </th>
                            ))
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1E1F22] bg-[#2B2D31]">
                        {databaseDetail.project ? (
                          databaseDetail.project.tasks.map((task) => (
                            <tr key={task.id} onClick={() => setSelectedTaskId(task.id)} className="cursor-pointer transition hover:bg-[#313338]">
                              <td className="px-4 py-4">
                                <div className="font-medium text-white">{task.title}</div>
                                {task.description && <div className="mt-1 text-xs text-[#b5bac1] truncate max-w-xs">{task.description}</div>}
                              </td>
                              <td className="px-4 py-4 text-sm text-[#b5bac1]">
                                <div className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: databaseDetail.project?.statuses.find(s => s.id === task.statusId)?.color || '#5865F2' }} />
                                  {databaseDetail.project?.statuses.find((status) => status.id === task.statusId)?.name || 'Unknown'}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-sm text-[#b5bac1]">{task.assigneeUsername || 'Unassigned'}</td>
                              <td className="px-4 py-4 text-sm text-[#b5bac1]">
                                {task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No date'}
                              </td>
                              <td className="px-4 py-4">
                                <span className={`rounded-full px-2 py-1 text-[10px] uppercase font-bold ${priorityClasses[task.priority]}`}>
                                  {task.priority}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          filteredDatabaseRecords.length > 0 ? (
                            filteredDatabaseRecords.map((record) => (
                              <tr key={record.id}>
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
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
                                    <button
                                      onClick={() => deleteRecord(record.id)}
                                      className="rounded-md border border-red-500/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-500/10"
                                    >
                                      x
                                    </button>
                                  </div>
                                </td>
                                {databaseDetail.properties.map((property) => (
                                  <td key={property.id} className="px-4 py-3">
                                    {renderGenericPropertyInput(record, property)}
                                  </td>
                                ))}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={Math.max(1, databaseDetail.properties.length + 1)}
                                className="px-4 py-10 text-center text-sm text-[#949ba4]"
                              >
                                No records match this view.
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {!databaseDetail.project && (
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
                )}

                {databaseDetail.backlinks.length > 0 && (
                  <section className="mt-6 rounded-[22px] border border-[#1E1F22] bg-[#232428] p-5">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Linked References</div>
                    <div className="mt-4 space-y-2">
                      {databaseDetail.backlinks.map((backlink, index) => {
                        const sourceNode = nodes.find((node) => node.id === backlink.sourceNodeId);
                        return (
                          <button
                            key={`${backlink.sourceNodeId}-${index}`}
                            onClick={() => sourceNode && openNode(sourceNode)}
                            className="flex w-full items-center justify-between rounded-xl bg-[#313338] px-3 py-2 text-left text-sm text-[#dbdee1] transition hover:bg-[#3F4147]"
                          >
                            <span className="truncate">{sourceNode?.title || backlink.sourceNodeId}</span>
                            <span className="text-[10px] uppercase tracking-[0.18em] text-[#949ba4]">{backlink.targetType}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      {showTrash && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[#1E1F22] bg-[#313338] shadow-2xl">
            <div className="border-b border-[#1E1F22] px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">Trash</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Archived items</h2>
                  <p className="mt-2 text-sm text-[#b5bac1]">Restore pages, databases, and projects from here.</p>
                </div>
                <button onClick={() => setShowTrash(false)} className="text-sm text-[#b5bac1] hover:text-white">
                  Close
                </button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-2">
              <section className="min-h-0 border-r border-[#1E1F22] p-6">
                <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Workspace Nodes</div>
                <div className="mt-4 max-h-full space-y-3 overflow-y-auto">
                  {trashNodes.map((node) => (
                    <div key={node.id} className="rounded-2xl border border-[#1E1F22] bg-[#2B2D31] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white">{node.title}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#949ba4]">{node.nodeType}</div>
                          <div className="mt-2 text-xs text-[#72757d]">Archived {new Date(node.archivedAt).toLocaleString()}</div>
                        </div>
                        <button
                          onClick={() => restoreTrashNode(node.id)}
                          className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                  {trashNodes.length === 0 && <div className="text-sm text-[#949ba4]">No archived pages or databases.</div>}
                </div>
              </section>
              <section className="min-h-0 p-6">
                <div className="text-xs uppercase tracking-[0.18em] text-[#949ba4]">Projects</div>
                <div className="mt-4 max-h-full space-y-3 overflow-y-auto">
                  {trashProjects.map((project) => (
                    <div key={project.id} className="rounded-2xl border border-[#1E1F22] bg-[#2B2D31] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-white">{project.title}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[#949ba4]">project</div>
                          <div className="mt-2 text-xs text-[#72757d]">Archived {new Date(project.archivedAt).toLocaleString()}</div>
                        </div>
                        <button
                          onClick={() => restoreTrashProject(project.id)}
                          className="rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                  {trashProjects.length === 0 && <div className="text-sm text-[#949ba4]">No archived projects.</div>}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {createModal.kind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-[28px] border border-[#1E1F22] bg-[#313338] p-6 shadow-2xl">
            <div className="text-[11px] uppercase tracking-[0.22em] text-[#949ba4]">
              {createModal.kind === 'project' ? 'New Project' : 'New Page'}
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-white">
              {createModal.kind === 'project'
                ? 'Create a project home with a built-in task board'
                : 'Create a new page'}
            </h2>

            <div className="mt-5 space-y-4">
              {createModal.kind === 'page' && !createModal.parentId && projectNodes.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#949ba4]">Place Inside</div>
                  <select
                    value={pageParentId}
                    onChange={(event) => setPageParentId(event.target.value)}
                    className="w-full rounded-2xl border border-[#3F4147] bg-[#1E1F22] px-4 py-3 text-white outline-none transition focus:border-indigo-500"
                  >
                    <option value="standalone">Standalone page</option>
                    {projectNodes.map((projectNode) => (
                      <option key={projectNode.id} value={projectNode.id}>
                        Project: {projectNode.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={createModal.kind === 'project' ? 'Project name' : 'Page title'}
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

      {currentTask && taskDraft && activeProject && (
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
                    {activeProject.statuses.map((status) => (
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
                    {activeProject.members.map((member) => (
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
