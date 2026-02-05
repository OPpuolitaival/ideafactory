import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/index.js';
import { MODEL_OPTIONS } from '@ideafactory/shared';

interface ThoughtFeedProps {
  onClose: () => void;
}

function getModelColor(model?: string): string {
  const opt = MODEL_OPTIONS.find((m) => m.id === model);
  return opt?.color ?? '#6e56cf';
}

export function ThoughtFeed({ onClose }: ThoughtFeedProps) {
  const thoughts = useSessionStore((s) => s.thoughts);
  const stageModels = useSessionStore((s) => s.stageModels);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-3">
        <h3 className="text-sm font-medium text-gray-300">Agent Thoughts</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xs">
          Hide
        </button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-xs"
      >
        {thoughts.length === 0 && (
          <p className="text-gray-500 text-center mt-8">Agent thoughts will appear here...</p>
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
            <div key={t.id} className="flex gap-2">
              <span className="badge shrink-0" style={{ backgroundColor: `${color}20`, color }}>{t.agent}</span>
              <span className="text-gray-400">{t.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
