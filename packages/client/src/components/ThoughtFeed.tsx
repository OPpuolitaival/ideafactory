import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/index.js';

interface ThoughtFeedProps {
  onClose: () => void;
}

export function ThoughtFeed({ onClose }: ThoughtFeedProps) {
  const thoughts = useSessionStore((s) => s.thoughts);
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
        {thoughts.map((t) => (
          <div key={t.id} className="flex gap-2">
            <span className="badge bg-accent/20 text-accent-light shrink-0">{t.agent}</span>
            <span className="text-gray-400">{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
