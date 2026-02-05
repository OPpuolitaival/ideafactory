import { useState } from 'react';
import { useSessionStore } from '../store/index.js';
import { useSSE } from '../hooks/useSSE.js';
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

export function App() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const stage = useSessionStore((s) => s.stage);
  const [showSettings, setShowSettings] = useState(false);
  const [showDashboard, setShowDashboard] = useState(true);
  const [thoughtsOpen, setThoughtsOpen] = useState(true);

  useSSE(sessionId);

  const handleSessionStart = () => {
    setShowDashboard(false);
  };

  const handleBackToDashboard = () => {
    useSessionStore.getState().reset();
    setShowDashboard(true);
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
      <StageBar />
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
    </div>
  );
}
