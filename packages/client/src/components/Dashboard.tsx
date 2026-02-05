import { useState } from 'react';
import { trpc } from '../trpc/index.js';
import { useSessionStore } from '../store/index.js';

interface DashboardProps {
  onStartSession: () => void;
}

export function Dashboard({ onStartSession }: DashboardProps) {
  const [domain, setDomain] = useState('');
  const sessionsQuery = trpc.session.list.useQuery();
  const startMutation = trpc.session.start.useMutation();
  const deleteMutation = trpc.session.delete.useMutation();
  const store = useSessionStore();

  const handleStart = async () => {
    if (!domain.trim()) return;
    const result = await startMutation.mutateAsync({ domain: domain.trim() });
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

    store.setSessionId(id);
    store.setDomain(session.domain);
    store.setStage(session.status as any);

    // Fetch full session data and hydrate store
    try {
      const full = await utils.session.get.fetch({ id });
      if (full.taxonomy?.tree) {
        store.setTaxonomy(full.taxonomy.tree);
        if (full.taxonomy.selectedPath) {
          store.setSelectedPath(full.taxonomy.selectedPath);
        }
      }
      if (full.methods) {
        store.setMethodRecommendations(full.methods.recommended, full.methods.reasoning);
        store.setSelectedMethods(full.methods.selected);
      }
      if (full.rubric) {
        store.setRubric(full.rubric);
      }
      if (full.output?.package) {
        store.setOutputPackage(full.output.package);
      }

      // Hydrate factory ideas by phase
      if (full.ideas && full.ideas.length > 0) {
        const divergeIdeas = full.ideas.filter((i) => i.phase === 'diverge');
        const convergeIdeas = full.ideas.filter((i) => i.phase === 'converge');
        const evolveIdeas = full.ideas.filter((i) => i.phase === 'evolve');
        const qaIdeas = full.ideas.filter((i) => i.phase === 'qa');

        // Diverge: group by workerId and add each idea
        for (const idea of divergeIdeas) {
          if (idea.workerId && idea.data) {
            store.addWorkerIdea(idea.workerId, idea.data);
          }
        }

        // Converge
        if (convergeIdeas.length > 0) {
          store.setScoredIdeas(convergeIdeas.filter((i) => i.data).map((i) => i.data));
        }

        // Evolve
        if (evolveIdeas.length > 0) {
          store.setEvolvedIdeas(evolveIdeas.filter((i) => i.data).map((i) => i.data));
        }

        // QA
        if (qaIdeas.length > 0) {
          store.setQAResults(qaIdeas.filter((i) => i.data).map((i) => i.data));
        }

        // Determine factory phase from what data exists
        if (qaIdeas.length > 0) {
          store.setFactoryPhase('qa');
        } else if (evolveIdeas.length > 0) {
          store.setFactoryPhase('evolve');
        } else if (convergeIdeas.length > 0) {
          store.setFactoryPhase('converge');
        } else if (divergeIdeas.length > 0) {
          store.setFactoryPhase('diverge');
        }

        // If stage is past factory, mark factory complete
        if (session.status === 'output' || session.status === 'completed') {
          store.setFactoryPhase('complete');
        }
      }

      // Hydrate thoughts from event log
      if (full.eventLog) {
        for (const entry of full.eventLog) {
          if (entry.type === 'agent:thought') {
            store.addThought(entry.data.agent, entry.data.text);
          } else if (entry.type === 'agent:tool_use') {
            store.addThought(entry.data.agent, `Using tool: ${entry.data.tool}`);
          }
        }
      }
    } catch {
      // Session data fetch failed, continue with empty store
    }

    onStartSession();
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync({ id });
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
                </div>
              </div>
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
          ))}
        </div>
      </div>
    </div>
  );
}
