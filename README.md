# Cortex Debug MCP

VS Code extension for exposing **Cortex-Debug / PlatformIO** debug capabilities to MCP clients through **stdio**.

## MCP client configuration

If you use VS Code User `mcp.json` (`C:\Users\<user>\AppData\Roaming\Code\User\mcp.json`), a recommended version-independent config is:

```json
{
  "servers": {
    "cortex-debug-mcp": {
      "type": "stdio",
      "command": "powershell",
      "args": [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$root = Join-Path $env:USERPROFILE '.vscode\\extensions'; $ext = Get-ChildItem $root -Directory | Where-Object { $_.Name -like 'yuelongzhang.cortex-debug-mcp-*' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $ext) { throw 'cortex-debug-mcp extension not found' }; node (Join-Path $ext.FullName 'dist\\stdioProxy.js')"
      ]
    }
  }
}
```

This avoids editing the config every time the extension version changes.

## Upstream and secondary development

This project is open source at:

- https://github.com/MrAlexZhang/cortex-debug-mcp

This project is a secondary development project.
Based on the upstream project:

- https://github.com/paulopalaoro/cortex-mcp-bridge

Main changes in this fork:

1. External MCP access changed from **SSE** to **stdio**
2. Removed automatic `.mcp.json` creation/update
3. Renamed extension identity to **`cortex-debug-mcp`**
4. Renamed command IDs, config keys, output channel, and backend state file to avoid conflict with the upstream plugin
5. Auto-start semantics simplified: backend now starts by default on extension activation/debug session when `cortexDebugMcp.autoStart=true`, and the first-run permission dialog was removed
6. Improved `arm-none-eabi-nm` discovery for `get_symbols`: removed user-specific hardcoded path, added environment variable override, dynamic Windows toolchain scan, and PATH fallback
7. Updated publisher/author information for this fork
8. Added MCP tools `start_debug_session` and `stop_debug_session` to control supported debug sessions from MCP clients
9. Added `cortexDebugMcp.autoManageDebugSession` setting (default `false`): MCP can auto-start a supported debug session when tools require one
10. Added managed-session lifecycle: sessions started by MCP can be auto-stopped when bridge stops or extension deactivates
11. Added `Cortex Debug MCP: Clean Debug State` command to clear MCP breakpoint cache and issue GDB `delete breakpoints` when supported session is active
12. Status bar action changed to `MCP Clear` for quick debug-state cleanup
13. Improved breakpoint cache behavior: cache is auto-cleared on supported debug session termination to avoid stale replay
14. Updated session guidance message to include manual start, `start_debug_session`, or `autoManageDebugSession` options

## How to use

1. Install the `.vsix`
2. The backend usually starts automatically (`cortexDebugMcp.autoStart=true` by default). If needed, run `Cortex Debug MCP: Start Bridge Server` manually
3. Restart or reload your MCP client
4. If no debug session is running, call `start_debug_session` (optionally pass `launchName`)
5. Call tools such as `get_session_info`, `get_variables`, `set_breakpoint`, `remove_breakpoint`, `step`, `gdb_command`
6. When done, call `stop_debug_session`

## Debug session control mode

- Default (manual): `cortexDebugMcp.autoManageDebugSession=false`
  - Keep current behavior. You start/stop debug sessions manually (or with `start_debug_session` / `stop_debug_session`).
- Auto mode: set `cortexDebugMcp.autoManageDebugSession=true`
  - When a DAP tool is called and no supported session exists, MCP auto-starts one from `launch.json`.
  - When the MCP bridge is stopped, sessions started by MCP are auto-stopped.

## Breakpoint/watchpoint cleanup behavior

- On supported debug session termination, MCP automatically clears its internal breakpoint cache.
- To manually clean debug state from VS Code, run `Cortex Debug MCP: Clean Debug State` from Command Palette.

## What it can do

Current MCP tools mainly cover:

- start/stop debug session (`start_debug_session`, `stop_debug_session`)
- session status and call stack
- variables, registers, memory, expression evaluation
- set/remove breakpoints
- pause / continue / step
- raw `gdb_command`
- OpenOCD-based live memory and peripheral tools

VS Code command palette also provides:

- `Cortex Debug MCP: Clean Debug State`
  - Clears MCP internal breakpoint cache
  - If a supported debug session is active, also runs GDB `delete breakpoints` (clears breakpoints + watchpoints)

Status bar quick action:

- `MCP Clear` button (left status bar)
  - Click to run the same debug-state cleanup action quickly

## Install from VSIX

If you start from this source repository, build, package, and install it from the repository root:

```bash
npm install
npm run build
npm run package
code --install-extension cortex-debug-mcp-1.4.0.vsix
```

If `node_modules` already exists from a previous install, you usually only need:

```bash
npm run build
npm run package
code --install-extension cortex-debug-mcp-1.4.0.vsix
```

The generated VSIX file name follows the extension version in `package.json`. If you change the version, replace `cortex-debug-mcp-1.4.0.vsix` with the new file name.

```bash
code --install-extension cortex-debug-mcp-<version>.vsix
```

## Limitations

- Most DAP read operations require the target to be **paused**
- `get_registers` and `get_memory` depend on Cortex-Debug custom DAP requests
- OpenOCD-based tools such as `get_chip_info`, `read_live_memory`, and peripheral helpers may fail in **J-Link-only** sessions
- `gdb_command` can be used as an escape hatch for reset / monitor commands

## License

MIT
