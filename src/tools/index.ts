import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerGetCallStack } from './getCallStack';
import { registerGetVariables } from './getVariables';
import { registerExpandVariable } from './expandVariable';
import { registerGetRegisters } from './getRegisters';
import { registerGetMemory } from './getMemory';
import { registerEvaluate } from './evaluate';
import { registerSetBreakpoint } from './setBreakpoint';
import { registerContinueExecution } from './continueExecution';
import { registerPauseExecution } from './pauseExecution';
import { registerStepOver } from './stepOver';
import { registerGdbCommand } from './gdbCommand';
import { registerGetSessionInfo } from './getSessionInfo';
import { registerReadLiveMemory } from './readLiveMemory';
import { registerRemoveBreakpoint } from './removeBreakpoint';
import { registerGetSymbols } from './getSymbols';

export function registerAllTools(server: McpServer) {
  registerGetSessionInfo(server);
  registerGetSymbols(server);
  registerGetCallStack(server);
  registerGetVariables(server);
  registerExpandVariable(server);
  registerGetRegisters(server);
  registerGetMemory(server);
  registerEvaluate(server);
  registerSetBreakpoint(server);
  registerRemoveBreakpoint(server);
  registerContinueExecution(server);
  registerPauseExecution(server);
  registerStepOver(server);
  registerGdbCommand(server);
  registerReadLiveMemory(server);
}
