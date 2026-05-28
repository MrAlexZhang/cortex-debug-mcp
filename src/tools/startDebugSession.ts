import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as vscode from 'vscode';
import * as dap from '../dapBridge';

const SUPPORTED_TYPES = ['cortex-debug', 'platformio-debug'];

export function registerStartDebugSession(server: McpServer) {
  server.tool(
    'start_debug_session',
    'Starts a Cortex-Debug or PlatformIO debug session from launch.json, then waits until it becomes active. Use this when no supported debug session is running.',
    {
      workspaceFolder: z.string().optional().describe('Optional workspace folder path or name that contains launch.json.'),
      launchName: z.string().optional().describe('Optional launch configuration name in launch.json. If omitted, the first supported config is used.'),
      waitMs: z.number().int().min(1000).max(120000).optional().describe('How long to wait for the session to become active (default: 15000).')
    },
    async ({ workspaceFolder, launchName, waitMs = 15000 }) => {
      try {
        const active = vscode.debug.activeDebugSession;
        if (active && SUPPORTED_TYPES.includes(active.type)) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                started: false,
                alreadyActive: true,
                sessionId: active.id,
                sessionName: active.name,
                sessionType: active.type
              }, null, 2)
            }]
          };
        }
        const session = await dap.startSupportedDebugSession({ workspaceFolder, launchName, waitMs });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              started: true,
              sessionId: session.id,
              sessionName: session.name,
              sessionType: session.type
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
