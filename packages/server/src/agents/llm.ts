import Anthropic from '@anthropic-ai/sdk';
import { sseManager } from '../sse/index.js';

const clientCache = new Map<string, Anthropic>();

function getClient(apiKey: string): Anthropic {
  if (!clientCache.has(apiKey)) {
    clientCache.set(apiKey, new Anthropic({ apiKey }));
  }
  return clientCache.get(apiKey)!;
}

export interface LLMCallOptions {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  sessionId?: string;
  agentName?: string;
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const {
    apiKey,
    model,
    system,
    prompt,
    temperature = 0.7,
    maxTokens = 8192,
    sessionId,
    agentName,
  } = options;

  const client = getClient(apiKey);

  if (sessionId && agentName) {
    sseManager.emit(sessionId, {
      type: 'agent:thought',
      data: { agent: agentName, text: `Starting work...` },
    });
  }

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return text;
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

      if (attempt < maxRetries) {
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
