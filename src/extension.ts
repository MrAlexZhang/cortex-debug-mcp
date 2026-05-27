/**
 * extension.ts — Cortex Debug MCP
 *
 * Activates when a Cortex-Debug or PlatformIO debug session starts.
 * Starts a local MCP backend so a stdio MCP proxy can expose the tools to
 * external clients while the extension keeps access to VS Code debug APIs.
 */

import * as vscode from 'vscode';
import { McpHttpServer } from './mcpServer';
import { clearBackendState, getBackendStatePath, writeBackendState } from './backendState';
import { PeripheralTesterPanel } from './panels/PeripheralTesterPanel';
import { OpenOcdManager } from './openocdManager';
import * as logger from './logger';

let server: McpHttpServer | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext) {
  logger.info('Cortex Debug MCP activating...');

  const cfg = () => vscode.workspace.getConfiguration('cortexDebugMcp');

  // ── Status bar item ─────────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'cortex-debug-mcp.showStatus';
  updateStatusBar('stopped');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Helper: ensure server is running ────────────────────────────────────────
  async function ensureStarted() {
    if (server?.running) return;
    const port = cfg().get<number>('port', 7580);
    server = new McpHttpServer(port);
    try {
      const actualPort = await server.start();
      await writeBackendState(actualPort);
      updateStatusBar('running', actualPort);
    } catch (e: unknown) {
      const msg = `Cortex Debug MCP: Failed to start server — ${(e as Error).message}`;
      logger.error(msg);
      vscode.window.showErrorMessage(msg);
      updateStatusBar('error');
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('cortex-debug-mcp.startServer', async () => {
      await ensureStarted();
      if (server?.running) {
        vscode.window.showInformationMessage(
          `Cortex Debug MCP backend is running. Launch the bundled stdio proxy to connect your MCP client.`
        );
        logger.getChannel().show(true);
      }
    }),

    vscode.commands.registerCommand('cortex-debug-mcp.stopServer', async () => {
      server?.stop();
      server = undefined;
      await clearBackendState();
      updateStatusBar('stopped');
      vscode.window.showInformationMessage(
        'Cortex Debug MCP backend stopped.'
      );
    }),

    vscode.commands.registerCommand('cortex-debug-mcp.showStatus', () => {
      const channel = logger.getChannel();
      channel.show(true);
      if (server?.running) {
        channel.appendLine(`\n── Status ──────────────────────────────────────`);
        channel.appendLine(`Backend:  running on http://127.0.0.1:${server.port}`);
        channel.appendLine(`Proxy:    node <extension-dist>\\stdioProxy.js`);
        channel.appendLine(`State:    ${getBackendStatePath()}`);
        channel.appendLine(`Session:  ${vscode.debug.activeDebugSession?.name ?? 'none'}`);
        channel.appendLine(`────────────────────────────────────────────────\n`);
      } else {
        channel.appendLine('\nBridge backend is stopped. Run "Cortex Debug MCP: Start Bridge Server".\n');
      }
    }),

    vscode.commands.registerCommand('cortex-debug-mcp.openPeripheralTester', () => {
      PeripheralTesterPanel.createOrShow(context);
    })
  );

  async function maybeAutoStart(sessionName: string) {
    if (!cfg().get<boolean>('autoStart', true)) return;
    if (server?.running) return;
    logger.info(`Auto-starting Cortex Debug MCP backend for session "${sessionName}".`);
    await ensureStarted();
  }

  // ── Listen for debug sessions ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async session => {
      const supported = ['cortex-debug', 'platformio-debug'];
      if (!supported.includes(session.type)) return;
      logger.info(`Debug session started: ${session.name} (${session.type})`);
      await maybeAutoStart(session.name);
    }),

    vscode.debug.onDidTerminateDebugSession(session => {
      logger.info(`Debug session ended: ${session.name}`);
      // Keep the server running — user may restart the debug session
    })
  );

  // ── Auto-start if a session is already active when extension loads ────────────
  if (vscode.debug.activeDebugSession) {
    const supported = ['cortex-debug', 'platformio-debug'];
    if (supported.includes(vscode.debug.activeDebugSession.type)) {
      await maybeAutoStart(vscode.debug.activeDebugSession.name);
    }
  }

  // ── Start server on VS Code startup so Claude Code always finds it ────────────
  // Starts silently on activation (onStartupFinished) without waiting for a
  // debug session — this ensures the MCP SSE endpoint is up before Claude Code
  // tries to connect when the workspace opens.
  if (cfg().get<boolean>('autoStart', true)) {
    await ensureStarted();
  }

  logger.info('Cortex Debug MCP activated.');
}

export function deactivate() {
  server?.stop();
  void clearBackendState();
  OpenOcdManager.instance.stop();
  logger.dispose();
}

// ── Status bar helper ─────────────────────────────────────────────────────────

function updateStatusBar(state: 'running' | 'stopped' | 'error', port?: number) {
  if (!statusBarItem) return;
  switch (state) {
    case 'running':
      statusBarItem.text = `$(debug-alt) MCP Ready`;
      statusBarItem.tooltip = `Cortex Debug MCP backend ready on port ${port}\nClick to show log`;
      statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
      statusBarItem.backgroundColor = undefined;
      break;
    case 'stopped':
      statusBarItem.text = `$(debug-disconnect) MCP`;
      statusBarItem.tooltip = 'Cortex Debug MCP stopped\nClick to show log';
      statusBarItem.color = undefined;
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = `$(error) MCP`;
      statusBarItem.tooltip = 'Cortex Debug MCP error — click to show log';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
  }
}
