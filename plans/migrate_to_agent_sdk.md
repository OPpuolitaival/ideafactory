# Plan: Migrate from @anthropic-ai/sdk to @anthropic-ai/claude-agent-sdk

## Overview

Replace the direct Anthropic SDK (`@anthropic-ai/sdk`) with the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`). The Agent SDK handles authentication automatically (inherits Claude Code auth or reads `ANTHROPIC_API_KEY` env var), eliminating the need for frontend API key configuration.

**Key trade-off (accepted):** The Agent SDK does not expose `temperature` or `maxTokens` parameters. System prompt instructions will compensate for this.

---

## Phase 1: Dependencies & Foundation

### 1.1 Update `packages/server/package.json`
- Remove `@anthropic-ai/sdk`
- Add `@anthropic-ai/claude-agent-sdk`
- Add `zod-to-json-schema` (convert Zod schemas to JSON Schema for structured output)

### 1.2 Create `packages/server/src/agents/schemas.ts` (new file)
Pre-compute JSON schemas from Zod schemas at module level:
- `taxonomyJsonSchema` - from `TaxonomyNodeSchema` (uses `z.lazy()` for recursion; may need manual JSON schema if conversion fails)
- `methodRecommendationJsonSchema` - from `z.array(MethodRecommendationSchema)`
- `rubricJsonSchema` - from `RubricSchema`
- `rawIdeaArrayJsonSchema` - from `z.array(RawIdeaSchema.omit(...))`
- `scoredIdeaArrayJsonSchema` - from `z.array(ScoredIdeaSchema)`
- `qaResultArrayJsonSchema` - from `z.array(QAResultSchema)`
- `outputPackageJsonSchema` - from `OutputPackageSchema`
- `visualArtifactArrayJsonSchema` - from `z.array(VisualArtifactSchema)`

### 1.3 Rewrite `packages/server/src/agents/llm.ts`
- Remove `@anthropic-ai/sdk` import, `clientCache`, `getClient()`
- Import `query` from `@anthropic-ai/claude-agent-sdk`
- Remove `apiKey`, `temperature`, `maxTokens` from `LLMCallOptions`
- Add `outputSchema?: Record<string, unknown>` to `LLMCallOptions`
- Increase default timeout from 60s to 120s (Agent SDK subprocess overhead)
- `callLLM()`: use `query()` with `allowedTools: []`, `maxTurns: 1`, `permissionMode: 'bypassPermissions'`, `allowDangerouslySkipPermissions: true`, `systemPrompt`, and optional `outputFormat`
- Iterate async generator to extract `result.structured_output` or `result.result`
- `callLLMWithRetry()`: keep retry logic but simplify (structured output reduces parse failures)
- Keep `extractJSON()` as fallback
- Update `isAuthError()`/`isRateLimitError()` for Agent SDK error shapes (string matching on messages)
- Update auth error message: "Authentication failed. Ensure ANTHROPIC_API_KEY is set or run within Claude Code."

---

## Phase 2: Agent Files

### 2.1 `packages/server/src/agents/navigator.ts`
- Remove `apiKey` from `RunTaxonomyOptions`
- Remove `temperature: 0.7`, `maxTokens: 16384` from callLLMWithRetry call
- Add `outputSchema: taxonomyJsonSchema`
- Add system prompt instructions for thoroughness/creativity

### 2.2 `packages/server/src/agents/strategist.ts`
- Remove `apiKey` from `RunMethodSelectionOptions` and `RunRubricDesignOptions`
- Remove `temperature: 0.6`, `maxTokens: 4096` from both calls
- Add `outputSchema` to both calls
- Add system prompt instructions for precision/analytical behavior

### 2.3 `packages/server/src/agents/factory.ts`
- Remove `apiKey` from all 5 interfaces (`RunFactoryOptions`, `DivergenceOptions`, `ConvergenceOptions`, `EvolutionOptions`, `QAOptions`)
- Remove all `temperature` and `maxTokens` parameters
- Add `outputSchema` to all 4 LLM calls (diverge, converge, evolve, QA)
- Add creativity instructions to divergence system prompts (compensates for lost temp=0.9)
- Parallel `Promise.all()` for divergence workers works unchanged

### 2.4 `packages/server/src/agents/analyst.ts`
- Remove `apiKey` from `RunOutputOptions`
- Remove `temperature: 0.4`, `maxTokens` from both calls
- Add `outputSchema` to both calls (output package + visual artifacts)

---

## Phase 3: Infrastructure

### 3.1 `packages/server/src/agents/pipeline.ts`
- Remove the `if (!config.apiKey)` guard
- Remove `apiKey: config.apiKey` from all 5 agent call sites
- Keep `config.models.*` references (model selection unchanged)

### 3.2 `packages/server/src/config/index.ts`
- Remove `apiKey` from `UserConfigSchema` and `AppConfig` interface
- Remove `apiKey` resolution logic (env var + config file)
- Remove `saveApiKey()` function entirely
- Keep all other config (models, defaults, server, methods, personas)

### 3.3 `packages/server/src/trpc/router.ts`
- Remove `config.setApiKey` mutation
- Remove `hasApiKey` from `config.getConfig` query response
- Remove `saveApiKey` import

### 3.4 `packages/server/src/cli/commands.ts`
- Remove API key validation from `cmdRun()` and `cmdStage()`
- Remove `apiKey` case from `cmdConfig set`
- Update help text

### 3.5 `packages/client/src/components/SettingsDialog.tsx`
- Remove API key input, save button, status indicator
- Remove `setApiKeyMutation` and `apiKey` state
- Replace with auth info note: "Authentication is handled automatically via Claude Code or ANTHROPIC_API_KEY env var"
- Keep "Current Defaults" section

---

## Phase 4: Tests

### 4.1 New mock infrastructure (all test files)
Replace:
```typescript
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({ default: MockAnthropic }));
```
With:
```typescript
const mockQuery = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

function queryResult(text: string, structured?: unknown) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield { type: 'result', result: text, structured_output: structured };
    },
  };
}
```

### 4.2 File-by-file test updates
| Test File | Changes |
|-----------|---------|
| `agents.test.ts` | Replace SDK mock, remove `apiKey` from calls, **remove** temperature/maxTokens tests, update timeout tests for `abortController` option, add structured output tests |
| `factory.test.ts` | Replace SDK mock, remove `apiKey` from all calls/interfaces, remove temperature/maxTokens assertions |
| `analyst.test.ts` | Replace SDK mock, remove `apiKey`, update assertions |
| `integration.test.ts` | Replace SDK mock, remove `apiKey` from config/calls, remove model-param assertions for temp/maxTokens |
| `e2e.test.ts` | Remove `apiKey` from agent calls, SDK reads env var directly |
| `pipeline.test.ts` | Remove `apiKey` from mock config |
| `router.test.ts` | Remove `apiKey` from mock config, **delete** `setApiKey` tests, remove `hasApiKey` assertions |
| `commands.test.ts` | Remove `apiKey` from mock config, **delete** "sets API key" test |
| `config.test.ts` | Remove `saveApiKey` tests, remove `apiKey` from config assertions |

---

## Phase 5: Verification

1. `pnpm install` - verify Agent SDK installs correctly
2. `pnpm typecheck` - across all packages
3. `pnpm test` - all tests pass (target: 400+ pass, 7 E2E skipped)
4. `ANTHROPIC_API_KEY=sk-... npx tsx packages/server/src/cli/index.ts stage --domain "renewable energy"` - CLI test with real API
5. Start server + client, verify Settings dialog no longer shows API key input
6. Run a session through the web UI to verify full pipeline works

---

## Files Modified (19 files)

| File | Action |
|------|--------|
| `packages/server/package.json` | Swap SDK deps, add zod-to-json-schema |
| `packages/server/src/agents/schemas.ts` | **New** - JSON schema pre-computation |
| `packages/server/src/agents/llm.ts` | **Rewrite** - query() based implementation |
| `packages/server/src/agents/navigator.ts` | Remove apiKey/temp/maxTokens, add outputSchema |
| `packages/server/src/agents/strategist.ts` | Remove apiKey/temp/maxTokens, add outputSchema |
| `packages/server/src/agents/factory.ts` | Remove apiKey/temp/maxTokens, add outputSchema |
| `packages/server/src/agents/analyst.ts` | Remove apiKey/temp/maxTokens, add outputSchema |
| `packages/server/src/agents/pipeline.ts` | Remove apiKey guard and passing |
| `packages/server/src/config/index.ts` | Remove apiKey, saveApiKey |
| `packages/server/src/trpc/router.ts` | Remove setApiKey, hasApiKey |
| `packages/server/src/cli/commands.ts` | Remove apiKey checks |
| `packages/client/src/components/SettingsDialog.tsx` | Remove API key UI |
| `packages/server/src/agents/agents.test.ts` | Rewrite mocks, remove temp/maxTokens tests |
| `packages/server/src/agents/factory.test.ts` | Rewrite mocks |
| `packages/server/src/agents/analyst.test.ts` | Rewrite mocks |
| `packages/server/src/agents/integration.test.ts` | Rewrite mocks |
| `packages/server/src/agents/e2e.test.ts` | Remove apiKey from calls |
| `packages/server/src/agents/pipeline.test.ts` | Remove apiKey from mock config |
| `packages/server/src/trpc/router.test.ts` | Remove setApiKey tests |
| `packages/server/src/cli/commands.test.ts` | Remove apiKey test |
| `packages/server/src/config/config.test.ts` | Remove saveApiKey tests |
