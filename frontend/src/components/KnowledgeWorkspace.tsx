'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '../lib/socket';

type NodeType = 'page' | 'database';
type PropertyType = 'text' | 'number' | 'checkbox' | 'select' | 'multi_select' | 'date' | 'person' | 'status' | 'relation';

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

interface KnowledgeWorkspaceProps {
  roomId: string;
  username: string;
  workspaceReady: boolean;
}

const prettyValue = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item))).join(', ');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const blockPlaceholders: Record<string, string> = {
  paragraph: 'Type a paragraph...',
  heading: 'Section heading',
  checklist: 'Checklist item',
  quote: 'Quote or note',
  code: 'Code snippet',
};

const nodeGlyph = (nodeType: NodeType) => (nodeType === 'page' ? '•' : '▦');

export default function KnowledgeWorkspace({ roomId, username, workspaceReady }: KnowledgeWorkspaceProps) {
  const socket = getSocket();
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeType, setSelectedNodeType] = useState<NodeType | null>(null);
  const [pageDetail, setPageDetail] = useState<PageDetail | null>(null);
  const [databaseDetail, setDatabaseDetail] = useState<DatabaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState<NodeType | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newPropertyType, setNewPropertyType] = useState<PropertyType>('text');
  const [newRecordTitle, setNewRecordTitle] = useState('');

  const pages = useMemo(() => nodes.filter((node) => node.nodeType === 'page'), [nodes]);
  const databases = useMemo(() => nodes.filter((node) => node.nodeType === 'database'), [nodes]);
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || pageDetail || databaseDetail,
    [nodes, selectedNodeId, pageDetail, databaseDetail]
  );

  const requestTree = () => socket.emit('workspace-tree-request', { roomId, username });

  useEffect(() => {
    if (!workspaceReady) return;

    requestTree();

    const onTree = (payload: { roomId: string; nodes: WorkspaceNode[] }) => {
      if (payload.roomId !== roomId) return;
      setNodes(payload.nodes);
    };

    const onChanged = (payload: { roomId: string; nodeId?: string | null }) => {
      if (payload.roomId !== roomId) return;
      requestTree();
      const nodeId = payload.nodeId || selectedNodeId;
      if (!nodeId) return;
      if (selectedNodeType === 'page') {
        socket.emit('workspace-page-get', { roomId, nodeId, username });
      } else if (selectedNodeType === 'database') {
        socket.emit('workspace-database-get', { roomId, nodeId, username });
      }
    };

    const onPage = (payload: { roomId: string; page: PageDetail }) => {
      if (payload.roomId !== roomId) return;
      setPageDetail(payload.page);
      setDatabaseDetail(null);
      setSelectedNodeId(payload.page.id);
      setSelectedNodeType('page');
    };

    const onDatabase = (payload: { roomId: string; database: DatabaseDetail }) => {
      if (payload.roomId !== roomId) return;
      setDatabaseDetail(payload.database);
      setPageDetail(null);
      setSelectedNodeId(payload.database.id);
      setSelectedNodeType('database');
    };

    const onWorkspaceError = (payload: { message: string }) => {
      setError(payload.message);
      window.setTimeout(() => setError(null), 4000);
    };

    socket.on('workspace-tree-data', onTree);
    socket.on('workspace-changed', onChanged);
    socket.on('workspace-page-data', onPage);
    socket.on('workspace-database-data', onDatabase);
    socket.on('workspace-error', onWorkspaceError);

    return () => {
      socket.off('workspace-tree-data', onTree);
      socket.off('workspace-changed', onChanged);
      socket.off('workspace-page-data', onPage);
      socket.off('workspace-database-data', onDatabase);
      socket.off('workspace-error', onWorkspaceError);
    };
  }, [workspaceReady, roomId, username, socket, selectedNodeId, selectedNodeType]);

  useEffect(() => {
    if (!workspaceReady || selectedNodeId) return;
    const firstNode = [...pages, ...databases][0];
    if (!firstNode) return;
    setSelectedNodeId(firstNode.id);
    setSelectedNodeType(firstNode.nodeType);
    if (firstNode.nodeType === 'page') {
      socket.emit('workspace-page-get', { roomId, nodeId: firstNode.id, username });
    } else {
      socket.emit('workspace-database-get', { roomId, nodeId: firstNode.id, username });
    }
  }, [workspaceReady, selectedNodeId, pages, databases, roomId, username, socket]);

  const createNode = () => {
    if (!showCreate || !newTitle.trim()) return;
    socket.emit(
      'workspace-node-create',
      {
        roomId,
        username,
        nodeType: showCreate,
        title: newTitle,
        description: newDescription,
      },
      (response: { ok: boolean; nodeId?: string; message?: string }) => {
        if (!response.ok || !response.nodeId) {
          setError(response.message || 'Failed to create node');
          return;
        }

        const nextType = showCreate;
        setShowCreate(null);
        setNewTitle('');
        setNewDescription('');
        setSelectedNodeId(response.nodeId);
        setSelectedNodeType(nextType);
        if (nextType === 'page') {
          socket.emit('workspace-page-get', { roomId, nodeId: response.nodeId, username });
        } else {
          socket.emit('workspace-database-get', { roomId, nodeId: response.nodeId, username });
        }
      }
    );
  };

  const savePageMeta = () => {
    if (!pageDetail) return;
    socket.emit('workspace-page-update', {
      nodeId: pageDetail.id,
      username,
      title: pageDetail.title,
      description: pageDetail.description,
    });
  };

  const saveBlock = (block: PageBlock, nextContent: string) => {
    if (!pageDetail) return;
    socket.emit('workspace-page-block-upsert', {
      nodeId: pageDetail.id,
      username,
      blockId: block.id,
      blockType: block.blockType,
      content: nextContent,
      orderIndex: block.orderIndex,
    });
  };

  const addBlock = (blockType: string) => {
    if (!pageDetail) return;
    socket.emit('workspace-page-block-upsert', {
      nodeId: pageDetail.id,
      username,
      blockType,
      content: '',
      orderIndex: pageDetail.blocks.length,
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

  const openNode = (node: WorkspaceNode) => {
    setSelectedNodeId(node.id);
    setSelectedNodeType(node.nodeType);
    if (node.nodeType === 'page') {
      socket.emit('workspace-page-get', { roomId, nodeId: node.id, username });
    } else {
      socket.emit('workspace-database-get', { roomId, nodeId: node.id, username });
    }
  };

  if (!workspaceReady) {
    return (
      <div className="flex h-full items-center justify-center bg-[#2b2a28] text-[#d9d4cc]">
        <div className="rounded-xl border border-[#45423d] bg-[#312f2c] px-6 py-5 text-sm">
          Preparing workspace session...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-[#f7f4ee] text-[#2f2a24]">
      <aside className="flex w-72 shrink-0 flex-col border-r border-[#e4ddd3] bg-[#fbf9f5]">
        <div className="border-b border-[#eee7dc] px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#8b8277]">Workspace</div>
          <div className="mt-2 text-sm leading-relaxed text-[#6c645b]">
            A calmer, page-first knowledge space for documents and structured objects.
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setShowCreate('page')}
              className="flex-1 rounded-lg border border-[#ded5c8] bg-white px-3 py-2 text-sm font-medium text-[#2f2a24] transition hover:bg-[#f5efe6]"
            >
              New page
            </button>
            <button
              onClick={() => setShowCreate('database')}
              className="flex-1 rounded-lg border border-[#ded5c8] bg-[#2f2a24] px-3 py-2 text-sm font-medium text-[#f9f7f3] transition hover:bg-[#433c34]"
            >
              New database
            </button>
          </div>
        </div>

        {error && (
          <div className="border-b border-[#f0c8bf] bg-[#fff1ee] px-4 py-3 text-sm text-[#9a4d3e]">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-4">
          <div className="mb-6">
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a0978b]">Pages</div>
            <div className="space-y-1">
              {pages.map((page) => (
                <button
                  key={page.id}
                  onClick={() => openNode(page)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                    selectedNodeId === page.id
                      ? 'bg-[#ece5da] text-[#241f19]'
                      : 'text-[#625b53] hover:bg-[#f1ece3] hover:text-[#241f19]'
                  }`}
                >
                  <span className="w-4 text-center text-[#8f8477]">{page.icon || nodeGlyph('page')}</span>
                  <span className="truncate">{page.title}</span>
                </button>
              ))}
              {!pages.length && <div className="px-2.5 py-2 text-sm italic text-[#9d9387]">No pages yet.</div>}
            </div>
          </div>

          <div>
            <div className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a0978b]">Databases</div>
            <div className="space-y-1">
              {databases.map((database) => (
                <button
                  key={database.id}
                  onClick={() => openNode(database)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${
                    selectedNodeId === database.id
                      ? 'bg-[#ece5da] text-[#241f19]'
                      : 'text-[#625b53] hover:bg-[#f1ece3] hover:text-[#241f19]'
                  }`}
                >
                  <span className="w-4 text-center text-[#8f8477]">{database.icon || nodeGlyph('database')}</span>
                  <span className="truncate">{database.title}</span>
                </button>
              ))}
              {!databases.length && <div className="px-2.5 py-2 text-sm italic text-[#9d9387]">No databases yet.</div>}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-[#fffdf9]">
        <div className="border-b border-[#eee7dc] bg-[#fffdf9] px-8 py-3">
          <div className="flex items-center gap-2 text-sm text-[#8d8479]">
            <span>Workspace</span>
            <span>/</span>
            <span className="font-medium text-[#4f473f]">{selectedNode?.title || 'Untitled'}</span>
          </div>
        </div>

        {!pageDetail && !databaseDetail && (
          <div className="flex flex-1 items-center justify-center px-8 py-16">
            <div className="max-w-xl text-center">
              <div className="text-sm uppercase tracking-[0.25em] text-[#a09588]">Pages & Databases</div>
              <h2 className="mt-4 text-4xl font-semibold tracking-tight text-[#241f19]">A quieter knowledge canvas</h2>
              <p className="mt-4 text-base leading-7 text-[#70675d]">
                Build pages for narrative thinking and databases for structured objects. The layout is intentionally more document-like, so content feels primary and controls stay secondary.
              </p>
            </div>
          </div>
        )}

        {pageDetail && (
          <div className="flex flex-1 min-h-0 justify-center overflow-y-auto px-8 py-10">
            <div className="w-full max-w-4xl">
              <div className="mb-8">
                <div className="mb-3 text-sm text-[#9a9084]">Page</div>
                <input
                  value={pageDetail.title}
                  onChange={(event) => setPageDetail((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                  onBlur={savePageMeta}
                  className="w-full bg-transparent text-5xl font-semibold tracking-tight text-[#241f19] focus:outline-none"
                />
                <textarea
                  value={pageDetail.description}
                  onChange={(event) => setPageDetail((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                  onBlur={savePageMeta}
                  rows={2}
                  placeholder="Add a short summary for this page..."
                  className="mt-4 w-full resize-none bg-transparent text-lg leading-7 text-[#7b7268] focus:outline-none"
                />
              </div>

              <div className="mb-6 flex flex-wrap gap-2">
                {['paragraph', 'heading', 'checklist', 'quote', 'code'].map((type) => (
                  <button
                    key={type}
                    onClick={() => addBlock(type)}
                    className="rounded-full border border-[#e2dace] bg-[#faf6ef] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[#7b7268] transition hover:bg-[#f1eadf] hover:text-[#312b25]"
                  >
                    Add {type}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                {pageDetail.blocks.map((block) => (
                  <div key={block.id} className="group rounded-xl px-3 py-2 transition hover:bg-[#f8f2e8]">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#a09588]">
                      {block.blockType}
                    </div>
                    <textarea
                      defaultValue={block.content}
                      onBlur={(event) => saveBlock(block, event.target.value)}
                      rows={block.blockType === 'heading' ? 2 : 4}
                      placeholder={blockPlaceholders[block.blockType] || 'Write here...'}
                      className={`w-full resize-none bg-transparent focus:outline-none ${
                        block.blockType === 'heading'
                          ? 'text-2xl font-semibold tracking-tight text-[#241f19]'
                          : block.blockType === 'quote'
                            ? 'border-l-2 border-[#d8cbb8] pl-4 text-base italic leading-7 text-[#5b544b]'
                            : block.blockType === 'code'
                              ? 'rounded-lg bg-[#2b2723] px-4 py-3 font-mono text-sm text-[#f7f3ed]'
                              : 'text-base leading-7 text-[#2f2a24]'
                      }`}
                    />
                  </div>
                ))}
              </div>

              {pageDetail.backlinks.length > 0 && (
                <div className="mt-12 rounded-2xl border border-[#eadfce] bg-[#fcf7ef] p-5">
                  <div className="text-sm font-semibold text-[#2f2a24]">Referenced From</div>
                  <div className="mt-3 space-y-2 text-sm text-[#6f665c]">
                    {pageDetail.backlinks.map((backlink, index) => (
                      <div key={`${backlink.sourceNodeId}-${index}`} className="rounded-lg bg-white/80 px-3 py-2">
                        Node `{backlink.sourceNodeId}`
                        {backlink.sourceRecordId ? ` · record ${backlink.sourceRecordId}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {databaseDetail && (
          <div className="flex flex-1 min-h-0 justify-center overflow-y-auto px-8 py-10">
            <div className="w-full max-w-6xl">
              <div className="mb-8">
                <div className="mb-3 text-sm text-[#9a9084]">Database</div>
                <input
                  value={databaseDetail.title}
                  onChange={(event) => setDatabaseDetail((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
                  onBlur={saveDatabaseMeta}
                  className="w-full bg-transparent text-5xl font-semibold tracking-tight text-[#241f19] focus:outline-none"
                />
                <textarea
                  value={databaseDetail.description}
                  onChange={(event) => setDatabaseDetail((prev) => (prev ? { ...prev, description: event.target.value } : prev))}
                  onBlur={saveDatabaseMeta}
                  rows={2}
                  placeholder="Describe what this database tracks..."
                  className="mt-4 w-full resize-none bg-transparent text-lg leading-7 text-[#7b7268] focus:outline-none"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  {databaseDetail.views.map((view) => (
                    <span
                      key={view.id}
                      className="rounded-full border border-[#e2dace] bg-[#faf6ef] px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] text-[#7b7268]"
                    >
                      {view.name}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mb-6 grid gap-3 rounded-2xl border border-[#eadfce] bg-[#fcf7ef] p-4 md:grid-cols-[1fr_auto_auto]">
                <input
                  value={newPropertyName}
                  onChange={(event) => setNewPropertyName(event.target.value)}
                  placeholder="Add a property"
                  className="rounded-lg border border-[#ded5c8] bg-white px-3 py-2 text-sm text-[#2f2a24] focus:outline-none"
                />
                <select
                  value={newPropertyType}
                  onChange={(event) => setNewPropertyType(event.target.value as PropertyType)}
                  className="rounded-lg border border-[#ded5c8] bg-white px-3 py-2 text-sm text-[#2f2a24] focus:outline-none"
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
                  className="rounded-lg border border-[#d7cbba] bg-[#2f2a24] px-4 py-2 text-sm font-medium text-[#f9f7f3]"
                >
                  Add property
                </button>
              </div>

              <div className="mb-4 flex gap-2">
                <input
                  value={newRecordTitle}
                  onChange={(event) => setNewRecordTitle(event.target.value)}
                  placeholder="Add a new record"
                  className="flex-1 rounded-lg border border-[#ded5c8] bg-white px-3 py-2 text-sm text-[#2f2a24] focus:outline-none"
                />
                <button
                  onClick={addRecord}
                  className="rounded-lg border border-[#d7cbba] bg-[#312b25] px-4 py-2 text-sm font-medium text-[#f9f7f3]"
                >
                  New record
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-[#eadfce] bg-white shadow-[0_1px_0_rgba(36,31,25,0.03)]">
                <table className="min-w-full divide-y divide-[#f0e8de]">
                  <thead className="bg-[#faf6ef]">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9a9084]">Title</th>
                      {databaseDetail.properties.map((property) => (
                        <th key={property.id} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9a9084]">
                          {property.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f5eee5]">
                    {databaseDetail.records.map((record) => (
                      <tr key={record.id} className="hover:bg-[#fcfaf5]">
                        <td className="px-4 py-3">
                          <input
                            defaultValue={record.title}
                            onBlur={(event) => updateRecord(record.id, event.target.value)}
                            className="w-56 bg-transparent text-sm font-medium text-[#241f19] focus:outline-none"
                          />
                        </td>
                        {databaseDetail.properties.map((property) => (
                          <td key={property.id} className="px-4 py-3">
                            <input
                              defaultValue={prettyValue(record.values[property.id])}
                              onBlur={(event) => updateRecord(record.id, record.title, property.id, event.target.value)}
                              className="w-40 bg-transparent text-sm text-[#6a6157] focus:outline-none"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!databaseDetail.records.length && (
                      <tr>
                        <td
                          colSpan={Math.max(1, databaseDetail.properties.length + 1)}
                          className="px-4 py-16 text-center text-sm text-[#9a9084]"
                        >
                          No records yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {databaseDetail.backlinks.length > 0 && (
                <div className="mt-10 rounded-2xl border border-[#eadfce] bg-[#fcf7ef] p-5">
                  <div className="text-sm font-semibold text-[#2f2a24]">Referenced From</div>
                  <div className="mt-3 space-y-2 text-sm text-[#6f665c]">
                    {databaseDetail.backlinks.map((backlink, index) => (
                      <div key={`${backlink.sourceNodeId}-${index}`} className="rounded-lg bg-white/80 px-3 py-2">
                        Node `{backlink.sourceNodeId}`
                        {backlink.sourceRecordId ? ` · record ${backlink.sourceRecordId}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-xl rounded-2xl border border-[#ddd4c8] bg-[#fffdf9] p-7 shadow-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9a9084]">
              Create {showCreate === 'page' ? 'Page' : 'Database'}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[#241f19]">
              {showCreate === 'page' ? 'Start a new page' : 'Start a new database'}
            </h2>
            <div className="mt-5 space-y-4">
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={showCreate === 'page' ? 'Untitled page' : 'Untitled database'}
                className="w-full rounded-xl border border-[#ded5c8] bg-white px-4 py-3 text-[#2f2a24] focus:outline-none"
              />
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                rows={4}
                placeholder="Optional summary"
                className="w-full rounded-xl border border-[#ded5c8] bg-white px-4 py-3 text-[#2f2a24] focus:outline-none"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setShowCreate(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-[#7d7469] transition hover:text-[#241f19]"
              >
                Cancel
              </button>
              <button
                onClick={createNode}
                className="rounded-lg bg-[#2f2a24] px-4 py-2 text-sm font-medium text-[#f9f7f3] transition hover:bg-[#443c34]"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
