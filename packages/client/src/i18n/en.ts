const en = {
  // Topbar
  'topbar.title': 'Idea Factory',
  'topbar.version': 'v2',
  'topbar.sessions': 'Sessions',
  'topbar.settings': 'Settings',

  // Language
  'language.en': 'English',
  'language.fi': 'Suomi',
  'language.label': 'Language',

  // Dashboard
  'dashboard.startTitle': 'Start a new session',
  'dashboard.startDescription':
    "Enter a domain to explore. The more specific or broad — it's up to you.",
  'dashboard.placeholder': 'e.g., "Future of Chairs", "Sustainable Packaging"',
  'dashboard.generate': 'Generate',
  'dashboard.starting': 'Starting...',
  'dashboard.models': 'Models',
  'dashboard.pastSessions': 'Past Sessions',
  'dashboard.noSessions': 'No sessions yet. Start one above.',
  'dashboard.completed': 'Completed',
  'dashboard.inProgress': 'In progress',
  'dashboard.duplicate': 'Duplicate',
  'dashboard.delete': 'Delete',
  'dashboard.mixed': 'Mixed',

  // Stage labels
  'stage.taxonomy': 'Taxonomy',
  'stage.methods': 'Methods',
  'stage.rubric': 'Rubric',
  'stage.factory': 'Factory',

  // Taxonomy Stage
  'taxonomy.title': 'Stage 1: Taxonomy',
  'taxonomy.loading': 'Mapping the problem space...',
  'taxonomy.description': 'Browse the problem space and select a coordinate to explore.',
  'taxonomy.selected': 'Selected',
  'taxonomy.filterPlaceholder': 'Filter taxonomy...',
  'taxonomy.expanding': 'Expanding taxonomy branches...',
  'taxonomy.lockContinue': 'Lock & Continue',
  'taxonomy.advancing': 'Advancing...',

  // Methods Stage
  'methods.title': 'Stage 2: Methods',
  'methods.loading': 'Analyzing your coordinate for method recommendations...',
  'methods.description': 'Select 3-5 thinking methods. Recommendations are highlighted.',
  'methods.selectedCount': '{count} of 3-5 methods selected',
  'methods.recommended': 'Recommended',
  'methods.custom': 'Custom',
  'methods.goodFor': 'Good for',
  'methods.nextRubric': 'Next: Rubric',
  'methods.advancing': 'Advancing...',

  // Rubric Stage
  'rubric.title': 'Stage 3: Rubric',
  'rubric.loading': 'Designing evaluation criteria...',
  'rubric.description':
    'Review and edit the evaluation framework. This defines "good" before generating ideas.',
  'rubric.hardGates': 'Hard Gates (Pass/Fail)',
  'rubric.addGate': '+ Add Gate',
  'rubric.scoredCriteria': 'Scored Criteria (1-5)',
  'rubric.criterionPlaceholder': 'Criterion name',
  'rubric.descriptionPlaceholder': 'Description (1=bad, 5=good)',
  'rubric.weight': 'Weight',
  'rubric.addCriterion': '+ Add Criterion',
  'rubric.nextFactory': 'Next: Run Factory',
  'rubric.startingFactory': 'Starting Factory...',

  // Factory Stage
  'factory.title': 'Stage 4: Factory',
  'factory.elapsed': 'elapsed',
  'factory.phaseIdle': 'Waiting...',
  'factory.phaseDiverge': 'Diverge — Generating Ideas',
  'factory.phaseConverge': 'Converge — Filtering & Scoring',
  'factory.phaseEvolve': 'Evolve — Polishing Concepts',
  'factory.phaseInteractive': 'Review — QA & Package',
  'factory.phaseComplete': 'Session Complete',
  'factory.waitingWorkers': 'Waiting for workers to begin generating ideas...',
  'factory.ideas': 'ideas',
  'factory.eliminated': 'Eliminated',
  'factory.eliminatedDuring': 'Eliminated during convergence',
  'factory.evolved':
    'Concepts have been evolved — weaknesses addressed, strengths amplified.',
  'factory.criticalReviews': 'Critical Reviews',
  'factory.feasibility': 'Feasibility',
  'factory.ideaPool': 'Idea Pool',
  'factory.ideaPoolDesc':
    'Select ideas, then run Critical Review to analyze feasibility and generate reports.',
  'factory.runReview': 'Run Critical Review',
  'factory.reviewing': 'Reviewing...',
  'factory.reviewed': 'Reviewed',
  'factory.packaged': 'Packaged',
  'factory.downloadHtml': 'Download HTML',
  'factory.copyPrompt': 'Copy Prompt',
  'factory.eliminatedIdeas': 'Eliminated Ideas',
  'factory.completeSession': 'Complete Session',
  'factory.completing': 'Completing...',
  'factory.interrupted': 'Factory interrupted',
  'factory.foundWorkers': 'Found {workerCount} completed workers with {ideaCount} ideas.',
  'factory.resumePreserve': 'Resume (preserve progress)',
  'factory.resuming': 'Resuming...',
  'factory.retryFresh': 'Retry (start fresh)',
  'factory.retrying': 'Retrying...',
  'factory.collapse': 'Collapse',
  'factory.expand': 'Expand',

  // Settings Dialog
  'settings.title': 'Settings',
  'settings.authInfo':
    'Authentication is handled automatically via Claude Code or the ANTHROPIC_API_KEY environment variable.',
  'settings.sessionModels': 'Session Models',
  'settings.currentDefaults': 'Current Defaults',
  'settings.ideasPerWorker': 'Ideas/worker',
  'settings.webSearch': 'Web search',
  'settings.on': 'on',
  'settings.off': 'off',
  'settings.defaultModel': 'Default model',
  'settings.editConfig': 'Edit ~/.ideafactory/config.yaml to change defaults.',

  // Error Banner
  'error.resuming': 'Resuming...',
  'error.resumePreserve': 'Resume (preserve {count} ideas)',
  'error.retrying': 'Retrying...',
  'error.retry': 'Retry',
  'error.retryFresh': 'Retry (start fresh)',
  'error.dismiss': 'Dismiss',

  // Rollback Modal
  'rollback.goBackTo': 'Go back to {stage}?',
  'rollback.progressDiscarded': 'Progress after {stage} will be discarded:',
  'rollback.editSession': 'Edit this session',
  'rollback.editSessionDesc': 'Roll back and discard progress after {stage}.',
  'rollback.makeCopy': 'Make a copy first',
  'rollback.makeCopyDesc':
    'Duplicate this session, then edit the copy. Original preserved.',
  'rollback.cancel': 'Cancel',

  // Thought Feed
  'thoughtFeed.title': 'Agent Thoughts',
  'thoughtFeed.empty': 'Agent thoughts will appear here...',
  'thoughtFeed.connecting': 'Connecting...',
  'thoughtFeed.reconnecting': 'Reconnecting...',
  'thoughtFeed.disconnected': 'Disconnected',

  // App
  'app.viewing': 'Viewing',
  'app.stageReadOnly': 'stage (read-only)',
  'app.backToCurrent': 'Back to current',
  'app.editFromHere': 'Edit from here...',
} as const;

export type TranslationKey = keyof typeof en;
export default en;
