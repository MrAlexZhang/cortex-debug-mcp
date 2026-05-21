import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

export interface BackendState {
  port: number;
  updatedAt: string;
}

const BACKEND_STATE_FILE = path.join(os.tmpdir(), 'cortex-debug-mcp-backend.json');

export function getBackendStatePath(): string {
  return BACKEND_STATE_FILE;
}

export async function writeBackendState(port: number): Promise<void> {
  const state: BackendState = {
    port,
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(BACKEND_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export async function clearBackendState(): Promise<void> {
  try {
    await fs.unlink(BACKEND_STATE_FILE);
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function readBackendState(): Promise<BackendState> {
  const raw = await fs.readFile(BACKEND_STATE_FILE, 'utf8');
  const parsed = JSON.parse(raw) as Partial<BackendState>;

  if (typeof parsed.port !== 'number' || !Number.isFinite(parsed.port) || parsed.port <= 0) {
    throw new Error(`Invalid backend state file at ${BACKEND_STATE_FILE}`);
  }

  return {
    port: parsed.port,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString()
  };
}
