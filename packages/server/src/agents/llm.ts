import { query } from '@anthropic-ai/claude-agent-sdk';
import { sseManager } from '../sse/index.js';

export interface LLMCallOptions {
  model: string;
  system: string;
  prompt: string;
  outputSchema?: Record<string, unknown>;
  sessionId?: string;
  agentName?: string;
  timeoutMs?: number;
}

const AGENT_TIMEOUT_MS = 300_000;

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('429')) return true;
  if (error instanceof Error && error.message.toLowerCase().includes('rate limit')) return true;
  return false;
}

function isAuthError(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('401')) return true;
  if (error instanceof Error && error.message.toLowerCase().includes('authentication')) return true;
  if (error instanceof Error && error.message.toLowerCase().includes('unauthorized')) return true;
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffWithJitter(attempt: number, baseMs = 1000): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * exponential * 0.5;
  return exponential + jitter;
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const {
    model,
    system,
    prompt,
    outputSchema,
    sessionId,
    agentName,
    timeoutMs = AGENT_TIMEOUT_MS,
  } = options;

  if (sessionId && agentName) {
    sseManager.emit(sessionId, {
      type: 'agent:thought',
      data: { agent: agentName, text: `Starting work...` },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const stream = query({
      prompt,
      options: {
        model,
        systemPrompt: system,
        // When outputFormat uses json_schema, the SDK adds a StructuredOutput tool
        // that needs an extra turn (tool_use → tool_result → final response)
        maxTurns: outputSchema ? 2 : 1,
        tools: [],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        abortController: controller,
        includePartialMessages: true,
        ...(outputSchema
          ? { outputFormat: { type: 'json_schema' as const, schema: outputSchema } }
          : {}),
      },
    });

    let resultText = '';
    let structuredOutput: unknown = undefined;
    let emittedGenerating = false;
    let approxTokens = 0;
    let lastProgressEmit = 0;
    const PROGRESS_INTERVAL_MS = 10_000;

    for await (const message of stream) {
      if (message.type === 'result') {
        if ('structured_output' in message && message.structured_output !== undefined) {
          structuredOutput = message.structured_output;
        }
        if ('result' in message) {
          resultText = message.result as string;
        }
      } else if (message.type === 'stream_event' && sessionId && agentName) {
        const event = (message as any).event;
        if (!event) continue;

        if (event.type === 'content_block_start' && !emittedGenerating) {
          emittedGenerating = true;
          sseManager.emit(sessionId, {
            type: 'agent:thought',
            data: { agent: agentName, text: 'Generating response...' },
          });
          lastProgressEmit = Date.now();
        } else if (event.type === 'content_block_delta') {
          // Approximate token count from text deltas (~4 chars per token)
          const delta = event.delta;
          if (delta?.type === 'text_delta' && delta.text) {
            approxTokens += Math.ceil(delta.text.length / 4);
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            approxTokens += Math.ceil(delta.partial_json.length / 4);
          }

          const now = Date.now();
          if (now - lastProgressEmit >= PROGRESS_INTERVAL_MS && approxTokens > 0) {
            const display =
              approxTokens >= 1000
                ? `~${(approxTokens / 1000).toFixed(1)}k`
                : `~${approxTokens}`;
            sseManager.emit(sessionId, {
              type: 'agent:thought',
              data: { agent: agentName, text: `Generating... (${display} tokens)` },
            });
            lastProgressEmit = now;
          }
        } else if (event.type === 'message_delta' && event.usage?.output_tokens) {
          sseManager.emit(sessionId, {
            type: 'agent:thought',
            data: {
              agent: agentName,
              text: `Response complete (${event.usage.output_tokens.toLocaleString()} output tokens)`,
            },
          });
        }
      }
    }

    if (structuredOutput !== undefined) {
      return JSON.stringify(structuredOutput);
    }

    return resultText;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJSON(text: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find raw JSON (object or array)
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}

export async function callLLMWithRetry<T>(
  options: LLMCallOptions,
  parse: (text: string) => T,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const text = await callLLM(options);
      const jsonStr = extractJSON(text);
      return parse(jsonStr);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Authentication errors should not be retried
      if (isAuthError(error)) {
        if (options.sessionId) {
          sseManager.emit(options.sessionId, {
            type: 'status:error',
            data: {
              stage: 'auth',
              error:
                'Authentication failed. Ensure ANTHROPIC_API_KEY is set or run within Claude Code.',
            },
          });
        }
        throw new Error(
          'Authentication failed. Ensure ANTHROPIC_API_KEY is set or run within Claude Code.',
        );
      }

      // Rate limit errors get exponential backoff with jitter
      if (isRateLimitError(error)) {
        const waitMs = backoffWithJitter(attempt);
        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `Rate limited, waiting ${Math.round(waitMs / 1000)}s before retry...`,
            },
          });
        }
        await sleep(waitMs);
        // Don't count rate limit retries against the parse-retry budget
        if (attempt > 0) attempt--;
        continue;
      }

      if (attempt < maxRetries) {
        // Backoff before retrying network/parse errors
        await sleep(backoffWithJitter(attempt, 500));

        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `Output parsing failed, retrying (attempt ${attempt + 2}/${maxRetries + 1})...`,
            },
          });
        }

        // Add explicit "fix your JSON" instruction on retry
        options.prompt += `\n\nIMPORTANT: Your previous response had a JSON formatting error: ${lastError.message}. Please return ONLY valid JSON matching the required schema. No additional text before or after the JSON.`;
      }
    }
  }

  throw new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message}`);
}
