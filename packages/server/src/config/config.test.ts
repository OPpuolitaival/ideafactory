import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';

// ---------------------------------------------------------------------------
// 1. paths.ts tests (no mocking needed -- pure functions using real os.homedir)
// ---------------------------------------------------------------------------

describe('paths', () => {
  let paths: typeof import('./paths.js');

  beforeEach(async () => {
    vi.resetModules();
    paths = await import('./paths.js');
  });

  it('getDataDir returns ~/.ideafactory', () => {
    expect(paths.getDataDir()).toBe(path.join(os.homedir(), '.ideafactory'));
  });

  it('getConfigPath returns ~/.ideafactory/config.yaml', () => {
    expect(paths.getConfigPath()).toBe(path.join(os.homedir(), '.ideafactory', 'config.yaml'));
  });

  it('getMethodsDir returns ~/.ideafactory/methods', () => {
    expect(paths.getMethodsDir()).toBe(path.join(os.homedir(), '.ideafactory', 'methods'));
  });

  it('getPersonasDir returns ~/.ideafactory/personas', () => {
    expect(paths.getPersonasDir()).toBe(path.join(os.homedir(), '.ideafactory', 'personas'));
  });
});

// ---------------------------------------------------------------------------
// Helpers to create a temporary file-system sandbox.
// We redirect every path helper to point inside a temp directory so the tests
// never touch the real home directory.
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ideafactory-test-'));
}

// ---------------------------------------------------------------------------
// 2-9. Config loading / saving / methods
// ---------------------------------------------------------------------------

describe('config module', () => {
  let tmpDir: string;
  let configPath: string;
  let methodsDir: string;
  let personasDir: string;

  // We will dynamically import the config module after patching the path helpers.
  let configModule: typeof import('./index.js');

  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();

    // Create isolated tmp directories
    tmpDir = makeTmpDir();
    configPath = path.join(tmpDir, 'config.yaml');
    methodsDir = path.join(tmpDir, 'methods');
    personasDir = path.join(tmpDir, 'personas');

    // Mock path helpers so every function in index.ts uses our tmp dir
    vi.doMock('./paths.js', () => ({
      getDataDir: () => tmpDir,
      getConfigPath: () => configPath,
      getMethodsDir: () => methodsDir,
      getPersonasDir: () => personasDir,
    }));

    configModule = await import('./index.js');
  });

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };

    // Clean up tmp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // loadConfig -- default config when no file
  // -----------------------------------------------------------------------

  describe('loadConfig', () => {
    it('returns default config when no config file exists', () => {
      const cfg = configModule.loadConfig();

      expect(cfg.defaults.ideasPerWorker).toBe(15);
      expect(cfg.defaults.webSearch).toBe(false);
      expect(cfg.server.port).toBe(3000);
      // Model defaults
      expect(cfg.models.default).toBe('claude-opus-4-6');
      expect(cfg.models.navigator).toBe('claude-opus-4-6');
    });

    it('reads valid config.yaml correctly', () => {
      const yamlContent = YAML.stringify({
        defaults: {
          ideasPerWorker: 25,
          webSearch: true,
        },
        server: { port: 8080 },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      const cfg = configModule.loadConfig();

      expect(cfg.defaults.ideasPerWorker).toBe(25);
      expect(cfg.defaults.webSearch).toBe(true);
      expect(cfg.server.port).toBe(8080);
    });

    it('handles malformed YAML gracefully', () => {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, ': : invalid yaml [\n{{{');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const cfg = configModule.loadConfig();

      // Should fall back to defaults
      expect(cfg.defaults.ideasPerWorker).toBe(15);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('handles YAML that violates schema (e.g. ideasPerWorker out of range)', () => {
      const yamlContent = YAML.stringify({
        defaults: { ideasPerWorker: 999 },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const cfg = configModule.loadConfig();

      expect(cfg.defaults.ideasPerWorker).toBe(15); // fallback
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('caches the config on subsequent calls', () => {
      const cfg1 = configModule.loadConfig();
      const cfg2 = configModule.loadConfig();

      expect(cfg1).toBe(cfg2); // same reference
    });

    it('resetConfigCache invalidates the cache', () => {
      const cfg1 = configModule.loadConfig();
      configModule.resetConfigCache();
      const cfg2 = configModule.loadConfig();

      expect(cfg1).not.toBe(cfg2); // different object
      expect(cfg1).toEqual(cfg2); // same values though
    });
  });

  // -----------------------------------------------------------------------
  // Default config values
  // -----------------------------------------------------------------------

  describe('default config values', () => {
    it('ideasPerWorker defaults to 15', () => {
      expect(configModule.loadConfig().defaults.ideasPerWorker).toBe(15);
    });

    it('webSearch defaults to false', () => {
      expect(configModule.loadConfig().defaults.webSearch).toBe(false);
    });

    it('port defaults to 3000', () => {
      expect(configModule.loadConfig().server.port).toBe(3000);
    });
  });

  // -----------------------------------------------------------------------
  // Custom methods loading
  // -----------------------------------------------------------------------

  describe('loadUserMethods', () => {
    it('returns empty array when methods dir does not exist', () => {
      const methods = configModule.loadUserMethods();
      expect(methods).toEqual([]);
    });

    it('loads a valid YAML method file', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(
        path.join(methodsDir, 'custom.yaml'),
        YAML.stringify({
          name: 'My Method',
          description: 'A custom method',
          goodFor: 'Testing',
        }),
      );

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0]).toEqual({
        id: 100,
        name: 'My Method',
        description: 'A custom method',
        goodFor: 'Testing',
        builtIn: false,
      });
    });

    it('loads a valid .yml method file', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(
        path.join(methodsDir, 'custom.yml'),
        YAML.stringify({
          name: 'YML Method',
          description: 'From yml',
          goodFor: 'Flexibility',
        }),
      );

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].name).toBe('YML Method');
      expect(methods[0].builtIn).toBe(false);
    });

    it('loads a valid JSON method file', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(
        path.join(methodsDir, 'custom.json'),
        JSON.stringify({
          name: 'JSON Method',
          description: 'From JSON',
        }),
      );

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(1);
      expect(methods[0].name).toBe('JSON Method');
      expect(methods[0].goodFor).toBe(''); // defaults to empty
    });

    it('assigns IDs starting at 100', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(
        path.join(methodsDir, 'a.yaml'),
        YAML.stringify({ name: 'A', description: 'First' }),
      );
      fs.writeFileSync(
        path.join(methodsDir, 'b.yaml'),
        YAML.stringify({ name: 'B', description: 'Second' }),
      );

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(2);
      expect(methods[0].id).toBe(100);
      expect(methods[1].id).toBe(101);
    });

    it('sets builtIn to false for all user methods', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(
        path.join(methodsDir, 'custom.yaml'),
        YAML.stringify({ name: 'X', description: 'Y' }),
      );

      const methods = configModule.loadUserMethods();
      expect(methods.every((m) => m.builtIn === false)).toBe(true);
    });

    it('skips invalid schema files (missing required fields) with warning', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      // Missing "name"
      fs.writeFileSync(
        path.join(methodsDir, 'invalid.yaml'),
        YAML.stringify({ description: 'no name field' }),
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(0);
      // The file is silently skipped (no name -> doesn't pass the `if` check),
      // so no warning is emitted in this case. The warn is only for parse errors.
      warnSpy.mockRestore();
    });

    it('skips malformed YAML files with warning', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(path.join(methodsDir, 'broken.yaml'), ': : [[[{invalid');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('ignores non-yaml/yml/json files', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(path.join(methodsDir, 'readme.txt'), 'hello');
      fs.writeFileSync(path.join(methodsDir, 'notes.md'), '# notes');

      const methods = configModule.loadUserMethods();
      expect(methods).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // loadConfig with environment variables
  // -----------------------------------------------------------------------

  describe('loadConfig with environment variables', () => {
    function cleanEnv() {
      delete process.env.MODEL_DEFAULT;
      delete process.env.MODEL_NAVIGATOR;
      delete process.env.MODEL_STRATEGIST;
      delete process.env.MODEL_WORKER;
      delete process.env.MODEL_ANALYST;
      delete process.env.HAIKU_MODEL;
      delete process.env.SONNET_MODEL;
      delete process.env.OPUS_MODEL;
      delete process.env.PORT;
      delete process.env.IDEAS_PER_WORKER;
      delete process.env.WEB_SEARCH;
    }

    beforeEach(() => {
      cleanEnv();
      configModule.resetConfigCache();
    });

    it('reads model config from env vars', () => {
      process.env.MODEL_NAVIGATOR = 'claude-haiku-4-5-20251001';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.models.navigator).toBe('claude-haiku-4-5-20251001');
      // Others should still be defaults
      expect(cfg.models.strategist).toBe('claude-opus-4-6');
    });

    it('env vars override config.yaml values', () => {
      const yamlContent = YAML.stringify({
        models: { navigator: 'yaml-model' },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      process.env.MODEL_NAVIGATOR = 'env-model';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.models.navigator).toBe('env-model');
    });

    it('falls back to yaml when env vars are absent', () => {
      const yamlContent = YAML.stringify({
        models: { navigator: 'yaml-model' },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      configModule.resetConfigCache();
      const cfg = configModule.loadConfig();
      expect(cfg.models.navigator).toBe('yaml-model');
    });

    it('empty string env vars treated as unset', () => {
      process.env.MODEL_NAVIGATOR = '';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.models.navigator).toBe('claude-opus-4-6'); // default
    });

    it('full resolution chain: env > yaml > defaults', () => {
      const yamlContent = YAML.stringify({
        models: {
          navigator: 'yaml-nav',
          strategist: 'yaml-strat',
        },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      process.env.MODEL_NAVIGATOR = 'env-nav';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.models.navigator).toBe('env-nav'); // env wins
      expect(cfg.models.strategist).toBe('yaml-strat'); // yaml fallback
      expect(cfg.models.worker).toBe('claude-opus-4-6'); // default fallback
    });

    it('reads PORT from env', () => {
      process.env.PORT = '4000';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.server.port).toBe(4000);
    });

    it('reads IDEAS_PER_WORKER from env', () => {
      process.env.IDEAS_PER_WORKER = '20';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.defaults.ideasPerWorker).toBe(20);
    });

    it('ignores IDEAS_PER_WORKER out of range', () => {
      process.env.IDEAS_PER_WORKER = '999';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.defaults.ideasPerWorker).toBe(15); // default
    });

    it('reads WEB_SEARCH from env', () => {
      process.env.WEB_SEARCH = 'true';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.defaults.webSearch).toBe(true);
    });

    it('reads MODEL_DEFAULT from env', () => {
      process.env.MODEL_DEFAULT = 'custom-default';
      configModule.resetConfigCache();

      const cfg = configModule.loadConfig();
      expect(cfg.models.default).toBe('custom-default');
    });
  });

  // -----------------------------------------------------------------------
  // getModelOptions
  // -----------------------------------------------------------------------

  describe('getModelOptions', () => {
    function cleanModelEnv() {
      delete process.env.HAIKU_MODEL;
      delete process.env.SONNET_MODEL;
      delete process.env.OPUS_MODEL;
    }

    beforeEach(() => {
      cleanModelEnv();
    });

    it('returns defaults when no env vars set', () => {
      const options = configModule.getModelOptions();
      expect(options).toHaveLength(3);
      expect(options[0]).toEqual({ id: 'claude-haiku-4-5-20251001', label: 'Haiku', color: '#30a46c' });
      expect(options[1]).toEqual({ id: 'claude-sonnet-4-5-20250929', label: 'Sonnet', color: '#3e63dd' });
      expect(options[2]).toEqual({ id: 'claude-opus-4-6', label: 'Opus', color: '#f5a623' });
    });

    it('reads HAIKU_MODEL from env', () => {
      process.env.HAIKU_MODEL = 'claude-haiku-5-0';
      const options = configModule.getModelOptions();
      expect(options[0].id).toBe('claude-haiku-5-0');
      expect(options[0].label).toBe('Haiku');
    });

    it('reads SONNET_MODEL from env', () => {
      process.env.SONNET_MODEL = 'claude-sonnet-5-0';
      const options = configModule.getModelOptions();
      expect(options[1].id).toBe('claude-sonnet-5-0');
    });

    it('reads OPUS_MODEL from env', () => {
      process.env.OPUS_MODEL = 'claude-opus-5-0';
      const options = configModule.getModelOptions();
      expect(options[2].id).toBe('claude-opus-5-0');
    });

    it('handles partial overrides', () => {
      process.env.SONNET_MODEL = 'custom-sonnet';
      const options = configModule.getModelOptions();
      expect(options[0].id).toBe('claude-haiku-4-5-20251001'); // unchanged
      expect(options[1].id).toBe('custom-sonnet'); // overridden
      expect(options[2].id).toBe('claude-opus-4-6'); // unchanged
    });
  });

  // -----------------------------------------------------------------------
  // getAllMethods
  // -----------------------------------------------------------------------

  describe('getAllMethods', () => {
    it('returns 10 built-in methods when no user methods exist', () => {
      const methods = configModule.getAllMethods();
      expect(methods).toHaveLength(10);
      expect(methods.every((m) => m.builtIn === true)).toBe(true);
    });

    it('returns built-in + user methods merged', () => {
      fs.mkdirSync(methodsDir, { recursive: true });
      fs.writeFileSync(
        path.join(methodsDir, 'custom.yaml'),
        YAML.stringify({ name: 'Custom', description: 'Desc' }),
      );

      const methods = configModule.getAllMethods();
      expect(methods).toHaveLength(11);

      // First 10 are built-in
      const builtIn = methods.slice(0, 10);
      expect(builtIn.every((m) => m.builtIn === true)).toBe(true);

      // Last one is user-defined
      expect(methods[10].name).toBe('Custom');
      expect(methods[10].builtIn).toBe(false);
      expect(methods[10].id).toBe(100);
    });

    it('built-in methods start with First Principles (id=1)', () => {
      const methods = configModule.getAllMethods();
      expect(methods[0].id).toBe(1);
      expect(methods[0].name).toBe('First Principles');
    });
  });
});
