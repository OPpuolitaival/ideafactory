import { useState } from 'react';
import { useSessionStore } from '../../store/index.js';
import { trpc } from '../../trpc/index.js';
import type { TaxonomyNode } from '@ideafactory/shared';

export function TaxonomyStage({ readOnly }: { readOnly?: boolean } = {}) {
  const { taxonomy, selectedPath, isLoading, sessionId, setSelectedPath, setStage, setLoading } =
    useSessionStore();
  const advanceMutation = trpc.session.advance.useMutation();
  const [filter, setFilter] = useState('');

  const handleLock = async () => {
    if (!sessionId || selectedPath.length === 0) return;
    setLoading(true);
    await advanceMutation.mutateAsync({
      sessionId,
      stage: 'methods',
      data: { selectedPath },
    });
    setStage('methods');
    setLoading(true);
  };

  if (isLoading && !taxonomy) {
    return (
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">Stage 1: Taxonomy</h2>
        <p className="text-gray-400 mb-6">Mapping the problem space...</p>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" style={{ animationDelay: `${i * 100}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Stage 1: Taxonomy</h2>
      <p className="text-gray-400 mb-4">
        Browse the problem space and select a coordinate to explore.
      </p>

      {selectedPath.length > 0 && (
        <div className="mb-4 px-4 py-2 bg-accent/10 border border-accent/30 rounded-lg">
          <span className="text-sm text-accent-light font-medium">
            Selected: {selectedPath.join(' > ')}
          </span>
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter taxonomy..."
          className="input w-full"
        />
      </div>

      {isLoading && taxonomy && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-accent" />
          Expanding taxonomy branches...
        </div>
      )}

      {taxonomy && (
        <div className="card">
          <TaxonomyTree
            node={taxonomy}
            path={[]}
            selectedPath={selectedPath}
            onSelect={readOnly ? () => {} : setSelectedPath}
            filter={filter.toLowerCase()}
          />
        </div>
      )}

      {!readOnly && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleLock}
            disabled={selectedPath.length === 0 || advanceMutation.isPending}
            className="btn-primary"
          >
            {advanceMutation.isPending ? 'Advancing...' : 'Lock & Continue'}
          </button>
        </div>
      )}
    </div>
  );
}

function TaxonomyTree({
  node,
  path,
  selectedPath,
  onSelect,
  filter,
  depth = 0,
}: {
  node: TaxonomyNode;
  path: string[];
  selectedPath: string[];
  onSelect: (path: string[]) => void;
  filter: string;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const currentPath = [...path, node.name];
  const isSelected =
    currentPath.length === selectedPath.length &&
    currentPath.every((p, i) => p === selectedPath[i]);
  const hasChildren = node.children && node.children.length > 0;

  const matchesFilter =
    !filter || node.name.toLowerCase().includes(filter) || matchesChildFilter(node, filter);

  if (!matchesFilter) return null;

  const probBadge =
    node.p === 'high' ? 'badge-high' : node.p === 'medium' ? 'badge-medium' : 'badge-low';

  return (
    <div className={depth > 0 ? 'ml-4 border-l border-bg-3 pl-3' : ''}>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-all duration-200 ${
          isSelected
            ? 'bg-accent/20 border border-accent/30'
            : 'hover:bg-bg-3'
        }`}
        onClick={() => onSelect(currentPath)}
      >
        {hasChildren && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="text-gray-500 hover:text-gray-300 w-4 text-center"
          >
            {expanded ? '▼' : '▶'}
          </button>
        )}
        {!hasChildren && <span className="w-4" />}
        <span className="font-medium text-sm">{node.name}</span>
        <span className={probBadge}>{node.p}</span>
      </div>
      {expanded &&
        hasChildren &&
        node.children!.map((child, i) => (
          <TaxonomyTree
            key={`${child.name}-${i}`}
            node={child}
            path={currentPath}
            selectedPath={selectedPath}
            onSelect={onSelect}
            filter={filter}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function matchesChildFilter(node: TaxonomyNode, filter: string): boolean {
  if (!node.children) return false;
  return node.children.some(
    (child) =>
      child.name.toLowerCase().includes(filter) || matchesChildFilter(child, filter),
  );
}
