import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { z } from 'zod';
import { DEFAULT_CONFIG, BUILT_IN_METHODS, MODEL_OPTIONS } from '@ideafactory/shared';
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

function readEnvConfig(): Partial<AppConfig> {
  const env: Partial<AppConfig> = {};

  // Defaults
  const ideasPerWorker = process.env.IDEAS_PER_WORKER;
  const webSearch = process.env.WEB_SEARCH;
  if (ideasPerWorker || webSearch) {
    env.defaults = {} as AppConfig['defaults'];
    if (ideasPerWorker) {
      const n = parseInt(ideasPerWorker, 10);
      if (!isNaN(n) && n >= 5 && n <= 30) env.defaults.ideasPerWorker = n;
    }
    if (webSearch) {
      env.defaults.webSearch = webSearch === 'true';
    }
  }

  // Models
  const modelDefault = process.env.MODEL_DEFAULT || undefined;
  const modelNavigator = process.env.MODEL_NAVIGATOR || undefined;
  const modelStrategist = process.env.MODEL_STRATEGIST || undefined;
  const modelWorker = process.env.MODEL_WORKER || undefined;
  const modelAnalyst = process.env.MODEL_ANALYST || undefined;
  if (modelDefault || modelNavigator || modelStrategist || modelWorker || modelAnalyst) {
    env.models = {} as AppConfig['models'];
    if (modelDefault) env.models.default = modelDefault;
    if (modelNavigator) env.models.navigator = modelNavigator;
    if (modelStrategist) env.models.strategist = modelStrategist;
    if (modelWorker) env.models.worker = modelWorker;
    if (modelAnalyst) env.models.analyst = modelAnalyst;
  }

  // Server
  const port = process.env.PORT;
  if (port) {
    const n = parseInt(port, 10);
    if (!isNaN(n)) env.server = { port: n };
  }

  return env;
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

  const envConfig = readEnvConfig();

  cachedConfig = {
    defaults: {
      ideasPerWorker:
        envConfig.defaults?.ideasPerWorker ??
        userConfig.defaults?.ideasPerWorker ??
        DEFAULT_CONFIG.ideasPerWorker,
      webSearch:
        envConfig.defaults?.webSearch ??
        userConfig.defaults?.webSearch ??
        DEFAULT_CONFIG.webSearch,
    },
    models: {
      default:
        envConfig.models?.default ??
        userConfig.models?.default ??
        DEFAULT_CONFIG.models.default,
      navigator:
        envConfig.models?.navigator ??
        userConfig.models?.navigator ??
        DEFAULT_CONFIG.models.navigator,
      strategist:
        envConfig.models?.strategist ??
        userConfig.models?.strategist ??
        DEFAULT_CONFIG.models.strategist,
      worker:
        envConfig.models?.worker ??
        userConfig.models?.worker ??
        DEFAULT_CONFIG.models.worker,
      analyst:
        envConfig.models?.analyst ??
        userConfig.models?.analyst ??
        DEFAULT_CONFIG.models.analyst,
    },
    server: {
      port: envConfig.server?.port ?? userConfig.server?.port ?? DEFAULT_CONFIG.server.port,
    },
  };

  return cachedConfig;
}

export interface ModelOption {
  id: string;
  label: string;
  color: string;
}

export function getModelOptions(): ModelOption[] {
  return [
    {
      id: process.env.HAIKU_MODEL || MODEL_OPTIONS[0].id,
      label: 'Haiku',
      color: MODEL_OPTIONS[0].color,
    },
    {
      id: process.env.SONNET_MODEL || MODEL_OPTIONS[1].id,
      label: 'Sonnet',
      color: MODEL_OPTIONS[1].color,
    },
    {
      id: process.env.OPUS_MODEL || MODEL_OPTIONS[2].id,
      label: 'Opus',
      color: MODEL_OPTIONS[2].color,
    },
  ];
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
