import { useEffect, useRef, useState, useCallback } from 'react';
import { useSessionStore } from '../store/index.js';
import { MODEL_OPTIONS } from '@ideafactory/shared';

function getModelColor(model?: string): string {
  const opt = MODEL_OPTIONS.find((m) => m.id === model);
  return opt?.color ?? '#6e56cf';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

const SSE_STATUS_CONFIG = {
  connected: { color: 'bg-green-500', label: '' },
  connecting: { color: 'bg-yellow-500 animate-pulse', label: 'Connecting...' },
  reconnecting: { color: 'bg-yellow-500 animate-pulse', label: 'Reconnecting...' },
  disconnected: { color: 'bg-red-500', label: 'Disconnected' },
} as const;

const MIN_HEIGHT = 80;
const MAX_HEIGHT_RATIO = 0.5;

export function ThoughtFeed() {
  const thoughts = useSessionStore((s) => s.thoughts);
  const stageModels = useSessionStore((s) => s.stageModels);
  const sseStatus = useSessionStore((s) => s.sseStatus);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(200);
  const dragging = useRef(false);

  useEffect(() => {
    if (autoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thoughts]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScroll.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startY = e.clientY;
    const startHeight = height;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY - ev.clientY;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
      setHeight(Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight + delta)));
    };

    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height]);

  return (
    <div className="border-t border-bg-3 bg-bg-1 flex flex-col" style={collapsed ? undefined : { height }}>
      {/* Drag handle */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          className="h-1.5 cursor-row-resize flex items-center justify-center hover:bg-bg-3 transition-colors shrink-0"
        >
          <div className="w-8 h-0.5 rounded bg-gray-600" />
        </div>
      )}

      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0 cursor-pointer select-none"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">Agent Thoughts</h3>
          <span
            className={`inline-block w-2 h-2 rounded-full ${SSE_STATUS_CONFIG[sseStatus].color}`}
            title={sseStatus}
          />
          {SSE_STATUS_CONFIG[sseStatus].label && (
            <span className="text-xs text-gray-500">
              {SSE_STATUS_CONFIG[sseStatus].label}
            </span>
          )}
        </div>
        <span className="text-gray-500 text-xs">{collapsed ? '▲' : '▼'}</span>
      </div>

      {/* Content */}
      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 pb-2 space-y-1 font-mono text-xs min-h-0"
        >
          {thoughts.length === 0 && (
            <p className="text-gray-500 text-center mt-4">Agent thoughts will appear here...</p>
          )}
          {thoughts.map((t) => {
            if (t.stageCheckpoint) {
              const checkpointColor = getModelColor(stageModels[t.stageCheckpoint]);
              return (
                <div key={t.id} className="flex items-center gap-2 py-2 my-1">
                  <div className="flex-1 h-px" style={{ backgroundColor: `${checkpointColor}4D` }} />
                  <span className="text-xs font-medium px-2" style={{ color: checkpointColor }}>{t.text}</span>
                  <div className="flex-1 h-px" style={{ backgroundColor: `${checkpointColor}4D` }} />
                </div>
              );
            }
            const color = getModelColor(t.model);
            return (
              <div key={t.id} className="flex gap-2 items-start">
                <span className="text-gray-600 shrink-0">{formatTime(t.timestamp)}</span>
                <span className="badge shrink-0" style={{ backgroundColor: `${color}20`, color }}>{t.agent}</span>
                <span className="text-gray-400">{t.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
