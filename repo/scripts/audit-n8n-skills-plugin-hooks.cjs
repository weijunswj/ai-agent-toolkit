#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function normalizeRelPath(relPath) {
  return relPath.replace(/\\/g, '/');
}

function readJsonFile(filePath, errors, relPath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    errors.push(`${normalizeRelPath(relPath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function collectHookCommands(hooksJson) {
  const commands = [];

  function visit(value, pathParts) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...pathParts, String(index)]));
      return;
    }
    if (!value || typeof value !== 'object') return;

    if (value.type === 'command' && typeof value.command === 'string') {
      commands.push({
        path: pathParts.join('.'),
        command: value.command
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'command') continue;
      visit(child, [...pathParts, key]);
    }
  }

  visit(hooksJson, ['hooks.json']);
  return commands;
}

function stripOuterQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function firstCommandToken(command) {
  const trimmed = command.trim();
  const match = trimmed.match(/^"([^"]+)"|^'([^']+)'|^([^\s]+)/);
  return match ? (match[1] || match[2] || match[3]) : '';
}

function directlyInvokesShellScript(command) {
  const token = stripOuterQuotes(firstCommandToken(command));
  return /\.sh$/i.test(token);
}

function unsafeWindowsBashLauncher(command) {
  const token = stripOuterQuotes(firstCommandToken(command));
  const normalizedToken = normalizeRelPath(token).toLowerCase();

  if (normalizedToken === 'bash' || normalizedToken === 'bash.exe') {
    return 'bare bash may resolve to the WSL bash launcher on Windows';
  }

  if (/^[a-z]:\/windows\/system32\/bash\.exe$/.test(normalizedToken)) {
    return 'C:\\WINDOWS\\system32\\bash.exe is the WSL bash launcher';
  }

  return null;
}

function shellScriptCommandRefs(command) {
  const refs = [];
  const scriptRefPattern = /(?:"([^"]+?\.sh)"|'([^']+?\.sh)'|([^\s"']+?\.sh))(?=$|[\s"'])/gi;
  let match;

  while ((match = scriptRefPattern.exec(command)) !== null) {
    const rawRef = match[1] || match[2] || match[3];
    const relPath = shellScriptRefToPluginRelPath(rawRef);
    if (relPath) refs.push(relPath);
  }

  return refs;
}

function shellScriptRefToPluginRelPath(rawRef) {
  let ref = normalizeRelPath(stripOuterQuotes(rawRef).trim()).replace(/^\.\//, '');
  const pluginRootMatch = ref.match(/^\$\{CLAUDE_PLUGIN_ROOT\}\/+(.+)$/i);
  if (pluginRootMatch) return normalizeRelPath(pluginRootMatch[1]);

  if (/^[A-Za-z]:\//.test(ref) || ref.startsWith('/')) return null;

  if (!ref.startsWith('hooks/')) ref = `hooks/${ref}`;
  return normalizeRelPath(ref);
}

function hasNodeJsonFallback(text) {
  return (
    /command\s+-v\s+node\b/.test(text) &&
    /JSON\.stringify/.test(text) &&
    /hookSpecificOutput/.test(text)
  );
}

function shouldRequireNodeJsonFallback(relPath, text) {
  return (
    relPath === 'hooks/session-start.sh' ||
    relPath === 'hooks/pre-tool-use/_emit.sh' ||
    /hookSpecificOutput|command\s+-v\s+jq\b|command\s+-v\s+python3\b/.test(text)
  );
}

function auditPluginRoot(pluginRoot, options = {}) {
  const errors = [];
  const windowsMode = Boolean(options.windows);
  const pluginJsonPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
  const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');

  if (fs.existsSync(pluginJsonPath)) {
    readJsonFile(pluginJsonPath, errors, '.codex-plugin/plugin.json');
  }

  if (!fs.existsSync(hooksJsonPath)) {
    errors.push('hooks/hooks.json is missing');
    return errors;
  }

  const hooksJson = readJsonFile(hooksJsonPath, errors, 'hooks/hooks.json');
  if (!hooksJson) return errors;

  const commands = collectHookCommands(hooksJson);
  const referencedShellScripts = new Set();

  for (const entry of commands) {
    for (const shellScriptRel of shellScriptCommandRefs(entry.command)) {
      referencedShellScripts.add(shellScriptRel);
    }

    if (windowsMode && directlyInvokesShellScript(entry.command)) {
      errors.push(
        `${entry.path} directly invokes a .sh file without an interpreter on Windows: ${entry.command}`
      );
    }

    const unsafeBashReason = windowsMode ? unsafeWindowsBashLauncher(entry.command) : null;
    if (unsafeBashReason) {
      errors.push(
        `${entry.path} uses an unsafe WSL bash launcher on Windows: ${entry.command} (${unsafeBashReason})`
      );
    }
  }

  for (const relPath of [
    'hooks/session-start.sh',
    'hooks/pre-tool-use/_emit.sh',
    ...referencedShellScripts
  ]) {
    const normalizedRelPath = normalizeRelPath(relPath);
    const scriptPath = path.join(pluginRoot, ...normalizedRelPath.split('/'));
    if (!fs.existsSync(scriptPath)) {
      if (referencedShellScripts.has(normalizedRelPath)) {
        errors.push(`${normalizedRelPath} is referenced by hooks/hooks.json but does not exist`);
      }
      continue;
    }
    const text = fs.readFileSync(scriptPath, 'utf8');
    if (shouldRequireNodeJsonFallback(normalizedRelPath, text) && !hasNodeJsonFallback(text)) {
      errors.push(
        `${normalizedRelPath} must include a Node JSON fallback so hooks still emit valid JSON when jq and python3 are unavailable`
      );
    }
  }

  return [...new Set(errors)];
}

function defaultCodexPluginRoot() {
  const home = os.homedir();
  const base = path.join(home, '.codex', 'plugins', 'cache', 'n8n-io', 'n8n-skills');
  if (!fs.existsSync(base)) return null;

  const versions = fs.readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const latest = versions.at(-1);
  return latest ? path.join(base, latest) : null;
}

function parseArgs(argv) {
  const options = {
    pluginRoot: process.env.N8N_SKILLS_PLUGIN_ROOT || null,
    windows: process.platform === 'win32'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plugin-root') {
      options.pluginRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--windows') {
      options.windows = true;
    } else if (arg === '--no-windows') {
      options.windows = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (!options.pluginRoot) {
      options.pluginRoot = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: node repo/scripts/audit-n8n-skills-plugin-hooks.cjs --plugin-root <path> [--windows]',
    '',
    'Audits an installed official n8n Skills plugin folder for hook portability.',
    'Without --plugin-root, the script tries the latest Codex n8n-skills cache under the current user profile.'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  const pluginRoot = options.pluginRoot || defaultCodexPluginRoot();
  if (!pluginRoot) {
    console.error('No n8n-skills plugin root found. Pass --plugin-root <path>.');
    return 2;
  }
  if (!fs.existsSync(pluginRoot)) {
    console.error(`Plugin root does not exist: ${pluginRoot}`);
    return 2;
  }

  const errors = auditPluginRoot(pluginRoot, { windows: options.windows });
  if (errors.length > 0) {
    for (const error of errors) console.error(`FAIL: ${error}`);
    return 1;
  }

  console.log(`OK: n8n Skills plugin hook metadata is portable for ${options.windows ? 'Windows' : 'this platform'}: ${pluginRoot}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  auditPluginRoot,
  collectHookCommands,
  directlyInvokesShellScript,
  unsafeWindowsBashLauncher,
  shellScriptCommandRefs,
  hasNodeJsonFallback,
  shouldRequireNodeJsonFallback
};
