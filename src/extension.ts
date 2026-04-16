/**
 * extension.ts — Cortex-Debug MCP Bridge
 *
 * Activates when a Cortex-Debug or PlatformIO debug session starts.
 * Starts a local MCP HTTP/SSE server so Claude Code (or any MCP client)
 * can read live debug state: variables, registers, memory, call stack.
 */

import * as vscode from 'vscode';
import { McpHttpServer } from './mcpServer';
import { PeripheralTesterPanel } from './panels/PeripheralTesterPanel';
import { OpenOcdManager } from './openocdManager';
import * as logger from './logger';

let server: McpHttpServer | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export async function activate(context: vscode.ExtensionContext) {
  logger.info('Cortex MCP Bridge activating...');

  const cfg = () => vscode.workspace.getConfiguration('embeddedAiDebug');

  // ── Status bar item ─────────────────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.command = 'embedded-ai-debug.showStatus';
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
      updateStatusBar('running', actualPort);
      await ensureMcpJson(actualPort);
    } catch (e: unknown) {
      const msg = `Cortex MCP Bridge: Failed to start server — ${(e as Error).message}`;
      logger.error(msg);
      vscode.window.showErrorMessage(msg);
      updateStatusBar('error');
    }
  }

  // ── Helper: create .mcp.json in workspace root if missing ───────────────────
  async function ensureMcpJson(port: number) {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const mcpContent = JSON.stringify(
      { mcpServers: { 'cortex-debug': { type: 'sse', url: `http://localhost:${port}/sse` } } },
      null, 2
    );

    for (const folder of folders) {
      const mcpUri = vscode.Uri.joinPath(folder.uri, '.mcp.json');
      try {
        await vscode.workspace.fs.stat(mcpUri);
        // File exists — check if URL matches current port
        const existing = Buffer.from(
          await vscode.workspace.fs.readFile(mcpUri)
        ).toString('utf8');
        if (existing.includes(`localhost:${port}/sse`)) {
          logger.debug(`.mcp.json already up to date in ${folder.name}`);
          return;
        }
        // Port changed — ask before overwriting
        const update = await vscode.window.showInformationMessage(
          `.mcp.json in "${folder.name}" points to a different port. Update to port ${port}?`,
          'Update', 'Keep existing'
        );
        if (update !== 'Update') return;
        await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(mcpContent, 'utf8'));
        logger.info(`.mcp.json updated in ${folder.name}`);
        vscode.window.showInformationMessage(`.mcp.json updated in "${folder.name}".`);
      } catch {
        // File does not exist — create it
        await vscode.workspace.fs.writeFile(mcpUri, Buffer.from(mcpContent, 'utf8'));
        logger.info(`.mcp.json created in ${folder.name}`);
        vscode.window.showInformationMessage(
          `.mcp.json created in "${folder.name}" — Claude Code is now connected to the MCP bridge.`
        );
      }
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('embedded-ai-debug.startServer', async () => {
      await ensureStarted();
      if (server?.running) {
        vscode.window.showInformationMessage(
          `Cortex MCP Bridge running on port ${server.port}. Add .mcp.json to your project to connect Claude Code.`
        );
        logger.getChannel().show(true);
      }
    }),

    vscode.commands.registerCommand('embedded-ai-debug.stopServer', () => {
      server?.stop();
      server = undefined;
      updateStatusBar('stopped');
      vscode.window.showInformationMessage('Cortex MCP Bridge stopped.');
    }),

    vscode.commands.registerCommand('embedded-ai-debug.copyMcpConfig', async () => {
      if (!server?.running) {
        vscode.window.showWarningMessage('Server is not running. Start it first.');
        return;
      }
      const port = server.port!;
      const snippet = JSON.stringify(
        {
          mcpServers: {
            'cortex-debug': {
              type: 'sse',
              url: `http://localhost:${port}/sse`
            }
          }
        },
        null,
        2
      );
      await vscode.env.clipboard.writeText(snippet);
      vscode.window.showInformationMessage(
        `MCP config copied! Paste it into a .mcp.json file at your project root.`
      );
    }),

    vscode.commands.registerCommand('embedded-ai-debug.showStatus', () => {
      const channel = logger.getChannel();
      channel.show(true);
      if (server?.running) {
        channel.appendLine(`\n── Status ──────────────────────────────────────`);
        channel.appendLine(`Server:   running on http://localhost:${server.port}`);
        channel.appendLine(`SSE URL:  http://localhost:${server.port}/sse`);
        channel.appendLine(`Health:   http://localhost:${server.port}/health`);
        channel.appendLine(`Session:  ${vscode.debug.activeDebugSession?.name ?? 'none'}`);
        channel.appendLine(`────────────────────────────────────────────────\n`);
      } else {
        channel.appendLine('\nServer is stopped. Run "Cortex MCP: Start Bridge Server".\n');
      }
    })
  );

  // ── Permission-aware auto-start ──────────────────────────────────────────────
  //
  // Stored in globalState so it persists across VSCode restarts:
  //   'always'  — start automatically without asking
  //   'never'   — never auto-start (user can still start manually)
  //   undefined — not yet decided → show dialog
  //
  const PERM_KEY = 'autoStartPermission';

  async function maybeAutoStart(sessionName: string) {
    if (!cfg().get<boolean>('autoStart', true)) return;
    if (server?.running) return;

    const stored = context.globalState.get<string>(PERM_KEY);

    if (stored === 'never') {
      logger.info('Auto-start skipped (user chose Never).');
      return;
    }

    if (stored === 'always') {
      logger.info(`Auto-starting MCP server for session "${sessionName}".`);
      await ensureStarted();
      return;
    }

    // First time — ask the user
    const choice = await vscode.window.showInformationMessage(
      `Cortex-Debug session "${sessionName}" started.\n` +
      `Start the MCP Bridge server so Claude Code can read live debug state?`,
      { modal: false },
      'Always start',
      'Start once',
      'Never'
    );

    if (choice === 'Always start') {
      await context.globalState.update(PERM_KEY, 'always');
      await ensureStarted();
    } else if (choice === 'Start once') {
      await ensureStarted();
    } else if (choice === 'Never') {
      await context.globalState.update(PERM_KEY, 'never');
      vscode.window.showInformationMessage(
        'Auto-start disabled. You can still start it manually with "Cortex MCP: Start Bridge Server".'
      );
    }
    // Dismissed (undefined) → do nothing, ask again next time
  }

  // ── Reset permission command ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('embedded-ai-debug.resetPermission', async () => {
      await context.globalState.update(PERM_KEY, undefined);
      vscode.window.showInformationMessage('Auto-start permission reset. You will be asked again on the next debug session.');
    }),

    vscode.commands.registerCommand('embedded-ai-debug.openPeripheralTester', () => {
      PeripheralTesterPanel.createOrShow(context);
    })
  );

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

  logger.info('Cortex MCP Bridge activated.');
}

export function deactivate() {
  server?.stop();
  OpenOcdManager.instance.stop();
  logger.dispose();
}

// ── Status bar helper ─────────────────────────────────────────────────────────

function updateStatusBar(state: 'running' | 'stopped' | 'error', port?: number) {
  if (!statusBarItem) return;
  switch (state) {
    case 'running':
      statusBarItem.text = `$(debug-alt) MCP :${port}`;
      statusBarItem.tooltip = `Cortex MCP Bridge running on port ${port}\nClick to show log`;
      statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');
      statusBarItem.backgroundColor = undefined;
      break;
    case 'stopped':
      statusBarItem.text = `$(debug-disconnect) MCP`;
      statusBarItem.tooltip = 'Cortex MCP Bridge stopped\nClick to show log';
      statusBarItem.color = undefined;
      statusBarItem.backgroundColor = undefined;
      break;
    case 'error':
      statusBarItem.text = `$(error) MCP`;
      statusBarItem.tooltip = 'Cortex MCP Bridge error — click to show log';
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
  }
}
