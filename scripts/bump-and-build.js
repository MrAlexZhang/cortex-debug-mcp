#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = 'D:/Projetos/Projetos_2026/Prototipos/Teste_placa_ECU/Embedded_AI_Debug';

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  let filePath = '';
  try { filePath = JSON.parse(input).tool_input?.file_path ?? ''; } catch {}

  if (!filePath.replace(/\\/g, '/').includes('Embedded_AI_Debug/src/')) process.exit(0);

  const pkgPath = path.join(DIR, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const parts = pkg.version.split('.');
  parts[2] = parseInt(parts[2]) + 1;
  pkg.version = parts.join('.');
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Version bumped to ${pkg.version}`);

  try {
    execSync('npm run build', { cwd: DIR, stdio: 'inherit' });
    execSync('npx @vscode/vsce package', { cwd: DIR, stdio: 'inherit' });
  } catch (e) {
    console.error('Build/package failed:', e.message);
    process.exit(1);
  }
});
