import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';
import { DEFAULT_CONFIG, BUILT_IN_METHODS } from '@ideafactory/shared';
import type { Method } from '@ideafactory/shared';
import { getConfigPath, getMethodsDir } from './paths.js';

const UserConfigSchema = z.object({
  defaults: z
    .object({
      ideasPerWorker: z.number().min(5).max(30).optional(),
      webSearch: z.boolean().optional(),
    })
    .optional(),
  models: z
    .object({
      default: z.string().optional(),
      navigator: z.string().optional(),
      strategist: z.string().optional(),
      worker: z.string().optional(),
      analyst: z.string().optional(),
    })
    .optional(),
  server: z
    .object({
      port: z.number().optional(),
    })
    .optional(),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export interface AppConfig {
  defaults: {
    ideasPerWorker: number;
    webSearch: boolean;
  };
  models: {
    default: string;
    navigator: string;
    strategist: string;
    worker: string;
    analyst: string;
  };
  server: {
    port: number;
  };
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  let userConfig: UserConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = YAML.parse(raw);
      userConfig = UserConfigSchema.parse(parsed);
    } catch (e) {
      console.warn(`Warning: Failed to parse config at ${configPath}:`, e);
    }
  }

  cachedConfig = {
    defaults: {
      ideasPerWorker: userConfig.defaults?.ideasPerWorker ?? DEFAULT_CONFIG.ideasPerWorker,
      webSearch: userConfig.defaults?.webSearch ?? DEFAULT_CONFIG.webSearch,
    },
    models: {
      default: userConfig.models?.default ?? DEFAULT_CONFIG.models.default,
      navigator: userConfig.models?.navigator ?? DEFAULT_CONFIG.models.navigator,
      strategist: userConfig.models?.strategist ?? DEFAULT_CONFIG.models.strategist,
      worker: userConfig.models?.worker ?? DEFAULT_CONFIG.models.worker,
      analyst: userConfig.models?.analyst ?? DEFAULT_CONFIG.models.analyst,
    },
    server: {
      port: userConfig.server?.port ?? DEFAULT_CONFIG.server.port,
    },
  };

  return cachedConfig;
}

export function loadUserMethods(): Method[] {
  const dir = getMethodsDir();
  if (!fs.existsSync(dir)) return [];

  const methods: Method[] = [];
  let nextId = 100;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json'));

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const parsed = file.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);

      if (parsed.name && parsed.description) {
        methods.push({
          id: nextId++,
          name: parsed.name,
          description: parsed.description,
          goodFor: parsed.goodFor ?? '',
          builtIn: false,
        });
      }
    } catch (e) {
      console.warn(`Warning: Skipping malformed method file ${file}:`, e);
    }
  }

  return methods;
}

export function getAllMethods(): Method[] {
  return [...BUILT_IN_METHODS, ...loadUserMethods()];
}

export function resetConfigCache(): void {
  cachedConfig = null;
}
