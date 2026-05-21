import process from 'node:process';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { getBackendStatePath, readBackendState } from './backendState';

function logToStderr(message: string): void {
  process.stderr.write(`[cortex-debug-mcp] ${message}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resolveBackendUrl(): Promise<URL> {
  const explicitUrl = process.env.CORTEX_DEBUG_MCP_BACKEND_URL;
  if (explicitUrl) {
    return new URL(explicitUrl);
  }

  const explicitPort = process.env.CORTEX_DEBUG_MCP_PORT;
  if (explicitPort) {
    const port = Number(explicitPort);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid CORTEX_DEBUG_MCP_PORT value: ${explicitPort}`);
    }
    return new URL(`http://127.0.0.1:${port}/sse`);
  }

  const state = await readBackendState();
  return new URL(`http://127.0.0.1:${state.port}/sse`);
}

async function main(): Promise<void> {
  const backendUrl = await resolveBackendUrl();
  const stdio = new StdioServerTransport();
  const backend = new SSEClientTransport(backendUrl);

  let closing = false;
  let backendReady = false;
  const pendingMessages: JSONRPCMessage[] = [];

  const closeAll = async (reason?: string) => {
    if (closing) {
      return;
    }
    closing = true;

    if (reason) {
      logToStderr(reason);
    }

    await Promise.allSettled([
      backend.close(),
      stdio.close()
    ]);
  };

  const sendToBackend = async (message: JSONRPCMessage) => {
    let lastError: unknown;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        await backend.send(message);
        return;
      } catch (error: unknown) {
        lastError = error;
        if (!(error instanceof Error) || error.message !== 'Not connected') {
          throw error;
        }
        await delay(100);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`Failed to send message to backend: ${String(lastError)}`);
  };

  const flushPendingMessages = async () => {
    while (pendingMessages.length > 0) {
      const message = pendingMessages.shift();
      if (!message) {
        return;
      }
      await sendToBackend(message);
    }
  };

  backend.onmessage = message => {
    void stdio.send(message).catch(error => {
      void closeAll(`Failed to forward backend message to stdio: ${(error as Error).message}`);
    });
  };

  stdio.onmessage = message => {
    if (!backendReady) {
      pendingMessages.push(message);
      return;
    }

    void sendToBackend(message).catch(error => {
      void closeAll(`Failed to forward stdio message to backend: ${(error as Error).message}`);
    });
  };

  backend.onerror = error => {
    logToStderr(`Backend transport error: ${error.message}`);
  };

  stdio.onerror = error => {
    logToStderr(`Stdio transport error: ${error.message}`);
  };

  backend.onclose = () => {
    void closeAll('Backend connection closed.');
  };

  stdio.onclose = () => {
    void closeAll();
  };

  await stdio.start();
  await backend.start();
  backendReady = true;
  await flushPendingMessages();
}

main().catch(error => {
  const details = error instanceof Error ? error.message : String(error);
  logToStderr(`Unable to start stdio bridge: ${details}`);
  logToStderr(`Expected backend state file: ${getBackendStatePath()}`);
  process.exit(1);
});
