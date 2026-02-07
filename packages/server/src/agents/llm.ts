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
  signal?: AbortSignal;
}

const AGENT_TIMEOUT_MS = 300_000;

/**
 * Extract an HTTP status code from an error message (including SDK stderr).
 * Returns the status code number, or null if none found.
 */
function extractHttpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const msg = error.message;

  // Match patterns like "404", "HTTP 404", "status 404", "error 404",
  // "404 Not Found", "returned 404", "status_code: 404"
  const patterns = [
    /\b(?:HTTP|status|error|returned|status_code:?)\s*(\d{3})\b/i,
    /\b(\d{3})\s+(?:Not Found|Bad Request|Forbidden|Unauthorized|Internal Server|Bad Gateway|Service Unavailable|Gateway Timeout|Too Many Requests|Overloaded)/i,
    /\berror\b.*?\b(4\d{2}|5\d{2})\b/i,
  ];

  for (const pattern of patterns) {
    const match = msg.match(pattern);
    if (match) {
      const code = parseInt(match[1], 10);
      if (code >= 400 && code <= 599) return code;
    }
  }

  return null;
}

/**
 * Classify an error into a category for retry logic.
 */
type ErrorClass = 'auth' | 'rate_limit' | 'api_client' | 'api_server' | 'overloaded' | 'process_crash' | 'timeout' | 'parse';

function classifyError(error: unknown): ErrorClass {
  if (!(error instanceof Error)) return 'parse';
  const msg = error.message.toLowerCase();

  // Timeout (AbortError is caught separately in callLLM, but check the message too)
  if (msg.includes('timed out') || error.name === 'AbortError') return 'timeout';

  // Check for HTTP status codes first (most specific)
  const status = extractHttpStatus(error);
  if (status !== null) {
    if (status === 401) return 'auth';
    if (status === 429) return 'rate_limit';
    if (status === 529 || status === 503) return 'overloaded';
    if (status >= 400 && status < 500) return 'api_client';
    if (status >= 500) return 'api_server';
  }

  // Keyword-based fallbacks for when status code isn't in the message
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('authentication')) return 'auth';
  if (msg.includes('429') || msg.includes('rate limit')) return 'rate_limit';
  if (msg.includes('overloaded') || msg.includes('529')) return 'overloaded';
  if (msg.includes('not_found') || msg.includes('not found') || msg.includes('404')) return 'api_client';
  if (msg.includes('invalid_request') || msg.includes('bad request') || msg.includes('400')) return 'api_client';
  if (msg.includes('forbidden') || msg.includes('403')) return 'api_client';
  if (msg.includes('500') || msg.includes('internal server') || msg.includes('502') || msg.includes('bad gateway')) return 'api_server';

  // Process crashes (SDK subprocess died)
  if (
    msg.includes('exited with code') ||
    msg.includes('process exited') ||
    msg.includes('spawn') ||
    msg.includes('enoent') ||
    msg.includes('killed')
  ) return 'process_crash';

  return 'parse';
}

/**
 * Format a user-friendly error message for API/HTTP errors.
 */
function formatAPIError(error: Error, errorClass: ErrorClass, model: string): string {
  const status = extractHttpStatus(error);
  const statusStr = status ? ` (HTTP ${status})` : '';

  switch (errorClass) {
    case 'auth':
      return `Authentication failed${statusStr}. Ensure ANTHROPIC_API_KEY is set or run within Claude Code.`;
    case 'rate_limit':
      return `Rate limited${statusStr}. Will retry with backoff.`;
    case 'overloaded':
      return `API is overloaded${statusStr}. Will retry with backoff.`;
    case 'api_client': {
      // Extract the most meaningful part of the error
      const firstLine = error.message.split('\n')[0];
      if (status === 404)
        return `Model "${model}" not found${statusStr}. Check that the model ID is valid.`;
      if (status === 400)
        return `Bad request to API${statusStr}: ${firstLine}`;
      return `API error${statusStr}: ${firstLine}`;
    }
    case 'api_server':
      return `API server error${statusStr}. Will retry.`;
    default:
      return error.message;
  }
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
      data: { agent: agentName, text: `Starting work...`, model },
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(
      new Error(
        `${agentName ?? 'Agent'} timed out after ${Math.round(timeoutMs / 1000)}s. ` +
          `Try retrying or using a faster model (e.g. Haiku).`,
      ),
    );
  }, timeoutMs);

  // Link external abort signal to internal controller
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      const onAbort = () => controller.abort(options.signal!.reason);
      options.signal.addEventListener('abort', onAbort, { once: true });
      controller.signal.addEventListener(
        'abort',
        () => options.signal!.removeEventListener('abort', onAbort),
        { once: true },
      );
    }
  }

  // Capture subprocess stderr to surface meaningful error details
  const stderrChunks: string[] = [];

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
        stderr: (data: string) => {
          stderrChunks.push(data);
        },
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
            data: { agent: agentName, text: 'Generating response...', model },
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
              data: { agent: agentName, text: `Generating... (${display} tokens)`, model },
            });
            lastProgressEmit = now;
          }
        } else if (event.type === 'message_delta' && event.usage?.output_tokens) {
          sseManager.emit(sessionId, {
            type: 'agent:thought',
            data: {
              agent: agentName,
              text: `Response complete (${event.usage.output_tokens.toLocaleString()} output tokens)`,
              model,
            },
          });
        }
      }
    }

    if (structuredOutput !== undefined) {
      return JSON.stringify(structuredOutput);
    }

    return resultText;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      // If the external signal triggered the abort, preserve AbortError so
      // pipeline.ts can silently ignore cancelled runs (e.g. retry replacing old run)
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Otherwise it was an internal timeout
      const reason = controller.signal.reason;
      const timeoutMsg =
        reason instanceof Error
          ? reason.message
          : `${agentName ?? 'Agent'} timed out after ${Math.round(timeoutMs / 1000)}s.`;
      throw new Error(timeoutMsg);
    }

    // Enrich process crash errors with captured stderr
    const stderr = stderrChunks.join('').trim();
    if (stderr && error instanceof Error) {
      // Extract the most useful lines from stderr (skip noise)
      const usefulLines = stderr
        .split('\n')
        .filter((l) => l.trim() && !l.includes('[DEBUG]'))
        .slice(-10)
        .join('\n');
      if (usefulLines) {
        console.error(`[${agentName ?? 'Agent'}] SDK stderr:\n${usefulLines}`);
        error.message += `\nSDK stderr: ${usefulLines.slice(0, 500)}`;
      }
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Attempt to repair common JSON issues (trailing commas, single quotes, etc.)
 */
function repairJSON(text: string): string {
  let s = text;
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([\]}])/g, '$1');
  // Replace single-quoted strings with double-quoted (simple heuristic)
  // Only if the string doesn't already contain double quotes
  if (!s.includes('"') && s.includes("'")) {
    s = s.replace(/'/g, '"');
  }
  return s;
}

/**
 * Try to parse a string as JSON, with repair fallback.
 */
function tryParseJSON(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(repairJSON(text));
    } catch {
      return null;
    }
  }
}

export function extractJSON(text: string): string {
  // 1. Try the whole string as-is
  if (tryParseJSON(text) !== null) {
    // Still might need repair for downstream parsing
    try {
      JSON.parse(text);
      return text.trim();
    } catch {
      return repairJSON(text).trim();
    }
  }

  // 2. Try to find JSON in code blocks
  const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const candidate = match[1].trim();
    if (tryParseJSON(candidate) !== null) {
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return repairJSON(candidate);
      }
    }
  }

  // 3. Try to find JSON objects/arrays using bracket matching
  //    Find the outermost { ... } or [ ... ] by scanning for balanced brackets
  for (const opener of ['{', '['] as const) {
    const closer = opener === '{' ? '}' : ']';
    const startIdx = text.indexOf(opener);
    if (startIdx === -1) continue;

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === opener) depth++;
      if (ch === closer) depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        if (tryParseJSON(candidate) !== null) {
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            return repairJSON(candidate);
          }
        }
        break;
      }
    }
  }

  // 4. Last resort: simple regex (greedy)
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    const candidate = jsonMatch[1].trim();
    // Try repair even if it doesn't parse cleanly
    const repaired = repairJSON(candidate);
    if (tryParseJSON(repaired) !== null) {
      return repaired;
    }
    return candidate;
  }

  return text.trim();
}

export async function callLLMWithRetry<T>(
  options: LLMCallOptions,
  parse: (text: string) => T,
  maxRetries = 2,
): Promise<T> {
  let lastError: Error | null = null;
  let rateLimitRetries = 0;
  const MAX_RATE_LIMIT_RETRIES = 10;
  // Clone options so we can mutate prompt/outputSchema for retries without affecting the caller
  const retryOptions = { ...options, prompt: options.prompt };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const text = await callLLM(retryOptions);
      const jsonStr = extractJSON(text);
      return parse(jsonStr);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorClass = classifyError(lastError);

      // Log every failed attempt with full context
      console.error(
        `[${options.agentName ?? 'Agent'}] Attempt ${attempt + 1}/${maxRetries + 1} failed` +
          ` [${errorClass}] (model: ${retryOptions.model}, outputSchema: ${retryOptions.outputSchema ? 'yes' : 'no'}):`,
        lastError.message,
      );

      // ── Non-retryable errors: throw immediately ──

      if (errorClass === 'auth') {
        const msg = formatAPIError(lastError, errorClass, retryOptions.model);
        if (options.sessionId) {
          sseManager.emit(options.sessionId, {
            type: 'status:error',
            data: { stage: 'auth', error: msg },
          });
        }
        throw new Error(msg);
      }

      if (errorClass === 'api_client') {
        // 4xx errors (404, 400, 403) are not fixable by retrying — wrong model, bad request, etc.
        const msg = formatAPIError(lastError, errorClass, retryOptions.model);
        if (options.sessionId) {
          sseManager.emit(options.sessionId, {
            type: 'status:error',
            data: { stage: options.agentName ?? 'unknown', error: msg },
          });
        }
        throw new Error(msg);
      }

      if (errorClass === 'timeout') {
        if (attempt >= maxRetries) break;
        const currentTimeout = retryOptions.timeoutMs ?? AGENT_TIMEOUT_MS;
        retryOptions.timeoutMs = Math.round(currentTimeout * 1.5);
        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `Timed out after ${Math.round(currentTimeout / 1000)}s. Retrying with ${Math.round(retryOptions.timeoutMs / 1000)}s timeout...`,
              model: options.model,
            },
          });
        }
        continue;
      }

      // ── Retryable errors ──

      if (attempt >= maxRetries) break; // exhausted retries

      if (errorClass === 'rate_limit' || errorClass === 'overloaded') {
        rateLimitRetries++;
        if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) break;
        const waitMs = backoffWithJitter(attempt);
        const label = errorClass === 'rate_limit' ? 'Rate limited' : 'API overloaded';
        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `${label}, waiting ${Math.round(waitMs / 1000)}s before retry...`,
              model: options.model,
            },
          });
        }
        await sleep(waitMs);
        // Don't count rate limit / overloaded retries against the parse-retry budget
        if (attempt > 0) attempt--;
        continue;
      }

      if (errorClass === 'api_server') {
        // 5xx errors — retry with backoff, but don't modify the prompt
        const waitMs = backoffWithJitter(attempt);
        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `API server error, retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt + 2}/${maxRetries + 1})...`,
              model: options.model,
            },
          });
        }
        await sleep(waitMs);
        continue;
      }

      // Backoff before retrying process crashes / parse errors
      await sleep(backoffWithJitter(attempt, 500));

      if (errorClass === 'process_crash' && retryOptions.outputSchema) {
        // SDK subprocess crashed — drop outputSchema and retry in text mode
        delete retryOptions.outputSchema;
        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `Structured output failed, retrying with text mode (attempt ${attempt + 2}/${maxRetries + 1})...`,
              model: options.model,
            },
          });
        }
      } else {
        // Parse error — append JSON fix instruction
        if (options.sessionId && options.agentName) {
          sseManager.emit(options.sessionId, {
            type: 'agent:thought',
            data: {
              agent: options.agentName,
              text: `Output parsing failed, retrying (attempt ${attempt + 2}/${maxRetries + 1})...`,
              model: options.model,
            },
          });
        }
        // Strip any SDK stderr from the error message to keep the prompt clean
        const cleanError = lastError.message.split('\nSDK stderr:')[0];
        retryOptions.prompt += `\n\nIMPORTANT: Your previous response had an error: ${cleanError}. Please return ONLY valid JSON matching the required schema. No markdown, no code blocks, no explanatory text — just the JSON object/array.`;
      }
    }
  }

  // Format the final error message based on error class
  const finalClass = lastError ? classifyError(lastError) : 'parse';
  const finalMsg = lastError
    ? finalClass !== 'parse'
      ? formatAPIError(lastError, finalClass, retryOptions.model)
      : lastError.message
    : 'Unknown error';

  throw new Error(`Failed after ${maxRetries + 1} attempts: ${finalMsg}`);
}
