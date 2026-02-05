interface TopbarProps {
  onSettingsClick: () => void;
  onSessionsClick: () => void;
}

export function Topbar({ onSettingsClick, onSessionsClick }: TopbarProps) {
  return (
    <header className="h-14 bg-bg-1 border-b border-bg-3 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-gray-100">Idea Factory</h1>
        <span className="text-xs text-gray-500 font-mono">v2</span>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={onSessionsClick} className="btn-ghost text-sm">
          Sessions
        </button>
        <button onClick={onSettingsClick} className="btn-ghost text-sm">
          Settings
        </button>
      </div>
    </header>
  );
}
