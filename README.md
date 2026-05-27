# Cortex Debug MCP

VS Code extension for exposing **Cortex-Debug / PlatformIO** debug capabilities to MCP clients through **stdio**.

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

## What it can do

Current MCP tools mainly cover:

- session status and call stack
- variables, registers, memory, expression evaluation
- set/remove breakpoints
- pause / continue / step
- raw `gdb_command`
- OpenOCD-based live memory and peripheral tools

## Install from VSIX

If you start from this source repository, build, package, and install it from the repository root:

```bash
npm install
npm run build
npm run package
code --install-extension cortex-debug-mcp-1.3.0.vsix
```

If `node_modules` already exists from a previous install, you usually only need:

```bash
npm run build
npm run package
code --install-extension cortex-debug-mcp-1.3.0.vsix
```

The generated VSIX file name follows the extension version in `package.json`. If you change the version, replace `cortex-debug-mcp-1.3.0.vsix` with the new file name.

```bash
code --install-extension cortex-debug-mcp-<version>.vsix
```

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

## How to use

1. Install the `.vsix`
2. Start a **Cortex-Debug** or **PlatformIO** debug session in VS Code
3. The backend usually starts automatically (`cortexDebugMcp.autoStart=true` by default). If needed, run `Cortex Debug MCP: Start Bridge Server` manually
4. Restart or reload your MCP client
5. Call tools such as `get_session_info`, `get_variables`, `set_breakpoint`, `remove_breakpoint`, `step`, `gdb_command`


## Limitations

- Most DAP read operations require the target to be **paused**
- `get_registers` and `get_memory` depend on Cortex-Debug custom DAP requests
- OpenOCD-based tools such as `get_chip_info`, `read_live_memory`, and peripheral helpers may fail in **J-Link-only** sessions
- `gdb_command` can be used as an escape hatch for reset / monitor commands

## License

MIT
