import { useState, useEffect } from 'react';
import { trpc } from '../trpc/index.js';
import { useSessionStore } from '../store/index.js';
import { ModelSelector } from './ModelSelector.js';
import { MODEL_OPTIONS } from '@ideafactory/shared';

interface DashboardProps {
  onStartSession: () => void;
}

export function Dashboard({ onStartSession }: DashboardProps) {
  const [domain, setDomain] = useState('');
  const [modelsOpen, setModelsOpen] = useState(false);
  const configQuery = trpc.config.getConfig.useQuery();
  const sessionsQuery = trpc.session.list.useQuery();
  const startMutation = trpc.session.start.useMutation();
  const deleteMutation = trpc.session.delete.useMutation();
  const duplicateMutation = trpc.session.duplicate.useMutation();
  const store = useSessionStore();

  const [models, setModels] = useState({
    navigator: 'claude-opus-4-6',
    strategist: 'claude-opus-4-6',
    worker: 'claude-opus-4-6',
    analyst: 'claude-opus-4-6',
  });
  const [modelsInitialized, setModelsInitialized] = useState(false);

  // Sync model defaults from config.yaml once loaded
  useEffect(() => {
    if (configQuery.data?.models && !modelsInitialized) {
      const cm = configQuery.data.models;
      setModels({
        navigator: cm.navigator ?? 'claude-opus-4-6',
        strategist: cm.strategist ?? 'claude-opus-4-6',
        worker: cm.worker ?? 'claude-opus-4-6',
        analyst: cm.analyst ?? 'claude-opus-4-6',
      });
      setModelsInitialized(true);
    }
  }, [configQuery.data, modelsInitialized]);

  const handleStart = async () => {
    if (!domain.trim()) return;
    const result = await startMutation.mutateAsync({
      domain: domain.trim(),
      config: { models },
    });
    store.setSessionId(result.sessionId);
    store.setDomain(domain.trim());
    store.setStage('taxonomy');
    store.setLoading(true);
    onStartSession();
  };

  const utils = trpc.useUtils();

  const handleResume = async (id: string) => {
    const session = sessionsQuery.data?.find((s) => s.id === id);
    if (!session) return;

    try {
      const full = await utils.session.get.fetch({ id });
      store.hydrateFromSession(full);
    } catch {
      store.setSessionId(id);
      store.setDomain(session.domain);
      store.setStage(session.status as any);
    }

    onStartSession();
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync({ id });
    sessionsQuery.refetch();
  };

  const handleDuplicate = async (id: string) => {
    await duplicateMutation.mutateAsync({ id });
    sessionsQuery.refetch();
  };

  return (
    <div className="flex-1 p-6 max-w-4xl mx-auto w-full">
      <div className="mb-12 mt-8">
        <h2 className="text-3xl font-bold mb-2">Start a new session</h2>
        <p className="text-gray-400 mb-6">
          Enter a domain to explore. The more specific or broad — it's up to you.
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleStart()}
            placeholder='e.g., "Future of Chairs", "Sustainable Packaging"'
            className="input flex-1 text-lg"
            autoFocus
          />
          <button
            onClick={handleStart}
            disabled={!domain.trim() || startMutation.isPending}
            className="btn-primary text-lg px-8"
          >
            {startMutation.isPending ? 'Starting...' : 'Generate'}
          </button>
        </div>
        <div className="mt-3">
          <button
            onClick={() => setModelsOpen(!modelsOpen)}
            className="btn-ghost text-xs text-gray-400"
          >
            {modelsOpen ? '▾' : '▸'} Models
          </button>
          {modelsOpen && (
            <div className="mt-2 space-y-2 p-3 bg-bg-1 rounded-lg border border-bg-3">
              <ModelSelector
                role="Navigator"
                value={models.navigator}
                onChange={(v) => setModels((m) => ({ ...m, navigator: v }))}
              />
              <ModelSelector
                role="Strategist"
                value={models.strategist}
                onChange={(v) => setModels((m) => ({ ...m, strategist: v }))}
              />
              <ModelSelector
                role="Worker"
                value={models.worker}
                onChange={(v) => setModels((m) => ({ ...m, worker: v }))}
              />
              <ModelSelector
                role="Analyst"
                value={models.analyst}
                onChange={(v) => setModels((m) => ({ ...m, analyst: v }))}
              />
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xl font-semibold mb-4">Past Sessions</h3>
        {sessionsQuery.isLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-20 w-full" />
            ))}
          </div>
        )}
        {sessionsQuery.data?.length === 0 && (
          <p className="text-gray-500">No sessions yet. Start one above.</p>
        )}
        <div className="space-y-3">
          {sessionsQuery.data?.map((session) => (
            <div
              key={session.id}
              className="card-hover flex items-center justify-between"
              onClick={() => handleResume(session.id)}
            >
              <div>
                <h4 className="font-medium">{session.domain}</h4>
                <div className="flex items-center gap-3 mt-1">
                  {session.coordinate && (
                    <span className="text-sm text-accent">{session.coordinate}</span>
                  )}
                  <span className="text-xs text-gray-500">
                    {new Date(session.createdAt).toLocaleDateString()}
                  </span>
                  <span
                    className={`badge ${
                      session.status === 'completed'
                        ? 'bg-success/20 text-success'
                        : 'bg-warning/20 text-warning'
                    }`}
                  >
                    {session.status === 'completed' ? 'Completed' : `In progress: ${session.status}`}
                  </span>
                  {session.config?.models && (() => {
                    const sm = session.config.models;
                    const allSame = sm.navigator === sm.strategist && sm.strategist === sm.worker && sm.worker === sm.analyst;
                    const opt = MODEL_OPTIONS.find((o) => o.id === sm.navigator);
                    return (
                      <span
                        className="badge"
                        style={allSame && opt
                          ? { backgroundColor: `${opt.color}20`, color: opt.color }
                          : { backgroundColor: 'rgba(110,86,207,0.2)', color: '#8b78e6' }
                        }
                      >
                        {allSame && opt ? opt.label : 'Mixed'}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDuplicate(session.id);
                  }}
                  className="btn-ghost text-sm"
                >
                  Duplicate
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(session.id);
                  }}
                  className="btn-ghost text-danger text-sm"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
