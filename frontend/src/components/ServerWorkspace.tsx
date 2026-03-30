'use client';

import { useEffect, useState } from 'react';
import ChatRoom from './ChatRoom';
import WorkspaceHub from './WorkspaceHub';
import { getSocket } from '../lib/socket';

interface ServerInfo {
  id: string;
  name: string;
}

interface ServerWorkspaceProps {
  roomId: string;
  username: string;
  joinedServers: ServerInfo[];
  onSwitchServer: (id: string) => void;
  onLeaveHome: () => void;
}

export default function ServerWorkspace({
  roomId,
  username,
  joinedServers,
  onSwitchServer,
  onLeaveHome,
}: ServerWorkspaceProps) {
  const socket = getSocket();
  const [activePanel, setActivePanel] = useState<'chat' | 'workspace'>('chat');
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [workspaceRole, setWorkspaceRole] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    const onWorkspaceReady = (payload: { roomId: string; roomRole: string }) => {
      if (payload.roomId !== roomId) return;
      setWorkspaceReady(true);
      setWorkspaceRole(payload.roomRole);
      setWorkspaceError(null);
    };

    const onWorkspaceError = (payload: { message: string }) => {
      setWorkspaceError(payload.message);
    };

    socket.on('workspace-ready', onWorkspaceReady);
    socket.on('workspace-error', onWorkspaceError);

    socket.emit('workspace-join', { roomId, username }, (response: { ok: boolean; roomRole?: string; message?: string }) => {
      if (response.ok) {
        setWorkspaceReady(true);
        setWorkspaceRole(response.roomRole || null);
        setWorkspaceError(null);
      } else {
        setWorkspaceReady(false);
        setWorkspaceError(response.message || 'Failed to join workspace');
      }
    });

    return () => {
      socket.off('workspace-ready', onWorkspaceReady);
      socket.off('workspace-error', onWorkspaceError);
    };
  }, [roomId, username, socket]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#313338]">
      <div className="h-13 shrink-0 border-b border-[#1E1F22] bg-[#232428] px-4">
        <div className="flex h-full items-center gap-2">
          <button
            onClick={() => setActivePanel('chat')}
            title="Chat"
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              activePanel === 'chat'
                ? 'border-[#3F4147] bg-[#313338] text-white shadow-sm'
                : 'border-transparent text-[#b5bac1] hover:border-[#3F4147] hover:bg-[#313338] hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M8 10h8M8 14h5M5 19l1.8-3.6A8 8 0 115 19z" /></svg>
          </button>
          <button
            onClick={() => setActivePanel('workspace')}
            title="Workspace"
            className={`flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              activePanel === 'workspace'
                ? 'border-[#3F4147] bg-[#313338] text-white shadow-sm'
                : 'border-transparent text-[#b5bac1] hover:border-[#3F4147] hover:bg-[#313338] hover:text-white'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M4 7h16M7 4v6m10-6v6M5 11h14v9H5z" /></svg>
          </button>
          <div className="ml-2 text-sm font-medium text-white">{activePanel === 'chat' ? 'Chat' : 'Workspace'}</div>
          {workspaceRole && (
            <span className="ml-auto rounded-full bg-[#313338] px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-[#949ba4] shadow-sm">
              {workspaceRole}
            </span>
          )}
        </div>
      </div>

      {workspaceError && (
        <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {workspaceError}
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <div className={activePanel === 'chat' ? 'h-full' : 'hidden h-full'}>
          <ChatRoom
            roomId={roomId}
            username={username}
            joinedServers={joinedServers}
            onSwitchServer={onSwitchServer}
            onLeaveHome={onLeaveHome}
          />
        </div>

        <div className={activePanel === 'workspace' ? 'h-full' : 'hidden h-full'}>
          <WorkspaceHub roomId={roomId} username={username} workspaceReady={workspaceReady} />
        </div>
      </div>
    </div>
  );
}
