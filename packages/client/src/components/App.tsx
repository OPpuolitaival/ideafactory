import { useState, useEffect } from 'react';
import { useSessionStore } from '../store/index.js';
import { useSSE } from '../hooks/useSSE.js';
import { trpc } from '../trpc/index.js';
import { Topbar } from './Topbar.js';
import { StageBar } from './StageBar.js';
import { ThoughtFeed } from './ThoughtFeed.js';
import { Dashboard } from './Dashboard.js';
import { TaxonomyStage } from './stages/TaxonomyStage.js';
import { MethodsStage } from './stages/MethodsStage.js';
import { RubricStage } from './stages/RubricStage.js';
import { FactoryStage } from './stages/FactoryStage.js';
import { SettingsDialog } from './SettingsDialog.js';
import { RollbackModal } from './RollbackModal.js';
import { ErrorBanner } from './ErrorBanner.js';
import type { Stage } from '@ideafactory/shared';

type RollbackStage = Exclude<Stage, 'completed'>;

export function App() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const stage = useSessionStore((s) => s.stage);
  const [showSettings, setShowSettings] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [viewingStage, setViewingStage] = useState<Stage | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<RollbackStage | null>(null);

  const rollbackMutation = trpc.session.rollback.useMutation();
  const duplicateMutation = trpc.session.duplicate.useMutation();
  const utils = trpc.useUtils();

  useSSE(sessionId);

  // Clear viewing state when the pipeline advances
  useEffect(() => {
    setViewingStage(null);
  }, [stage]);

  const handleSessionStart = () => {
    setShowDashboard(false);
  };

  const handleBackToDashboard = () => {
    useSessionStore.getState().reset();
    setShowDashboard(true);
  };

  const handleRollback = async (targetStage: RollbackStage) => {
    if (!sessionId) return;
    setRollbackTarget(null);
    await rollbackMutation.mutateAsync({ id: sessionId, toStage: targetStage });
    useSessionStore.getState().clearDownstreamState(targetStage);
  };

  const handleDuplicateAndRollback = async (targetStage: RollbackStage) => {
    if (!sessionId) return;
    setRollbackTarget(null);
    const { sessionId: newId } = await duplicateMutation.mutateAsync({ id: sessionId });
    await rollbackMutation.mutateAsync({ id: newId, toStage: targetStage });
    useSessionStore.getState().reset();
    const full = await utils.session.get.fetch({ id: newId });
    useSessionStore.getState().hydrateFromSession(full);
  };

  if (showDashboard && !sessionId) {
    return (
      <div className="min-h-screen flex flex-col">
        <Topbar
          onSettingsClick={() => setShowSettings(true)}
          onSessionsClick={() => setShowDashboard(true)}
        />
        <Dashboard onStartSession={handleSessionStart} />
        {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  const displayStage = viewingStage ?? stage;
  const isReadOnly = viewingStage !== null;

  const stageComponent = (() => {
    switch (displayStage) {
      case 'taxonomy':
        return <TaxonomyStage readOnly={isReadOnly} />;
      case 'methods':
        return <MethodsStage readOnly={isReadOnly} />;
      case 'rubric':
        return <RubricStage readOnly={isReadOnly} />;
      case 'factory':
      case 'completed':
        return <FactoryStage />;
      default:
        return <TaxonomyStage readOnly={isReadOnly} />;
    }
  })();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Topbar
        onSettingsClick={() => setShowSettings(true)}
        onSessionsClick={handleBackToDashboard}
      />
      <StageBar
        viewingStage={viewingStage}
        onStageClick={(s) => setViewingStage(viewingStage === s ? null : (s as Stage))}
      />
      <ErrorBanner />
      {viewingStage && (
        <div className="flex items-center justify-between px-6 py-2 bg-accent/5 border-b border-accent/20 text-sm">
          <span className="text-accent-light">
            Viewing <span className="font-medium">{viewingStage}</span> stage (read-only)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setViewingStage(null)}
              className="btn-ghost text-xs"
            >
              Back to current
            </button>
            <button
              onClick={() => {
                if (!viewingStage || viewingStage === 'completed') return;
                setViewingStage(null);
                setRollbackTarget(viewingStage);
              }}
              className="btn-ghost text-xs text-warning"
            >
              Edit from here...
            </button>
          </div>
        </div>
      )}
      <main className="flex-1 overflow-y-auto p-6">{stageComponent}</main>
      <ThoughtFeed />
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {rollbackTarget && (
        <RollbackModal
          targetStage={rollbackTarget}
          onEditSession={() => handleRollback(rollbackTarget)}
          onDuplicateAndEdit={() => handleDuplicateAndRollback(rollbackTarget)}
          onCancel={() => setRollbackTarget(null)}
        />
      )}
    </div>
  );
}
