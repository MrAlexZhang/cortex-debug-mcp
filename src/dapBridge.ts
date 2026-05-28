/**
 * dapBridge.ts
 *
 * All communication with the active debug session goes through this module.
 * Uses VSCode's Debug Adapter Protocol (DAP) API — both standard DAP requests
 * and Cortex-Debug custom requests (read-registers, read-memory, execute-command).
 *
 * IMPORTANT: Most DAP requests only work while the target MCU is paused (halted).
 * The Cortex-Debug adapter returns an error if the target is running.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as logger from './logger';
import { StackFrame, Variable, Scope, Register, MemoryReadResult, EvaluateResult } from './types';

const SUPPORTED_SESSION_TYPES = ['cortex-debug', 'platformio-debug'];
const MANAGED_SESSION_IDS = new Set<string>();
let startSessionPromise: Promise<vscode.DebugSession> | undefined;

interface StartDebugSessionOptions {
  workspaceFolder?: string;
  launchName?: string;
  waitMs?: number;
}

function autoManageEnabled(): boolean {
  return vscode.workspace.getConfiguration('cortexDebugMcp').get<boolean>('autoManageDebugSession', false);
}

function normalizeFsPath(input: string): string {
  return path.normalize(input).toLowerCase();
}

function resolveWorkspaceFolder(input?: string): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length) return undefined;

  if (input) {
    const normalized = normalizeFsPath(input);
    const byPath = folders.find(f => normalizeFsPath(f.uri.fsPath) === normalized);
    if (byPath) return byPath;

    const byName = folders.find(f => f.name.toLowerCase() === input.toLowerCase());
    if (byName) return byName;
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const byEditor = vscode.workspace.getWorkspaceFolder(activeUri);
    if (byEditor) return byEditor;
  }

  return folders[0];
}

function getSupportedLaunchConfigs(folder?: vscode.WorkspaceFolder): Record<string, unknown>[] {
  const launchCfg = vscode.workspace.getConfiguration('launch', folder?.uri);
  const configs = launchCfg.get<Record<string, unknown>[]>('configurations', []);
  return configs.filter(c => {
    const type = c.type;
    return typeof type === 'string' && SUPPORTED_SESSION_TYPES.includes(type);
  });
}

async function waitForSupportedSession(timeoutMs: number): Promise<vscode.DebugSession> {
  const active = vscode.debug.activeDebugSession;
  if (active && SUPPORTED_SESSION_TYPES.includes(active.type)) {
    return active;
  }

  return new Promise((resolve, reject) => {
    const disposable = vscode.debug.onDidStartDebugSession(session => {
      if (SUPPORTED_SESSION_TYPES.includes(session.type)) {
        clearTimeout(timer);
        disposable.dispose();
        resolve(session);
      }
    });

    const timer = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Timed out waiting for debug session start (${timeoutMs} ms).`));
    }, timeoutMs);
  });
}

export async function startSupportedDebugSession(options: StartDebugSessionOptions = {}): Promise<vscode.DebugSession> {
  const active = vscode.debug.activeDebugSession;
  if (active && SUPPORTED_SESSION_TYPES.includes(active.type)) {
    return active;
  }

  if (startSessionPromise) {
    return startSessionPromise;
  }

  const waitMs = options.waitMs ?? 15000;
  startSessionPromise = (async () => {
    const folder = resolveWorkspaceFolder(options.workspaceFolder);
    const configs = getSupportedLaunchConfigs(folder);
    if (!configs.length) {
      throw new Error(
        `No supported launch configuration found. Add a launch config with type '${SUPPORTED_SESSION_TYPES.join("' or '")}' in launch.json.`
      );
    }

    let selected = configs[0];
    if (options.launchName) {
      const named = configs.find(c => c.name === options.launchName);
      if (!named) {
        const names = configs
          .map(c => c.name)
          .filter((n): n is string => typeof n === 'string')
          .join(', ');
        throw new Error(`Launch configuration '${options.launchName}' not found. Available: ${names || '(none)'}.`);
      }
      selected = named;
    }

    const selectedName = typeof selected.name === 'string' ? selected.name : undefined;
    if (!selectedName) {
      throw new Error('Selected launch configuration has no valid name field.');
    }

    logger.info(`Starting managed debug session: ${selectedName}`);
    const started = await vscode.debug.startDebugging(folder, selectedName);
    if (!started) {
      throw new Error('VS Code refused to start the debug session. Check launch.json and debugger availability.');
    }

    const session = await waitForSupportedSession(waitMs);
    MANAGED_SESSION_IDS.add(session.id);
    return session;
  })().finally(() => {
    startSessionPromise = undefined;
  });

  return startSessionPromise;
}

export async function stopManagedSessions(): Promise<number> {
  if (!MANAGED_SESSION_IDS.size) return 0;

  const targets = vscode.debug.sessions.filter(s => MANAGED_SESSION_IDS.has(s.id));
  for (const session of targets) {
    await vscode.debug.stopDebugging(session);
    MANAGED_SESSION_IDS.delete(session.id);
  }
  return targets.length;
}

// ── Session guard ─────────────────────────────────────────────────────────────

export async function getSession(): Promise<vscode.DebugSession> {
  const session = vscode.debug.activeDebugSession;
  if (!session && autoManageEnabled()) {
    return startSupportedDebugSession();
  }
  if (!session) {
    throw new Error(
      'No active debug session. Start a Cortex-Debug or PlatformIO debug session first, ' +
      'or enable setting "cortexDebugMcp.autoManageDebugSession" so MCP starts it automatically.'
    );
  }
  if (!SUPPORTED_SESSION_TYPES.includes(session.type)) {
    throw new Error(
      `Active session type is '${session.type}'. ` +
      `Only ${SUPPORTED_SESSION_TYPES.join(', ')} are supported.`
    );
  }
  return session;
}

export function hasSession(): boolean {
  const session = vscode.debug.activeDebugSession;
  return !!session && SUPPORTED_SESSION_TYPES.includes(session.type);
}

// ── Threads ───────────────────────────────────────────────────────────────────

async function getFirstThreadId(): Promise<number> {
  const session = await getSession();
  const resp = await session.customRequest('threads');
  const id = resp?.threads?.[0]?.id;
  if (id === undefined) throw new Error('No threads found in debug session.');
  return id;
}

// ── Call Stack ────────────────────────────────────────────────────────────────

export async function getCallStack(levels = 20): Promise<StackFrame[]> {
  const session = await getSession();
  const threadId = await getFirstThreadId();
  logger.debug(`getCallStack threadId=${threadId} levels=${levels}`);
  const resp = await session.customRequest('stackTrace', {
    threadId,
    startFrame: 0,
    levels
  });
  return resp.stackFrames as StackFrame[];
}

// ── Variables ─────────────────────────────────────────────────────────────────

export async function getScopesForFrame(frameId: number): Promise<Scope[]> {
  const session = await getSession();
  const resp = await session.customRequest('scopes', { frameId });
  return resp.scopes as Scope[];
}

export async function getVariablesForRef(variablesReference: number): Promise<Variable[]> {
  const session = await getSession();
  const resp = await session.customRequest('variables', { variablesReference });
  return resp.variables as Variable[];
}

export async function getVariables(frameIndex = 0): Promise<Record<string, Variable[]>> {
  const stack = await getCallStack();
  if (!stack.length) throw new Error('Call stack is empty — is the target paused?');

  const frame = stack[frameIndex];
  if (!frame) throw new Error(`No frame at index ${frameIndex}. Stack has ${stack.length} frames.`);

  logger.debug(`getVariables frameId=${frame.id} frameName=${frame.name}`);
  const scopes = await getScopesForFrame(frame.id);

  const result: Record<string, Variable[]> = {};
  for (const scope of scopes) {
    if (scope.variablesReference === 0) continue;
    result[scope.name] = await getVariablesForRef(scope.variablesReference);
  }
  return result;
}

export async function expandVariable(
  variablesReference: number
): Promise<Variable[]> {
  if (variablesReference === 0) throw new Error('This variable has no children to expand.');
  return getVariablesForRef(variablesReference);
}

// ── Evaluate ──────────────────────────────────────────────────────────────────

export async function evaluate(
  expression: string,
  frameIndex = 0
): Promise<EvaluateResult> {
  const session = await getSession();
  const stack = await getCallStack();
  const frame = stack[frameIndex];
  if (!frame) throw new Error(`No frame at index ${frameIndex}.`);

  logger.debug(`evaluate expr="${expression}" frameId=${frame.id}`);
  const resp = await session.customRequest('evaluate', {
    expression,
    frameId: frame.id,
    context: 'watch'
  });
  return resp as EvaluateResult;
}

// ── ARM Registers ─────────────────────────────────────────────────────────────

export async function getRegisters(): Promise<Register[]> {
  const session = await getSession();
  logger.debug('getRegisters');
  // Cortex-Debug custom DAP command
  const resp = await session.customRequest('read-registers', { hex: true });
  return resp as Register[];
}

export async function getRegisterList(): Promise<{ number: number; id: number; name: string }[]> {
  const session = await getSession();
  logger.debug('getRegisterList');
  const resp = await session.customRequest('read-register-list');
  return resp;
}

// ── Memory ────────────────────────────────────────────────────────────────────

export async function readMemory(
  address: string,
  length: number
): Promise<MemoryReadResult> {
  const session = await getSession();
  logger.debug(`readMemory addr=${address} len=${length}`);
  // Cortex-Debug custom DAP command
  const resp = await session.customRequest('read-memory', { address, length });

  // Cortex-Debug 1.x returns an array of numbers directly
  // Cortex-Debug 2.x / some builds return { startAddress, data: number[] }
  let bytes: number[] = [];
  if (Array.isArray(resp)) {
    bytes = resp as number[];
  } else if (resp && typeof resp === 'object') {
    const data = (resp as Record<string, unknown>).data;
    if (Array.isArray(data)) {
      bytes = data as number[];
    } else if (typeof data === 'string') {
      // hex string like "aabbccdd..."
      const hex = (data as string).replace(/\s/g, '');
      for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substring(i, i + 2), 16));
      }
    }
  }
  logger.debug(`readMemory resp type=${Array.isArray(resp) ? 'array' : typeof resp} bytes=${bytes.length}`);

  const hexStr = bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
  return { address, data: hexStr, bytes };
}

// ── Execution Control ─────────────────────────────────────────────────────────

export async function pauseExecution(): Promise<void> {
  const session = await getSession();
  const threadId = await getFirstThreadId();
  logger.debug(`pause threadId=${threadId}`);
  await session.customRequest('pause', { threadId });
}

export async function continueExecution(): Promise<void> {
  const session = await getSession();
  const threadId = await getFirstThreadId();
  logger.debug(`continue threadId=${threadId}`);
  await session.customRequest('continue', { threadId });
}

export async function stepOver(): Promise<void> {
  const session = await getSession();
  const threadId = await getFirstThreadId();
  logger.debug(`next (stepOver) threadId=${threadId}`);
  await session.customRequest('next', { threadId });
}

export async function stepInto(): Promise<void> {
  const session = await getSession();
  const threadId = await getFirstThreadId();
  logger.debug(`stepIn threadId=${threadId}`);
  await session.customRequest('stepIn', { threadId });
}

export async function stepOut(): Promise<void> {
  const session = await getSession();
  const threadId = await getFirstThreadId();
  logger.debug(`stepOut threadId=${threadId}`);
  await session.customRequest('stepOut', { threadId });
}

// ── Breakpoints ───────────────────────────────────────────────────────────────

// Track active breakpoints per file so add/remove work correctly
// (DAP setBreakpoints replaces the entire list for a file)
const breakpointMap = new Map<string, Set<number>>();

export function clearBreakpointCache(filePath?: string): void {
  if (filePath) {
    breakpointMap.delete(filePath);
    logger.debug(`clearBreakpointCache ${filePath}`);
    return;
  }
  breakpointMap.clear();
  logger.debug('clearBreakpointCache (all files)');
}

export async function setBreakpoint(
  filePath: string,
  line: number
): Promise<unknown> {
  const session = await getSession();
  if (!breakpointMap.has(filePath)) breakpointMap.set(filePath, new Set());
  breakpointMap.get(filePath)!.add(line);
  const lines = Array.from(breakpointMap.get(filePath)!);
  logger.debug(`setBreakpoint ${filePath}:${line} — active lines: [${lines}]`);
  return session.customRequest('setBreakpoints', {
    source: { path: filePath },
    breakpoints: lines.map(l => ({ line: l }))
  });
}

export async function removeBreakpoint(
  filePath: string,
  line: number
): Promise<unknown> {
  const session = await getSession();
  const lines = breakpointMap.get(filePath);
  if (lines) {
    lines.delete(line);
    if (lines.size === 0) breakpointMap.delete(filePath);
  }
  const remaining = lines ? Array.from(lines) : [];
  logger.debug(`removeBreakpoint ${filePath}:${line} — remaining: [${remaining}]`);
  return session.customRequest('setBreakpoints', {
    source: { path: filePath },
    breakpoints: remaining.map(l => ({ line: l }))
  });
}

export async function clearBreakpoints(filePath?: string): Promise<void> {
  const session = await getSession();
  if (filePath) {
    clearBreakpointCache(filePath);
    await session.customRequest('setBreakpoints', {
      source: { path: filePath },
      breakpoints: []
    });
    logger.debug(`clearBreakpoints ${filePath}`);
  } else {
    for (const [fp] of breakpointMap) {
      await session.customRequest('setBreakpoints', {
        source: { path: fp },
        breakpoints: []
      });
    }
    clearBreakpointCache();
    logger.debug('clearBreakpoints (all files)');
  }
}

export async function cleanDebugState(): Promise<{ hadSession: boolean; gdbDeleteIssued: boolean }> {
  const session = vscode.debug.activeDebugSession;
  const hasSupportedSession = !!session && SUPPORTED_SESSION_TYPES.includes(session.type);

  // Always drop MCP-side cached breakpoints so stale entries are never replayed.
  clearBreakpointCache();

  if (!hasSupportedSession) {
    return { hadSession: false, gdbDeleteIssued: false };
  }

  await session.customRequest('execute-command', { command: 'delete breakpoints' });
  return { hadSession: true, gdbDeleteIssued: true };
}

// ── GDB / MI command passthrough ──────────────────────────────────────────────

const BLOCKED_GDB_COMMANDS = ['quit', 'kill', '-gdb-exit', 'detach'];

export async function executeGdbCommand(command: string): Promise<unknown> {
  const trimmed = command.trim().toLowerCase();
  for (const blocked of BLOCKED_GDB_COMMANDS) {
    if (trimmed === blocked || trimmed.startsWith(blocked + ' ')) {
      throw new Error(`GDB command '${command}' is blocked for safety.`);
    }
  }
  const session = await getSession();
  logger.debug(`executeGdbCommand: ${command}`);
  // Cortex-Debug custom command — runs raw GDB MI command
  return session.customRequest('execute-command', { command });
}
