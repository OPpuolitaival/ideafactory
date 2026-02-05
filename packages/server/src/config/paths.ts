import path from 'path';
import os from 'os';

export function getDataDir(): string {
  return path.join(os.homedir(), '.ideafactory');
}

export function getConfigPath(): string {
  return path.join(getDataDir(), 'config.yaml');
}

export function getMethodsDir(): string {
  return path.join(getDataDir(), 'methods');
}

export function getPersonasDir(): string {
  return path.join(getDataDir(), 'personas');
}
