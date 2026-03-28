'use client';

import React, { useState } from 'react';

interface UserSettingsModalProps {
  username: string;
  avatarColor: string;
  avatarUrl: string | null;
  onSave: (color: string, url: string | null) => void;
  onClose: () => void;
}

const AVATAR_COLORS = [
  '#5865F2', '#EB459E', '#ED4245', '#FEE75C', '#3BA55C', 
  '#1ABC9C', '#2ECC71', '#3498DB', '#9B59B6', '#E91E63'
];

export default function UserSettingsModal({ username, avatarColor: initialColor, avatarUrl: initialUrl, onSave, onClose }: UserSettingsModalProps) {
  const [color, setColor] = useState(initialColor);
  const [url, setUrl] = useState(initialUrl);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4 font-sans">
      <div className="bg-[#313338] w-full max-w-lg rounded-lg overflow-hidden shadow-2xl flex">
        {/* Sidebar */}
        <div className="w-48 bg-[#2B2D31] p-6 flex flex-col">
          <h2 className="text-[11px] font-bold text-gray-400 uppercase mb-4">User Settings</h2>
          <div className="bg-[#3F4147] text-white px-2 py-1.5 rounded text-sm font-medium cursor-pointer">My Profile</div>
        </div>

        {/* Content */}
        <div className="flex-1 p-10 relative">
          <button onClick={onClose} className="absolute right-6 top-6 text-gray-400 hover:text-white transition">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>

          <h3 className="text-xl font-bold text-white mb-6">User Profile</h3>

          <div className="space-y-8">
            <div className="bg-[#1E1F22] rounded-lg p-4 flex items-center space-x-4">
              <div 
                className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold border-4 border-[#2B2D31] relative group overflow-hidden"
                style={{ backgroundColor: color }}
              >
                {url ? <img src={url} className="w-full h-full object-cover" /> : username[0].toUpperCase()}
                <label className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer text-[10px] font-bold uppercase">Change</label>
                <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
              </div>
              <div>
                <div className="text-lg font-bold text-white">{username}</div>
                <button onClick={() => setUrl(null)} className="text-[10px] text-gray-400 hover:text-red-400 uppercase font-bold mt-1">Remove Avatar</button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase mb-3">Theme Color</label>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map(c => (
                  <div 
                    key={c} 
                    onClick={() => setColor(c)}
                    className={`w-8 h-8 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-[#3F4147] flex justify-end space-x-4">
              <button onClick={onClose} className="text-white hover:underline text-sm font-medium">Cancel</button>
              <button onClick={() => onSave(color, url)} className="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2 rounded font-bold transition-colors">Save Changes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
