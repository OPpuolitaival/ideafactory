import type { Locale } from '@ideafactory/shared';

const LOCALE_INSTRUCTIONS: Record<string, string> = {
  fi: `

LANGUAGE REQUIREMENT: You MUST respond entirely in Finnish (suomi). All text content — including names, titles, descriptions, reasoning, summaries, labels, and any other textual output — must be written in Finnish. JSON field names/keys must remain in English, but all string VALUES must be in Finnish. This is a strict requirement.`,
};

/**
 * Returns a language instruction to append to the LLM system prompt.
 * Returns empty string for English (default) or unrecognized locales.
 */
export function getLocaleInstruction(locale?: Locale | string): string {
  if (!locale || locale === 'en') return '';
  return LOCALE_INSTRUCTIONS[locale] ?? '';
}
