import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as vscode from 'vscode';

const SUPPORTED_TYPES = ['cortex-debug', 'platformio-debug'];

export function registerStopDebugSession(server: McpServer) {
  server.tool(
    'stop_debug_session',
    'Stops an active Cortex-Debug or PlatformIO debug session. By default it stops the current active supported session.',
    {
      sessionId: z.string().optional().describe('Optional debug session ID to stop.'),
      all: z.boolean().optional().describe('If true, stops all supported sessions.')
    },
    async ({ sessionId, all = false }) => {
      try {
        const sessions = vscode.debug.sessions.filter(s => SUPPORTED_TYPES.includes(s.type));
        if (!sessions.length) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({ stopped: 0, message: 'No active Cortex-Debug or PlatformIO debug session.' }, null, 2)
            }]
          };
        }

        let targets: vscode.DebugSession[] = [];
        if (all) {
          targets = sessions;
        } else if (sessionId) {
          const target = sessions.find(s => s.id === sessionId);
          if (!target) {
            throw new Error(`No supported debug session with id '${sessionId}' was found.`);
          }
          targets = [target];
        } else {
          const active = vscode.debug.activeDebugSession;
          if (!active || !SUPPORTED_TYPES.includes(active.type)) {
            throw new Error('No active supported debug session. Pass sessionId or set all=true to stop others.');
          }
          targets = [active];
        }

        for (const target of targets) {
          await vscode.debug.stopDebugging(target);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              stopped: targets.length,
              stoppedSessionIds: targets.map(t => t.id),
              all
            }, null, 2)
          }]
        };
      } catch (e: unknown) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }],
          isError: true
        };
      }
    }
  );
}
