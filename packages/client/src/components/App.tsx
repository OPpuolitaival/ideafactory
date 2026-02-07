import { useState } from 'react';
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
import { OutputStage } from './stages/OutputStage.js';
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
  const [thoughtsOpen, setThoughtsOpen] = useState(true);
  const [rollbackTarget, setRollbackTarget] = useState<RollbackStage | null>(null);

  const rollbackMutation = trpc.session.rollback.useMutation();
  const duplicateMutation = trpc.session.duplicate.useMutation();
  const utils = trpc.useUtils();

  useSSE(sessionId);

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

  const stageComponent = (() => {
    switch (stage) {
      case 'taxonomy':
        return <TaxonomyStage />;
      case 'methods':
        return <MethodsStage />;
      case 'rubric':
        return <RubricStage />;
      case 'factory':
        return <FactoryStage />;
      case 'output':
      case 'completed':
        return <OutputStage />;
      default:
        return <TaxonomyStage />;
    }
  })();

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar
        onSettingsClick={() => setShowSettings(true)}
        onSessionsClick={handleBackToDashboard}
      />
      <StageBar onStageClick={(s) => setRollbackTarget(s as RollbackStage)} />
      <ErrorBanner />
      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">{stageComponent}</main>
        {thoughtsOpen && (
          <aside className="w-80 border-l border-bg-3 flex flex-col">
            <ThoughtFeed onClose={() => setThoughtsOpen(false)} />
          </aside>
        )}
        {!thoughtsOpen && (
          <button
            onClick={() => setThoughtsOpen(true)}
            className="fixed right-4 bottom-4 btn-secondary text-xs"
          >
            Show Thoughts
          </button>
        )}
      </div>
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
