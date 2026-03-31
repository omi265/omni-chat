'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface WorkspaceMember {
  username: string;
  role: string;
  avatarColor?: string | null;
  avatarUrl?: string | null;
}

interface ProjectSummary {
  id: string;
  roomId: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  memberCount: number;
  taskCount: number;
  role: ProjectRole;
}

type ProjectRole = 'project_owner' | 'project_editor' | 'project_viewer';
type Priority = 'low' | 'medium' | 'high' | 'urgent';

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

interface ProjectsWorkspaceProps {
  roomId: string;
  username: string;
  workspaceReady: boolean;
}

interface TaskDraft {
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeUsername: string;
  dueAt: string;
}

const priorityClasses: Record<Priority, string> = {
  low: 'bg-slate-500/20 text-slate-200',
  medium: 'bg-blue-500/20 text-blue-200',
  high: 'bg-orange-500/20 text-orange-200',
  urgent: 'bg-red-500/20 text-red-200',
};

const toDateInputValue = (timestamp: number | null) => {
  if (!timestamp) return '';
  return new Date(timestamp).toISOString().slice(0, 10);
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

export default function ProjectsWorkspace({ roomId, username, workspaceReady }: ProjectsWorkspaceProps) {
  const socket = getSocket();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [currentProject, setCurrentProject] = useState<ProjectDetail | null>(null);
  const [viewMode, setViewMode] = useState<'board' | 'table'>('board');
  const [error, setError] = useState<string | null>(null);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [isManagingMembers, setIsManagingMembers] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [newTaskTitleByStatus, setNewTaskTitleByStatus] = useState<Record<string, string>>({});
  const [newChecklistText, setNewChecklistText] = useState('');
  const [newComment, setNewComment] = useState('');
  const [newStatusName, setNewStatusName] = useState('');
  const [newStatusColor, setNewStatusColor] = useState('#5865F2');

  const currentTask = useMemo(
    () => currentProject?.tasks.find((task) => task.id === selectedTaskId) || null,
    [currentProject, selectedTaskId]
  );

  const canEditProject = currentProject?.role === 'project_owner' || currentProject?.role === 'project_editor';
  const canManageProject = currentProject?.role === 'project_owner';

  const requestProjects = () => socket.emit('projects-list-request', { roomId, username });
  const requestMembers = () => socket.emit('workspace-get-members', { roomId, username });
  const requestProjectDetail = (projectId: string) => socket.emit('project-get', { roomId, projectId, username });

  useEffect(() => {
    if (!workspaceReady) return;

    if (!socket.connected) {
      socket.connect();
    }

    requestMembers();
    requestProjects();

    const onMembers = (payload: { roomId: string; members: WorkspaceMember[] }) => {
      if (payload.roomId !== roomId) return;
      setWorkspaceMembers(payload.members);
    };

    const onProjects = (payload: { roomId: string; projects: ProjectSummary[] }) => {
      if (payload.roomId !== roomId) return;
      setProjects(payload.projects);
    };

    const onProjectDetail = (payload: { roomId: string; project: ProjectDetail }) => {
      if (payload.roomId !== roomId) return;
      setCurrentProject(payload.project);
    };

    const onProjectsChanged = (payload: { roomId: string; projectId?: string | null }) => {
      if (payload.roomId !== roomId) return;
      requestProjects();
      requestMembers();
      if (currentProjectId || payload.projectId) {
        requestProjectDetail(payload.projectId || currentProjectId || '');
      }
    };

    const onProjectError = (payload: { message: string }) => {
      setError(payload.message);
      window.setTimeout(() => setError(null), 3500);
    };

    const onAttachmentData = (payload: {
      taskId: string;
      attachmentId: string;
      name: string;
      type: string;
      data: unknown;
    }) => {
      const bytes = toAttachmentBytes(payload.data);
      const blob = new Blob([bytes as BlobPart], { type: payload.type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.name;
      anchor.click();
      URL.revokeObjectURL(url);
    };

    socket.on('workspace-members-data', onMembers);
    socket.on('projects-list-data', onProjects);
    socket.on('project-detail-data', onProjectDetail);
    socket.on('projects-changed', onProjectsChanged);
    socket.on('project-error', onProjectError);
    socket.on('task-attachment-data', onAttachmentData);

    return () => {
      socket.off('workspace-members-data', onMembers);
      socket.off('projects-list-data', onProjects);
      socket.off('project-detail-data', onProjectDetail);
      socket.off('projects-changed', onProjectsChanged);
      socket.off('project-error', onProjectError);
      socket.off('task-attachment-data', onAttachmentData);
    };
  }, [roomId, username, socket, currentProjectId, workspaceReady]);

  useEffect(() => {
    if (!projects.length) {
      setCurrentProjectId(null);
      setCurrentProject(null);
      return;
    }

    const stillExists = currentProjectId && projects.some((project) => project.id === currentProjectId);
    const nextProjectId = stillExists ? currentProjectId : projects[0].id;
    if (nextProjectId !== currentProjectId) {
      setCurrentProjectId(nextProjectId);
    }
  }, [projects, currentProjectId]);

  useEffect(() => {
    if (!currentProjectId) {
      setCurrentProject(null);
      return;
    }
    requestProjectDetail(currentProjectId);
  }, [currentProjectId]);

  useEffect(() => {
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
  }, [currentTask]);

  const statusesWithTasks = useMemo(() => {
    if (!currentProject) return [];
    return currentProject.statuses.map((status) => ({
      ...status,
      tasks: currentProject.tasks
        .filter((task) => task.statusId === status.id)
        .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt),
    }));
  }, [currentProject]);

  const createProject = () => {
    if (!newProjectName.trim()) return;
    socket.emit('project-create', {
      roomId,
      username,
      name: newProjectName,
      description: newProjectDescription,
    });
    setNewProjectName('');
    setNewProjectDescription('');
    setIsCreatingProject(false);
  };

  const createStatus = () => {
    if (!currentProject || !newStatusName.trim()) return;
    socket.emit('project-status-create', {
      projectId: currentProject.id,
      username,
      name: newStatusName,
      color: newStatusColor,
    });
    setNewStatusName('');
    setNewStatusColor('#5865F2');
  };

  const createTask = (statusId: string) => {
    if (!currentProject) return;
    const title = newTaskTitleByStatus[statusId]?.trim();
    if (!title) return;
    socket.emit('task-create', {
      projectId: currentProject.id,
      username,
      title,
      statusId,
      priority: 'medium',
    });
    setNewTaskTitleByStatus((prev) => ({ ...prev, [statusId]: '' }));
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
    if (!currentProject) return;
    if (!role) {
      socket.emit('project-member-remove', { projectId: currentProject.id, username, targetUsername });
      return;
    }
    socket.emit('project-member-set', {
      projectId: currentProject.id,
      username,
      targetUsername,
      role,
    });
  };

  const uploadAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
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

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;

    if (!destination || !currentProject) return;

    if (destination.droppableId === source.droppableId && destination.index === source.index) {
      return;
    }

    const taskId = draggableId;
    const nextStatusId = destination.droppableId;

    // Find all tasks in the destination column
    const columnTasks = currentProject.tasks
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
    const updatedTasks = currentProject.tasks.map((t) => {
      if (t.id === taskId) {
        return { ...t, statusId: nextStatusId, position: nextPosition };
      }
      return t;
    });
    setCurrentProject({ ...currentProject, tasks: updatedTasks });
  };

  return (
    <div className="flex h-full min-h-0 bg-[#313338] text-gray-200">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[#1E1F22] bg-[#232428]">
        <div className="border-b border-[#1E1F22] p-4">
          <div className="mb-3">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Projects</div>
            <div className="mt-1 text-sm text-[#b5bac1]">Project planning for this server.</div>
          </div>
          <button
            onClick={() => setIsCreatingProject(true)}
            className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
          >
            New Project
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-2">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setCurrentProjectId(project.id)}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                  currentProjectId === project.id
                    ? 'border-emerald-400 bg-emerald-500/15'
                    : 'border-transparent bg-[#2B2D31] hover:border-[#3F4147] hover:bg-[#313338]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-white">{project.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs text-[#b5bac1]">
                      {project.description || 'No description yet.'}
                    </div>
                  </div>
                  <span className="rounded-full bg-[#1E1F22] px-2 py-1 text-[10px] uppercase text-[#b5bac1]">
                    {project.role.replace('project_', '')}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-[#949ba4]">
                  <span>{project.taskCount} tasks</span>
                  <span>{project.memberCount} members</span>
                </div>
              </button>
            ))}
            {!projects.length && (
              <div className="rounded-lg border border-dashed border-[#3F4147] p-4 text-sm text-[#949ba4]">
                No projects yet. Create the first one for this server.
              </div>
            )}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="mx-4 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {!currentProject ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-md text-center">
              <div className="mb-4 text-4xl">🗂️</div>
              <h2 className="text-2xl font-bold text-white">Pick a project</h2>
              <p className="mt-2 text-sm text-[#b5bac1]">
                Use projects for task tracking, assignments, comments, and due dates while keeping chat and voice in the same server.
              </p>
            </div>
          </div>
        ) : (
          <>
            <header className="border-b border-[#1E1F22] bg-[#2B2D31] px-6 py-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h1 className="truncate text-2xl font-bold text-white">{currentProject.name}</h1>
                    <span className="rounded-full bg-[#1E1F22] px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-[#b5bac1]">
                      {currentProject.role.replace('project_', '')}
                    </span>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm text-[#b5bac1]">
                    {currentProject.description || 'Add a project description to explain the workflow, scope, or owner.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setViewMode('board')}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                      viewMode === 'board' ? 'bg-indigo-500 text-white' : 'bg-[#232428] text-[#b5bac1] hover:text-white'
                    }`}
                  >
                    Board
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
                      viewMode === 'table' ? 'bg-indigo-500 text-white' : 'bg-[#232428] text-[#b5bac1] hover:text-white'
                    }`}
                  >
                    Table
                  </button>
                  {canManageProject && (
                    <button
                      onClick={() => setIsManagingMembers(true)}
                      className="rounded-md bg-[#232428] px-3 py-2 text-sm font-semibold text-[#b5bac1] transition hover:text-white"
                    >
                      Access
                    </button>
                  )}
                </div>
              </div>
            </header>

            <div className="flex-1 min-h-0 overflow-hidden">
              {viewMode === 'board' ? (
                <DragDropContext onDragEnd={onDragEnd}>
                  <div className="flex h-full gap-4 overflow-x-auto overflow-y-hidden p-4">
                    {statusesWithTasks.map((status) => (
                      <section
                        key={status.id}
                        className="flex h-full min-h-0 w-[320px] shrink-0 flex-col rounded-xl border border-[#1E1F22] bg-[#232428]"
                      >
                        <div className="border-b border-[#1E1F22] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: status.color }} />
                              <div className="font-semibold text-white">{status.name}</div>
                              <span className="rounded-full bg-[#1E1F22] px-2 py-0.5 text-[10px] text-[#b5bac1]">
                                {status.tasks.length}
                              </span>
                            </div>
                          </div>

                          {canEditProject && (
                            <div className="mt-4 space-y-2">
                              <input
                                value={newTaskTitleByStatus[status.id] || ''}
                                onChange={(event) =>
                                  setNewTaskTitleByStatus((prev) => ({ ...prev, [status.id]: event.target.value }))
                                }
                                onKeyDown={(e) => e.key === 'Enter' && createTask(status.id)}
                                placeholder="Quick add task"
                                className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white placeholder:text-[#6d6f78] focus:outline-none"
                              />
                              <button
                                onClick={() => createTask(status.id)}
                                className="w-full rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                              >
                                Add Task
                              </button>
                            </div>
                          )}
                        </div>

                        <Droppable droppableId={status.id}>
                          {(provided, snapshot) => (
                            <div
                              {...provided.droppableProps}
                              ref={provided.innerRef}
                              className={`flex-1 space-y-3 overflow-y-auto p-3 transition-colors ${
                                snapshot.isDraggingOver ? 'bg-indigo-500/5' : ''
                              }`}
                            >
                              {status.tasks.map((task, index) => (
                                <Draggable key={task.id} draggableId={task.id} index={index}>
                                  {(provided, snapshot) => (
                                    <button
                                      ref={provided.innerRef}
                                      {...provided.draggableProps}
                                      {...provided.dragHandleProps}
                                      onClick={() => setSelectedTaskId(task.id)}
                                      className={`w-full rounded-lg border border-[#3F4147] bg-[#2B2D31] p-3 text-left transition shadow-sm ${
                                        snapshot.isDragging ? 'border-indigo-500 shadow-xl scale-[1.02] z-50' : 'hover:border-indigo-400 hover:bg-[#313338]'
                                      }`}
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="font-semibold text-white">{task.title}</div>
                                        <span className={`rounded-full px-2 py-1 text-[10px] uppercase ${priorityClasses[task.priority]}`}>
                                          {task.priority}
                                        </span>
                                      </div>
                                      {task.description && (
                                        <div className="mt-2 line-clamp-3 text-xs text-[#b5bac1]">{task.description}</div>
                                      )}
                                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[#949ba4]">
                                        {task.assigneeUsername && (
                                          <div className="flex items-center gap-1">
                                            <div className="h-4 w-4 rounded-full bg-indigo-500 flex items-center justify-center text-[8px] text-white font-bold">
                                              {task.assigneeUsername[0].toUpperCase()}
                                            </div>
                                            <span>@{task.assigneeUsername}</span>
                                          </div>
                                        )}
                                        {task.dueAt && <span>Due {new Date(task.dueAt).toLocaleDateString()}</span>}
                                        {task.comments.length > 0 && <span>{task.comments.length} comments</span>}
                                      </div>
                                    </button>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                              {!status.tasks.length && !snapshot.isDraggingOver && (
                                <div className="rounded-lg border border-dashed border-[#3F4147] p-4 text-xs text-[#949ba4] text-center">
                                  No tasks here.
                                </div>
                              )}
                            </div>
                          )}
                        </Droppable>
                      </section>
                    ))}

                    {canEditProject && (
                      <section className="w-[260px] shrink-0 rounded-xl border border-dashed border-[#3F4147] bg-[#232428]/70 p-4">
                        <div className="text-sm font-semibold text-white">Add Column</div>
                        <div className="mt-3 space-y-2">
                          <input
                            value={newStatusName}
                            onChange={(event) => setNewStatusName(event.target.value)}
                            placeholder="Status name"
                            className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white placeholder:text-[#6d6f78] focus:outline-none"
                          />
                          <input
                            type="color"
                            value={newStatusColor}
                            onChange={(event) => setNewStatusColor(event.target.value)}
                            className="h-10 w-full rounded-md border border-[#3F4147] bg-[#313338] px-2"
                          />
                          <button
                            onClick={createStatus}
                            className="w-full rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                          >
                            Create Status
                          </button>
                        </div>
                      </section>
                    )}
                  </div>
                </DragDropContext>
              ) : (
                <div className="h-full overflow-auto p-4">
                  <div className="overflow-hidden rounded-xl border border-[#1E1F22] bg-[#232428]">
                    <table className="min-w-full divide-y divide-[#1E1F22] text-left">
                      <thead className="bg-[#1E1F22] text-xs uppercase tracking-[0.2em] text-[#949ba4]">
                        <tr>
                          <th className="px-4 py-3">Task</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Assignee</th>
                          <th className="px-4 py-3">Due</th>
                          <th className="px-4 py-3">Priority</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1E1F22]">
                        {currentProject.tasks.map((task) => (
                          <tr
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                            className="cursor-pointer bg-[#232428] transition hover:bg-[#2B2D31]"
                          >
                            <td className="px-4 py-4">
                              <div className="font-semibold text-white">{task.title}</div>
                              {task.description && (
                                <div className="mt-1 line-clamp-2 text-xs text-[#b5bac1]">{task.description}</div>
                              )}
                            </td>
                            <td className="px-4 py-4 text-sm text-[#b5bac1]">
                              <div className="flex items-center gap-2">
                                <span 
                                  className="h-2 w-2 rounded-full" 
                                  style={{ backgroundColor: currentProject.statuses.find((s) => s.id === task.statusId)?.color || '#5865F2' }} 
                                />
                                {currentProject.statuses.find((status) => status.id === task.statusId)?.name || 'Unknown'}
                              </div>
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
                        {!currentProject.tasks.length && (
                          <tr>
                            <td colSpan={5} className="px-4 py-12 text-center text-sm text-[#949ba4]">
                              This project has no tasks yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {isCreatingProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[#1E1F22] bg-[#232428] p-6">
            <h2 className="text-xl font-bold text-white">Create Project</h2>
            <div className="mt-4 space-y-4">
              <input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="Project name"
                className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white placeholder:text-[#6d6f78] focus:outline-none"
              />
              <textarea
                value={newProjectDescription}
                onChange={(event) => setNewProjectDescription(event.target.value)}
                placeholder="Project description"
                rows={4}
                className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white placeholder:text-[#6d6f78] focus:outline-none"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsCreatingProject(false)}
                className="rounded-md px-4 py-2 text-sm font-semibold text-[#b5bac1] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={createProject}
                className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {isManagingMembers && currentProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[#1E1F22] bg-[#232428] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white">Project Access</h2>
                <p className="mt-1 text-sm text-[#b5bac1]">Grant project-specific access to workspace members.</p>
              </div>
              <button onClick={() => setIsManagingMembers(false)} className="text-[#949ba4] hover:text-white">
                Close
              </button>
            </div>

            <div className="mt-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-3">
                {workspaceMembers.map((member) => {
                  const projectMembership = currentProject.members.find((projectMember) => projectMember.username === member.username);
                  const effectiveRole =
                    member.role === 'owner' ? 'project_owner' : (projectMembership?.role || '');

                  return (
                    <div
                      key={member.username}
                      className="flex items-center justify-between gap-4 rounded-lg border border-[#1E1F22] bg-[#2B2D31] p-4"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-white">{member.username}</div>
                        <div className="text-xs text-[#949ba4]">
                          Workspace role: {member.role}
                          {member.role === 'owner' ? ' • Full project access by default' : ''}
                        </div>
                      </div>

                      <select
                        disabled={member.role === 'owner'}
                        value={effectiveRole}
                        onChange={(event) => updateMemberRole(member.username, event.target.value)}
                        className="rounded-md border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white focus:outline-none disabled:opacity-50"
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
        </div>
      )}

      {currentTask && taskDraft && currentProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/60">
          <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-[#1E1F22] bg-[#232428] shadow-2xl">
            <div className="border-b border-[#1E1F22] px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-[#949ba4]">Task Detail</div>
                  <h2 className="mt-1 text-2xl font-bold text-white">{currentTask.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {canEditProject && (
                    <button
                      onClick={() => socket.emit('task-archive', { taskId: currentTask.id, username })}
                      className="rounded-md bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedTaskId(null)}
                    className="rounded-md bg-[#313338] px-3 py-2 text-sm font-semibold text-[#b5bac1] transition hover:text-white"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4 md:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Title</label>
                  <input
                    value={taskDraft.title}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                    disabled={!canEditProject}
                    className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none disabled:opacity-70"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Status</label>
                  <select
                    value={taskDraft.statusId}
                    disabled={!canEditProject}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, statusId: event.target.value } : prev))}
                    className="mt-2 w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none disabled:opacity-70"
                  >
                    {currentProject.statuses.map((status) => (
                      <option key={status.id} value={status.id}>
                        {status.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Priority</label>
                  <select
                    value={taskDraft.priority}
                    disabled={!canEditProject}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, priority: event.target.value as Priority } : prev))
                    }
                    className="mt-2 w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none disabled:opacity-70"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Assignee</label>
                  <select
                    value={taskDraft.assigneeUsername}
                    disabled={!canEditProject}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, assigneeUsername: event.target.value } : prev))
                    }
                    className="mt-2 w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none disabled:opacity-70"
                  >
                    <option value="">Unassigned</option>
                    {currentProject.members.map((member) => (
                      <option key={member.username} value={member.username}>
                        {member.username}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Due Date</label>
                  <input
                    type="date"
                    value={taskDraft.dueAt}
                    disabled={!canEditProject}
                    onChange={(event) => setTaskDraft((prev) => (prev ? { ...prev, dueAt: event.target.value } : prev))}
                    className="mt-2 w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none disabled:opacity-70"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#949ba4]">Description</label>
                  <textarea
                    value={taskDraft.description}
                    disabled={!canEditProject}
                    onChange={(event) =>
                      setTaskDraft((prev) => (prev ? { ...prev, description: event.target.value } : prev))
                    }
                    rows={6}
                    className="mt-2 w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none disabled:opacity-70"
                  />
                </div>
              </div>

              {canEditProject && (
                <div className="mt-4">
                  <button
                    onClick={saveTaskDraft}
                    className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                  >
                    Save Task
                  </button>
                </div>
              )}

              <section className="mt-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">Checklist</h3>
                  <div className="text-xs text-[#949ba4]">
                    {currentTask.checklist.filter((item) => item.completed).length}/{currentTask.checklist.length} done
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {currentTask.checklist.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg bg-[#2B2D31] p-3">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        disabled={!canEditProject}
                        onChange={(event) =>
                          socket.emit('task-checklist-update', {
                            taskId: currentTask.id,
                            itemId: item.id,
                            username,
                            completed: event.target.checked,
                          })
                        }
                      />
                      <span className={`flex-1 text-sm ${item.completed ? 'text-[#949ba4] line-through' : 'text-white'}`}>
                        {item.text}
                      </span>
                      {canEditProject && (
                        <button
                          onClick={() =>
                            socket.emit('task-checklist-delete', { taskId: currentTask.id, itemId: item.id, username })
                          }
                          className="text-xs font-semibold text-red-300 hover:text-red-200"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {canEditProject && (
                  <div className="mt-3 flex gap-2">
                    <input
                      value={newChecklistText}
                      onChange={(event) => setNewChecklistText(event.target.value)}
                      placeholder="New checklist item"
                      className="flex-1 rounded-md border border-[#3F4147] bg-[#313338] px-3 py-2 text-sm text-white focus:outline-none"
                    />
                    <button
                      onClick={addChecklistItem}
                      className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-600"
                    >
                      Add
                    </button>
                  </div>
                )}
              </section>

              <section className="mt-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white">Attachments</h3>
                  {canEditProject && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-md bg-[#313338] px-3 py-2 text-sm font-semibold text-[#b5bac1] transition hover:text-white"
                    >
                      Upload
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" className="hidden" onChange={uploadAttachment} />

                <div className="mt-3 space-y-2">
                  {currentTask.attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      onClick={() =>
                        socket.emit('task-attachment-get', {
                          taskId: currentTask.id,
                          attachmentId: attachment.id,
                          username,
                        })
                      }
                      className="flex w-full items-center justify-between rounded-lg bg-[#2B2D31] p-3 text-left transition hover:bg-[#313338]"
                    >
                      <div>
                        <div className="font-semibold text-white">{attachment.name}</div>
                        <div className="text-xs text-[#949ba4]">
                          {attachment.sender} • {(attachment.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-indigo-300">Download</span>
                    </button>
                  ))}
                  {!currentTask.attachments.length && (
                    <div className="rounded-lg border border-dashed border-[#3F4147] p-4 text-sm text-[#949ba4]">
                      No attachments on this task yet.
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-8">
                <h3 className="text-lg font-bold text-white">Comments</h3>
                <div className="mt-3 space-y-3">
                  {currentTask.comments.map((comment) => (
                    <div key={comment.id} className="rounded-lg bg-[#2B2D31] p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-white">{comment.authorUsername}</div>
                        <div className="text-xs text-[#949ba4]">{new Date(comment.createdAt).toLocaleString()}</div>
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-[#dbdee1]">{comment.body}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3">
                  <textarea
                    value={newComment}
                    onChange={(event) => setNewComment(event.target.value)}
                    rows={3}
                    placeholder="Add a comment"
                    className="w-full rounded-md border border-[#3F4147] bg-[#313338] px-3 py-3 text-white focus:outline-none"
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      onClick={addComment}
                      className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-600"
                    >
                      Comment
                    </button>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
