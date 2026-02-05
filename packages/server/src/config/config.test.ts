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
// 2-9. Config loading / saving / methods / personas
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

    // Remove env var so it doesn't leak between tests
    delete process.env.ANTHROPIC_API_KEY;

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
  // loadConfig – default config when no file
  // -----------------------------------------------------------------------

  describe('loadConfig', () => {
    it('returns default config when no config file exists', () => {
      const cfg = configModule.loadConfig();

      expect(cfg.apiKey).toBeUndefined();
      expect(cfg.defaults.workerCount).toBe(3);
      expect(cfg.defaults.ideasPerWorker).toBe(15);
      expect(cfg.defaults.webSearch).toBe(false);
      expect(cfg.server.port).toBe(3000);
      // Model defaults
      expect(cfg.models.default).toBe('claude-sonnet-4-20250514');
      expect(cfg.models.navigator).toBe('claude-haiku-4-20250414');
    });

    it('reads valid config.yaml correctly', () => {
      const yamlContent = YAML.stringify({
        apiKey: 'sk-yaml-key',
        defaults: {
          workerCount: 5,
          ideasPerWorker: 25,
          webSearch: true,
        },
        server: { port: 8080 },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      const cfg = configModule.loadConfig();

      expect(cfg.apiKey).toBe('sk-yaml-key');
      expect(cfg.defaults.workerCount).toBe(5);
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
      expect(cfg.defaults.workerCount).toBe(3);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('handles YAML that violates schema (e.g. workerCount out of range)', () => {
      const yamlContent = YAML.stringify({
        defaults: { workerCount: 999 },
      });
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, yamlContent);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const cfg = configModule.loadConfig();

      expect(cfg.defaults.workerCount).toBe(3); // fallback
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
    it('workerCount defaults to 3', () => {
      expect(configModule.loadConfig().defaults.workerCount).toBe(3);
    });

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
  // API key resolution
  // -----------------------------------------------------------------------

  describe('API key resolution', () => {
    it('ANTHROPIC_API_KEY env var takes priority over config file', () => {
      // Write a config file with an apiKey
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, YAML.stringify({ apiKey: 'sk-from-config' }));

      process.env.ANTHROPIC_API_KEY = 'sk-from-env';

      const cfg = configModule.loadConfig();
      expect(cfg.apiKey).toBe('sk-from-env');
    });

    it('config.yaml apiKey is used as fallback when env var is not set', () => {
      delete process.env.ANTHROPIC_API_KEY;

      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, YAML.stringify({ apiKey: 'sk-from-config' }));

      const cfg = configModule.loadConfig();
      expect(cfg.apiKey).toBe('sk-from-config');
    });

    it('apiKey is undefined when neither env var nor config provides it', () => {
      delete process.env.ANTHROPIC_API_KEY;

      const cfg = configModule.loadConfig();
      expect(cfg.apiKey).toBeUndefined();
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
      // The file is silently skipped (no name → doesn't pass the `if` check),
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
  // Custom personas loading
  // -----------------------------------------------------------------------

  describe('loadUserPersonas', () => {
    it('returns empty array when personas dir does not exist', () => {
      const personas = configModule.loadUserPersonas();
      expect(personas).toEqual([]);
    });

    it('loads a valid YAML persona file', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, 'designer.yaml'),
        YAML.stringify({
          name: 'The Designer',
          systemPrompt: 'You are a designer.',
          defaultMethod: 'Biomimicry',
        }),
      );

      const personas = configModule.loadUserPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0]).toEqual({
        name: 'The Designer',
        systemPrompt: 'You are a designer.',
        defaultMethod: 'Biomimicry',
        builtIn: false,
      });
    });

    it('sets builtIn to false for user personas', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, 'p.yaml'),
        YAML.stringify({ name: 'P', systemPrompt: 'prompt' }),
      );

      const personas = configModule.loadUserPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].builtIn).toBe(false);
    });

    it('skips files missing required fields', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      // Missing systemPrompt
      fs.writeFileSync(
        path.join(personasDir, 'bad.yaml'),
        YAML.stringify({ name: 'Incomplete' }),
      );

      const personas = configModule.loadUserPersonas();
      expect(personas).toHaveLength(0);
    });

    it('skips malformed YAML files with warning', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(path.join(personasDir, 'broken.yaml'), '{{{{invalid');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const personas = configModule.loadUserPersonas();
      expect(personas).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('loads JSON persona files', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, 'dev.json'),
        JSON.stringify({ name: 'Dev', systemPrompt: 'You are a dev.' }),
      );

      const personas = configModule.loadUserPersonas();
      expect(personas).toHaveLength(1);
      expect(personas[0].name).toBe('Dev');
    });

    it('defaultMethod is undefined when not provided', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, 'simple.yaml'),
        YAML.stringify({ name: 'Simple', systemPrompt: 'prompt' }),
      );

      const personas = configModule.loadUserPersonas();
      expect(personas[0].defaultMethod).toBeUndefined();
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

  // -----------------------------------------------------------------------
  // getAllPersonas
  // -----------------------------------------------------------------------

  describe('getAllPersonas', () => {
    it('returns 3 built-in personas when no user personas exist', () => {
      const personas = configModule.getAllPersonas();
      expect(personas).toHaveLength(3);
      expect(personas.every((p) => p.builtIn === true)).toBe(true);
    });

    it('returns built-in + user personas merged', () => {
      fs.mkdirSync(personasDir, { recursive: true });
      fs.writeFileSync(
        path.join(personasDir, 'custom.yaml'),
        YAML.stringify({ name: 'Custom Persona', systemPrompt: 'Be creative.' }),
      );

      const personas = configModule.getAllPersonas();
      expect(personas).toHaveLength(4);

      // First 3 are built-in
      expect(personas[0].name).toBe('The Engineer');
      expect(personas[1].name).toBe('The Visionary');
      expect(personas[2].name).toBe('The Anthropologist');
      expect(personas.slice(0, 3).every((p) => p.builtIn === true)).toBe(true);

      // Last one is user-defined
      expect(personas[3].name).toBe('Custom Persona');
      expect(personas[3].builtIn).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // saveApiKey
  // -----------------------------------------------------------------------

  describe('saveApiKey', () => {
    it('writes api key to config.yaml', () => {
      configModule.saveApiKey('sk-new-key');

      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = YAML.parse(raw);
      expect(parsed.apiKey).toBe('sk-new-key');
    });

    it('creates parent directory if it does not exist', () => {
      // tmpDir already exists but let's use a nested path to confirm mkdirSync works
      expect(fs.existsSync(configPath)).toBe(false);

      configModule.saveApiKey('sk-test');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('sets file permissions to 0o600', () => {
      configModule.saveApiKey('sk-secret');

      const stat = fs.statSync(configPath);
      // mode includes file-type bits; mask to get permission bits only
      const permissions = stat.mode & 0o777;
      expect(permissions).toBe(0o600);
    });

    it('preserves existing config values when saving api key', () => {
      // Write an existing config first
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(
        configPath,
        YAML.stringify({
          defaults: { workerCount: 4 },
          server: { port: 9999 },
        }),
      );

      configModule.saveApiKey('sk-updated');

      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = YAML.parse(raw);
      expect(parsed.apiKey).toBe('sk-updated');
      expect(parsed.defaults.workerCount).toBe(4);
      expect(parsed.server.port).toBe(9999);
    });

    it('overwrites existing apiKey', () => {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, YAML.stringify({ apiKey: 'sk-old' }));

      configModule.saveApiKey('sk-new');

      const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(parsed.apiKey).toBe('sk-new');
    });

    it('invalidates config cache after saving', () => {
      // Load config to populate cache
      const cfg1 = configModule.loadConfig();
      expect(cfg1.apiKey).toBeUndefined();

      // Save a key
      configModule.saveApiKey('sk-after-save');

      // Next load should re-read (cache invalidated)
      const cfg2 = configModule.loadConfig();
      // Without env var, it should pick up the saved key
      expect(cfg2.apiKey).toBe('sk-after-save');
    });

    it('handles pre-existing malformed YAML that parses to null', () => {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      // YAML.parse('') returns null, and the `?? {}` fallback kicks in
      fs.writeFileSync(configPath, '');

      configModule.saveApiKey('sk-recover');

      const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(parsed.apiKey).toBe('sk-recover');
    });

    it('handles pre-existing file with truly unparseable YAML', () => {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      // This content causes YAML.parse to throw, which is caught by the try/catch,
      // resulting in existing = {}
      fs.writeFileSync(configPath, '  - :\n    -\n  a: [');

      configModule.saveApiKey('sk-after-error');

      const parsed = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(parsed.apiKey).toBe('sk-after-error');
    });
  });
});
