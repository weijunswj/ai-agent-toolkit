'use strict';

const { sha256 } = require('./toolkit-guardrail-policy.cjs');
const { resolveTargets } = require('./toolkit-active-repository.cjs');

const CLASS_DECISION_RANK = Object.freeze({ allow: 0, ask: 1, unsupported: 2, deny: 3 });
const SHELL_NAMES = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'cmd', 'cmd.exe']);
const READ_COMMANDS = new Set(['get-content', 'get-childitem', 'dir', 'ls', 'find', 'grep', 'rg', 'sed', 'awk', 'cat', 'type', 'more', 'head', 'tail', 'pwd', 'where', 'findstr']);
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'rd', 'rmdir.exe', 'rd.exe', 'del', 'erase', 'remove-item']);
const MOVE_COMMANDS = new Set(['mv', 'move', 'move-item', 'ren', 'rename', 'rename-item']);
const COPY_COMMANDS = new Set(['cp', 'copy', 'copy-item', 'install']);
const CREATE_COMMANDS = new Set(['touch', 'mkdir', 'md', 'new-item', 'tee']);
const WRITE_COMMANDS = new Set(['set-content', 'out-file', 'add-content', 'echo', 'printf', 'set']);
const SECRET_READ_COMMANDS = new Set([...READ_COMMANDS]);
const NETWORK_COMMANDS = new Set(['curl', 'curl.exe', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'scp', 'ftp', 'ssh']);

function lower(value) {
  return String(value || '').toLowerCase();
}

function isWindowsShell(shell) {
  return ['cmd', 'cmd.exe', 'powershell', 'pwsh'].includes(lower(shell));
}

function escapeCharacter(shell) {
  const name = lower(shell);
  if (name === 'powershell' || name === 'pwsh') return '`';
  if (name === 'cmd' || name === 'cmd.exe') return '^';
  return '\\';
}

function shouldEscape(command, index, shell, quote) {
  const char = command[index];
  const escape = escapeCharacter(shell);
  if (char !== escape) return false;
  if (escape === '\\' && quote === '"') return false;
  return true;
}

function splitTopLevel(command, shell = 'posix') {
  const parts = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (shouldEscape(command, index, shell, quote)) {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
      current += char;
      continue;
    }
    if (!quote && (char === ';' || char === '\n' || char === '|')) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      if (char === '|' && next === '|') index += 1;
      continue;
    }
    if (!quote && char === '&') {
      if (current.trim()) parts.push(current.trim());
      current = '';
      if (next === '&') index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function hasTopLevelSingleAmpersand(command, shell = 'posix') {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (shouldEscape(command, index, shell, quote)) {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
      continue;
    }
    if (!quote && char === '&' && next !== '&') return true;
    if (!quote && char === '&' && next === '&') index += 1;
  }
  return false;
}

function hasUnclosedQuote(command, shell = 'posix') {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (shouldEscape(command, index, shell, quote)) {
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) quote = quote === null ? char : null;
  }
  return quote !== null;
}

function tokenize(command, shell = 'posix') {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  const push = () => {
    if (current) tokens.push(current);
    current = '';
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (shouldEscape(command, index, shell, quote)) {
      const next = command[index + 1];
      const escape = escapeCharacter(shell);
      if (next && (escape !== '\\' || /[\s|;&$`"'\\]/.test(next))) {
        escaped = true;
        continue;
      }
      current += char;
      continue;
    }
    if ((char === '"' || char === "'") && (quote === null || quote === char)) {
      quote = quote === null ? char : null;
      continue;
    }
    if (!quote && /\s/.test(char)) {
      push();
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

function commandName(tokens) {
  let index = 0;
  while (index < tokens.length && (
    /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])
    || tokens[index] === 'sudo'
    || (tokens[index] === 'env' && index < tokens.length - 1)
  )) index += 1;
  return lower(tokens[index] || '').replace(/^.*[\\/]/, '');
}

function isOption(token, shell = 'posix') {
  if (typeof token !== 'string') return false;
  if (token.startsWith('-')) return true;
  return lower(shell) === 'cmd' || lower(shell) === 'cmd.exe'
    ? /^\/[A-Za-z][A-Za-z0-9_-]*$/.test(token)
    : false;
}

function pathLike(token, shell = 'posix') {
  if (!token || isOption(token, shell)) return false;
  if (token === '.' || token === '..' || token.startsWith('./') || token.startsWith('../') || token.startsWith('.\\') || token.startsWith('..\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith('/') || token.startsWith('\\\\')) return true;
  return /[\\/]/.test(token) || /\.(?:md|json|js|cjs|mjs|ts|txt|log|env|key|pem|sh|ps1|cmd|bat|py)$/i.test(token) || /^\.env(?:\.|$)/i.test(token);
}

function extractPathTokens(tokens, start = 1, options = {}) {
  const paths = [];
  const shell = options.shell || 'posix';
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isOption(token, shell)) {
      if (['-path', '--path', '-literalpath', '--literal-path', '-destination', '--destination', '-source', '--source', '--output', '-o', '/path', '/d'].includes(lower(token))) {
        const value = tokens[index + 1];
        if (value && !isOption(value, shell)) paths.push({ path: value, kind: 'command-target' });
        index += 1;
      }
      continue;
    }
    if (pathLike(token, shell) || options.all_positionals === true) paths.push({ path: token, kind: 'command-target' });
  }
  return paths;
}

function redirectionTargets(command) {
  const result = [];
  const pattern = /(?:^|\s)(?:\d{0,2})(>>|>)(?:\s*)("[^"]+"|'[^']+'|[^\s|;&]+)/g;
  let match;
  while ((match = pattern.exec(command))) result.push({ path: match[2].replace(/^['"]|['"]$/g, ''), kind: match[1] === '>>' ? 'append-redirection' : 'redirection' });
  return result;
}

function hasNestedShell(tokens, shell) {
  const name = commandName(tokens);
  const shellName = lower(shell);
  if (SHELL_NAMES.has(name)) return tokens.some((token) => ['-c', '-command', '/c', '/k'].includes(lower(token)));
  return shellName === 'powershell' && tokens.some((token) => lower(token) === '-command');
}

function commonResult(operationClass, decisionHint, targets = [], extras = {}) {
  return {
    operation_class: operationClass,
    mutation_class: operationClass,
    decision_hint: decisionHint,
    target_inputs: targets,
    external_targets: [],
    reason_codes: [],
    compound: false,
    pipeline: false,
    redirection: false,
    nested: false,
    opaque: false,
    ...extras,
  };
}

function isSecretPath(value) {
  return /(?:^|[\\/])(?:\.env[^\\/]*|\.ssh(?:[\\/]|$)|\.aws(?:[\\/]credentials)?(?:[\\/]|$)|\.gnupg(?:[\\/]|$)|credentials(?:\.[^\\/]*)?|(?:id_rsa|id_ed25519|private[_-]?key)(?:\.[^\\/]*)?)(?:[\\/]|$)/i.test(String(value || ''))
    || /^(?:\.env[^\\/]*|credentials(?:\.[^\\/]*)?)$/i.test(String(value || ''))
    || /(?:^|[\\/])(?:shadow|gshadow|SAM|SECURITY)(?:$|[\\/])/i.test(String(value || ''));
}

function isBulkSecretPath(value) {
  const text = String(value || '');
  return /[*?\[\]]/.test(text)
    || /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg)(?:[\\/]*$)/i.test(text)
    || /(?:^|[\\/])(?:credentials|private[_-]?key)(?:[\\/]*)$/i.test(text)
    || /(?:^|[\\/])(?:shadow|gshadow|SAM|SECURITY)(?:$|[\\/])/i.test(text);
}

function isSecretVariableReference(value) {
  const text = String(value || '');
  return /^(?:env:|\$env:)[A-Za-z_][A-Za-z0-9_]*$/i.test(text)
    || /^%[A-Za-z_][A-Za-z0-9_]*%$/i.test(text);
}

function secretDumpCommand(name, command) {
  return ['printenv', 'env', 'set'].includes(name)
    || /(?:get-childitem|get-item|dir|ls|gci)\s+(?:-[^\s]+\s+)*env:/i.test(command)
    || /(?:cat|type|get-content|more|head|tail)\s+[^\n]*(?:\.env[^\s\\/]*\*|\.ssh[\\/]*$|\.aws[\\/]*$|\.gnupg[\\/]*$)/i.test(command);
}

function secretVariableName(name, tokens) {
  const variableToken = tokens.length === 2 ? tokens[1] : null;
  if (name === 'printenv' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(variableToken || '')) return variableToken;
  if (
    ['echo', 'write-output', 'printf'].includes(name)
    && /^(?:\$[A-Za-z_][A-Za-z0-9_]*|\$env:[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/iu.test(variableToken || '')
  ) {
    return String(variableToken).replace(/^\$env:/i, '').replace(/^[\$%]/, '').replace(/%$/, '');
  }
  if (['get-item', 'get-content'].includes(name)) {
    const candidate = tokens[1] === '-path' || tokens[1] === '-literalpath' ? tokens[2] : tokens[1];
    const match = /^env:([A-Za-z_][A-Za-z0-9_]*)$/i.exec(candidate || '');
    if (match) return match[1];
  }
  return null;
}

function secretVariableTarget(name) {
  return {
    raw_path: 'env:' + name,
    lexical_path: null,
    canonical_path: null,
    status: 'resolved',
    target_class: 'secret-bearing',
    link_type: 'none',
    resolved_inside: false,
    approved_root: null,
    evidence: { status: 'trusted', source: 'operation-variable' },
  };
}

function catastrophicPath(value) {
  const raw = String(value || '');
  if (raw === '/' || /^[A-Za-z]:[\\/]?$/.test(raw)) return true;
  const text = raw.replace(/[\\/]$/, '');
  if (/(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|credentials)$/i.test(text)) return true;
  return /^(?:[A-Za-z]:[\\/](?:Windows|Program Files|ProgramData|System32)|[\\/](?:etc|sys|boot|root|var[\\/]lib))(?:[\\/]|$)/i.test(`${text}\\`);
}

function classifyGithub(tokens) {
  const kind = lower(tokens[1] || '');
  const subcommand = lower(tokens[2] || '');
  const external = [{ class: 'github', digest: sha256({ kind, subcommand }) }];
  const readActions = new Set(['view', 'list', 'status', 'checks', 'diff', 'show', 'watch']);
  if (kind === 'api') {
    const methodIndex = tokens.findIndex((token) => ['-x', '--method'].includes(lower(token)));
    const method = methodIndex >= 0 ? lower(tokens[methodIndex + 1]) : null;
    if (method === 'get') return commonResult('github-read', 'allow', [], { external_targets: external, reason_codes: ['ROUTINE_GITHUB_READ'] });
    return commonResult('github-repository-workflow-mutation', method ? 'ask' : 'unsupported', [], { external_targets: external, opaque: !method, reason_codes: [method ? 'EXTERNAL_MUTATION_REQUIRES_APPROVAL' : 'UNSUPPORTED_ROUTE'] });
  }
  if (kind === 'pr' && subcommand === 'review') return commonResult('github-review-mutation', 'ask', [], { external_targets: external, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  if ((kind === 'issue' || kind === 'pr') && readActions.has(subcommand)) return commonResult('github-read', 'allow', [], { external_targets: external, reason_codes: ['ROUTINE_GITHUB_READ'] });
  if (kind === 'repo' && readActions.has(subcommand)) return commonResult('github-read', 'allow', [], { external_targets: external, reason_codes: ['ROUTINE_GITHUB_READ'] });
  if (kind === 'run' && readActions.has(subcommand)) return commonResult('github-read', 'allow', [], { external_targets: external, reason_codes: ['ROUTINE_GITHUB_READ'] });
  if (kind === 'issue') return commonResult('github-issue-mutation', 'ask', [], { external_targets: external, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  if (kind === 'pr') return commonResult('github-pr-mutation', 'ask', [], { external_targets: external, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  if (kind === 'review') return commonResult('github-review-mutation', 'ask', [], { external_targets: external, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  if (kind === 'repo' || kind === 'workflow' || kind === 'run') return commonResult('github-repository-workflow-mutation', 'ask', [], { external_targets: external, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  return commonResult('github-repository-workflow-mutation', 'unsupported', [], { external_targets: external, opaque: true, reason_codes: ['UNSUPPORTED_ROUTE'] });
}

function classifyGit(tokens, shell = 'posix') {
  const subcommand = lower(tokens[1] || '');
  if (!subcommand) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  if (['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'branch'].includes(subcommand) && !tokens.some((token) => ['-d', '-D', '--delete'].includes(token))) return commonResult('git-local-read', 'allow', extractPathTokens(tokens, 2, { shell }), { reason_codes: ['ROUTINE_GIT_OPERATION'] });
  if (subcommand === 'add') return commonResult('git-stage', 'allow', extractPathTokens(tokens, 2, { shell }), { reason_codes: ['ROUTINE_GIT_OPERATION'] });
  if (subcommand === 'commit') {
    const destructive = tokens.some((token) => ['--amend', '--no-verify'].includes(lower(token)));
    return commonResult(destructive ? 'git-destructive' : 'git-commit', destructive ? 'ask' : 'allow', [], { reason_codes: [destructive ? 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL' : 'ROUTINE_GIT_OPERATION'] });
  }
  if (subcommand === 'push') {
    const valuedOptions = new Set(['--repo', '--receive-pack', '--exec', '--upload-pack', '--push-option', '-o']);
    const args = [];
    let force = false;
    let deletion = false;
    let special = false;
    let ambiguousOption = false;
    let optionValue = false;
    for (let index = 2; index < tokens.length; index += 1) {
      const token = tokens[index];
      const normalizedToken = lower(token);
      if (optionValue) {
        optionValue = false;
        continue;
      }
      if (token === '--') {
        args.push(...tokens.slice(index + 1));
        break;
      }
      if (normalizedToken === '--force' || normalizedToken === '--force-with-lease' || normalizedToken.startsWith('--force-with-lease=')) force = true;
      if (token.startsWith('+')) force = true;
      if (token.startsWith('-') && !token.startsWith('--') && token.slice(1).toLowerCase().includes('f')) force = true;
      if (normalizedToken === '--delete' || normalizedToken === '-d' || (token.startsWith('-') && !token.startsWith('--') && token.slice(1).includes('d'))) deletion = true;
      if (normalizedToken === '--tags' || normalizedToken === '--all' || normalizedToken === '--mirror') special = true;
      if (normalizedToken === '--repo' || normalizedToken.startsWith('--repo=')) ambiguousOption = true;
      if (token.startsWith('--') && valuedOptions.has(normalizedToken)) {
        ambiguousOption = true;
        optionValue = true;
      } else if (token.startsWith('--') && valuedOptions.has(normalizedToken.split('=', 1)[0])) {
        ambiguousOption = true;
        optionValue = !token.includes('=');
      }
      else if (token.startsWith('-') && !token.startsWith('--')) {
        const cluster = token.slice(1);
        if (cluster && [...cluster].some((flag) => !'dDfuqv'.includes(flag))) ambiguousOption = true;
      }
      if (!token.startsWith('-')) args.push(token);
    }
    const remote = args[0] || null;
    const refs = args.slice(1);
    const rawRef = refs.length === 1 ? refs[0] : null;
    const refParts = rawRef && rawRef.includes(':') ? rawRef.split(':') : null;
    const rawDestinationRef = rawRef ? (refParts ? refParts[refParts.length - 1] : rawRef) : null;
    const destinationRef = rawDestinationRef ? rawDestinationRef.replace(/^refs\/heads\//i, '') : null;
    const deletionRef = Boolean(refParts && (refParts[refParts.length - 1] === '' || refParts[0] === ''));
    if (refParts && refParts.length !== 2) ambiguousOption = true;
    deletion = deletion || deletionRef;
    const evidenceComplete = Boolean(remote && rawRef && refs.length === 1 && !special && !ambiguousOption);
    const otherTarget = Boolean(remote && remote !== 'origin')
      || special
      || deletion
      || ambiguousOption;
    const push = { remote, refs, force, deletion, other_target: otherTarget, destination_ref: destinationRef, raw_ref: rawRef, evidence_complete: evidenceComplete, ambiguous: ambiguousOption };
    if (force) return commonResult('git-force-push', 'ask', [], { git_push: push, reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
    if (deletion) return commonResult('git-other-target', 'ask', [], { git_push: push, reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
    if (!evidenceComplete) return commonResult('git-push', 'unsupported', [], { git_push: push, reason_codes: ['GIT_PUSH_EVIDENCE_REQUIRED'] });
    if (otherTarget) return commonResult('git-other-target', 'ask', [], { git_push: push, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
    return commonResult('git-push', 'allow', [], { git_push: push, reason_codes: ['AUTHORISED_NORMAL_PUSH'] });
  }
  if (subcommand === 'reset' && tokens.some((token) => lower(token) === '--hard')) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (['clean', 'rebase', 'filter-branch', 'filter-repo'].includes(subcommand)) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'restore' || (subcommand === 'checkout' && tokens.some((token) => token === '--'))) return commonResult('git-destructive', 'ask', extractPathTokens(tokens, 2, { shell }), { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'branch' && tokens.some((token) => ['-d', '-D', '--delete'].includes(token))) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'tag' && tokens.some((token) => ['-d', '--delete'].includes(token))) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (['remote', 'config', 'clone', 'fetch', 'pull', 'submodule'].includes(subcommand)) return commonResult('external-mutation', 'ask', [], { external_targets: [{ class: 'git-remote', digest: sha256({ subcommand }) }], reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  return commonResult('opaque-command', 'unsupported', extractPathTokens(tokens, 2, { shell }), { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
}

function hasDynamicExpansion(command) {
  return /\$\(|`[^`]*`|\$\{[^}]+\}|\$env:[A-Za-z_][A-Za-z0-9_]*|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|[*?\[\]]/.test(command)
    || /(?:^|\s)&\s*[A-Za-z]/.test(command);
}

function classifyAtomic(command, shell) {
  const tokens = tokenize(command, shell);
  const name = commandName(tokens);
  const normalized = lower(command);
  const allPositionalTargets = new Set([
    ...DELETE_COMMANDS,
    ...MOVE_COMMANDS,
    ...COPY_COMMANDS,
    ...CREATE_COMMANDS,
    'cat',
    'type',
    'more',
    'head',
    'tail',
    'get-content',
    'get-childitem',
    'dir',
    'ls',
    'findstr',
  ]);
  const targets = extractPathTokens(tokens, 1, { all_positionals: allPositionalTargets.has(name), shell });
  const secretTargets = targets.filter((entry) => isSecretPath(entry.path));
  const catastrophicTargets = targets.filter((entry) => catastrophicPath(entry.path));

  if (/(dangerously[-_]?skip[-_]?permissions|bypass[-_]?permissions|disable[^\n]*(?:hook|guardrail|sandbox|trust)|(?:--no-verify|--no-hooks)|always\s+allow|auto[-_]?approve|force[_ -]?ask)/i.test(command)) return commonResult('guardrail-bypass', 'deny', [], { reason_codes: ['GUARDRAIL_BYPASS_DENIED'] });
  const secretVariable = secretVariableName(name, tokens);
  if (secretVariable) return commonResult('secret-access', 'ask', [{ path: 'env:' + secretVariable, kind: 'secret-variable' }], { secret_target: true, reason_codes: ['SECRET_ACCESS_REQUIRES_APPROVAL'] });
  if (secretDumpCommand(name, command)) return commonResult('secret-dump', 'deny', secretTargets, { secret_target: true, reason_codes: ['SECRET_DUMP_DENIED'] });
  if (hasDynamicExpansion(command)) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['DYNAMIC_TARGET_UNSUPPORTED'] });
  if (hasUnclosedQuote(command, shell)) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  if (name === 'gh') return classifyGithub(tokens);
  if (name === 'git') return classifyGit(tokens, shell);
  if (SHELL_NAMES.has(name) && hasNestedShell(tokens, shell)) return commonResult('opaque-command', 'unsupported', [], { nested: true, opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  if (['node', 'node.exe', 'python', 'python3', 'pwsh', 'powershell', 'cmd', 'cmd.exe'].includes(name) && tokens.slice(1).some((token) => /\.(?:cjs|js|mjs|py|ps1|sh|bat|cmd)$/i.test(token))) return commonResult('opaque-command', 'unsupported', extractPathTokens(tokens, 1, { shell }), { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });

  if (secretTargets.length && (NETWORK_COMMANDS.has(name) || /(?:base64|convertto-base64|send|upload|post|put)/i.test(command))) return commonResult('secret-exfiltration', 'deny', secretTargets, { secret_target: true, reason_codes: ['SECRET_EXFILTRATION_DENIED'] });
  if (secretTargets.length && SECRET_READ_COMMANDS.has(name) && secretTargets.length === 1 && !isBulkSecretPath(secretTargets[0].path)) return commonResult('secret-access', 'ask', secretTargets, { secret_target: true, reason_codes: ['SECRET_ACCESS_REQUIRES_APPROVAL'] });
  if (catastrophicTargets.length && (DELETE_COMMANDS.has(name) || /(?:remove|delete|destroy|format|reset)/i.test(command))) return commonResult('protected-target', 'deny', catastrophicTargets, { catastrophic_hint: true, reason_codes: ['CATASTROPHIC_TARGET_DENIED'] });

  if (NETWORK_COMMANDS.has(name)) return commonResult('external-mutation', 'ask', [], { external_targets: [{ class: 'network-or-remote-system', digest: sha256({ name }) }], reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  if (DELETE_COMMANDS.has(name)) return commonResult('delete', 'ask', targets, { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (MOVE_COMMANDS.has(name)) return commonResult('rename', 'allow', targets, { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'] });
  if (COPY_COMMANDS.has(name)) return commonResult('create', 'allow', targets, { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'] });
  if (CREATE_COMMANDS.has(name)) return commonResult('create', 'allow', targets, { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'] });
  if (WRITE_COMMANDS.has(name)) return commonResult('overwrite', 'ask', targets, { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (READ_COMMANDS.has(name)) return commonResult('read', 'allow', targets, { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'] });
  if (name === 'cd' || name === 'pushd' || name === 'popd') return commonResult('read', 'allow', targets, { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'] });
  if (['npm', 'pnpm', 'yarn', 'pip', 'cargo'].includes(name)) {
    const install = tokens.some((token) => ['install', 'add', 'remove', 'uninstall', 'publish', 'update'].includes(lower(token)));
    return commonResult(install ? 'external-mutation' : 'opaque-command', install ? 'ask' : 'unsupported', [], { opaque: !install, reason_codes: [install ? 'EXTERNAL_MUTATION_REQUIRES_APPROVAL' : 'OPAQUE_COMMAND_UNSUPPORTED'] });
  }
  return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
}

function mergeResults(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  const authorityRank = (entry) => {
    const operationClass = entry?.operation_class;
    if (['secret-exfiltration', 'secret-dump', 'guardrail-bypass', 'protected-target', 'catastrophic-target', 'role-boundary-violation'].includes(operationClass)) return 100;
    if (operationClass === 'secret-access') return 80;
    if (operationClass.startsWith('github-')) return 75;
    if (operationClass === 'git-force-push' || operationClass === 'git-destructive' || operationClass === 'delete') return 70;
    if (operationClass === 'external-mutation') return 60;
    return 0;
  };
  let selected = list[0];
  for (const candidate of list.slice(1)) {
    const candidateRank = CLASS_DECISION_RANK[candidate.decision_hint] ?? 2;
    const selectedRank = CLASS_DECISION_RANK[selected.decision_hint] ?? 2;
    if (candidateRank > selectedRank || (candidateRank === selectedRank && authorityRank(candidate) > authorityRank(selected))) selected = candidate;
  }
  const secondaryReasons = [...new Set(list.flatMap((entry) => entry.reason_codes || []).filter((reason) => reason !== selected.reason_codes?.[0]))];
  return {
    ...selected,
    compound: list.length > 1 || Boolean(selected.compound),
    pipeline: Boolean(list.length > 1 && selected.pipeline),
    reason_codes: [selected.reason_codes?.[0] || 'OPAQUE_COMMAND_UNSUPPORTED', ...secondaryReasons],
    target_inputs: list.flatMap((entry) => entry.target_inputs || []),
    external_targets: list.flatMap((entry) => entry.external_targets || []),
    nested: list.some((entry) => entry.nested),
    opaque: list.some((entry) => entry.opaque),
    secret_target: list.some((entry) => entry.secret_target),
    catastrophic_hint: list.some((entry) => entry.catastrophic_hint),
    components: list.map((entry) => ({
      operation_class: entry.operation_class,
      decision_hint: entry.decision_hint,
      reason_code: entry.reason_codes?.[0] || null,
      target_digest: sha256(entry.target_inputs || []),
      external_target_digest: sha256(entry.external_targets || []),
    })),
  };
}

function classifyCommand(command, options = {}) {
  if (typeof command !== 'string' || !command.trim()) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  const shell = options.shell || 'posix';
  const parts = splitTopLevel(command, shell);
  const results = parts.map((part) => classifyAtomic(part, shell));
  const hasPipeline = /(^|[^\\])\|([^|]|$)/.test(command);
  const hasRedirection = /(?:^|\s)\d{0,2}(?:>>|>)/.test(command);
  const hasSingleAmpersand = hasTopLevelSingleAmpersand(command, shell);
  const redirection = redirectionTargets(command);
  const merged = mergeResults(results);
  merged.pipeline = hasPipeline;
  merged.redirection = hasRedirection;
  merged.target_inputs = [...merged.target_inputs, ...redirection];
  if (hasRedirection) {
    merged.components = [...(merged.components || []), {
      operation_class: 'redirection',
      decision_hint: 'ask',
      reason_code: 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL',
      target_digest: sha256(redirection),
      external_target_digest: sha256([]),
    }];
  }

  const hasSecretAccess = results.some((entry) => ['secret-access', 'secret-dump'].includes(entry.operation_class));
  const hasNetworkComponent = results.some((entry) => entry.operation_class === 'external-mutation' || entry.operation_class.startsWith('github-')) || results.some((entry) => entry.external_targets?.some((target) => ['network-or-remote-system', 'github'].includes(target.class)));
  const hasTransmissionComponent = /(?:^|[|;]\s*)(?:curl|curl\.exe|wget|invoke-webrequest|invoke-restmethod|send(?:-[A-Za-z0-9_-]+)?|upload|post|put)\b/i.test(command);
  if (hasSecretAccess && (hasNetworkComponent || hasTransmissionComponent || hasRedirection)) {
    merged.components = [...(merged.components || []), {
      operation_class: 'secret-exfiltration',
      decision_hint: 'deny',
      reason_code: 'SECRET_EXFILTRATION_DENIED',
      target_digest: sha256(merged.target_inputs || []),
      external_target_digest: sha256(merged.external_targets || []),
    }];
    merged.operation_class = 'secret-exfiltration';
    merged.mutation_class = 'secret-exfiltration';
    merged.decision_hint = 'deny';
    merged.reason_codes = ['SECRET_EXFILTRATION_DENIED', ...merged.reason_codes.filter((reason) => reason !== 'SECRET_EXFILTRATION_DENIED')];
    merged.secret_target = true;
  }
  if (hasPipeline && merged.decision_hint === 'allow') {
    merged.components = [...(merged.components || []), {
      operation_class: 'opaque-command',
      decision_hint: 'unsupported',
      reason_code: 'OPAQUE_COMMAND_UNSUPPORTED',
      target_digest: sha256(merged.target_inputs || []),
      external_target_digest: sha256(merged.external_targets || []),
    }];
    merged.operation_class = 'opaque-command';
    merged.mutation_class = 'opaque-command';
    merged.decision_hint = 'unsupported';
    merged.opaque = true;
    merged.reason_codes = ['OPAQUE_COMMAND_UNSUPPORTED', ...merged.reason_codes.filter((reason) => reason !== 'OPAQUE_COMMAND_UNSUPPORTED')];
  }
  if (hasRedirection && merged.operation_class === 'read') {
    merged.components = [...(merged.components || []), {
      operation_class: 'overwrite',
      decision_hint: 'ask',
      reason_code: 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL',
      target_digest: sha256(redirection),
      external_target_digest: sha256([]),
    }];
    merged.operation_class = 'overwrite';
    merged.mutation_class = 'overwrite';
    merged.decision_hint = 'ask';
    merged.reason_codes = ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL', ...merged.reason_codes.filter((reason) => reason !== 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL')];
  }
  if (hasSingleAmpersand && merged.decision_hint !== 'deny') {
    merged.components = [...(merged.components || []), {
      operation_class: 'opaque-command',
      decision_hint: 'unsupported',
      reason_code: 'DYNAMIC_TARGET_UNSUPPORTED',
      target_digest: sha256(merged.target_inputs || []),
      external_target_digest: sha256(merged.external_targets || []),
    }];
    merged.operation_class = 'opaque-command';
    merged.mutation_class = 'opaque-command';
    merged.decision_hint = 'unsupported';
    merged.opaque = true;
    merged.reason_codes = ['DYNAMIC_TARGET_UNSUPPORTED', ...merged.reason_codes.filter((reason) => reason !== 'DYNAMIC_TARGET_UNSUPPORTED')];
  }
  if (options.repository) {
    merged.targets = merged.target_inputs.map((entry) => (
      entry.kind === 'secret-variable'
        ? secretVariableTarget(entry.path.replace(/^env:/i, ''))
        : resolveTargets([entry], options.repository, { ...options, operation_cwd: options.operation_cwd })[0]
    )).filter(Boolean);
  }
  else merged.targets = [];
  return merged;
}

function classifyStructuredOperation(operation, options = {}) {
  const structured = operation?.structured_input || {};
  const declaredAction = lower(operation?.mutation_class || '');
  const action = declaredAction && declaredAction !== 'unknown' ? declaredAction : lower(structured.action || structured.operation || structured.type || '');
  const route = lower(operation?.canonical_route || operation?.host_tool || '');
  const targets = operation.targets || [];
  const resolvedSecretTargets = targets.filter((target) => {
    if (!target || target.status !== 'resolved') return false;
    const canonical = target.canonical_path;
    return (typeof canonical === 'string' && (isSecretPath(canonical) || isBulkSecretPath(canonical)))
      || target.evidence?.source === 'operation-variable';
  });
  const structuredVariableReference = [structured.target, structured.path, structured.variable, structured.environment_variable]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .some((value) => typeof value === 'string' && isSecretVariableReference(value));
  const structuredSecretVariable = structuredVariableReference || ['variable', 'environment_variable', 'environment_variable_name', 'env'].some((key) => (
    Object.hasOwn(structured, key) && structured[key] !== null && structured[key] !== undefined
  ));
  const hasExternalRoute = Boolean(
    operation?.mcp_server
      || operation?.mcp_tool
      || operation?.external_targets?.length
      || /(?:database|cloud|provider|deploy|production|external|mcp)/.test(route),
  );
  const catastrophicTargets = targets.filter((target) => target?.status === 'resolved' && catastrophicPath(target.canonical_path || target.raw_path));
  if (catastrophicTargets.length && ['delete', 'remove', 'destroy', 'overwrite', 'truncate', 'format', 'reset', 'rmdir'].includes(action)) {
    return commonResult('protected-target', 'deny', catastrophicTargets, { catastrophic_hint: true, reason_codes: ['CATASTROPHIC_TARGET_DENIED'] });
  }
  if ((resolvedSecretTargets.length || structuredSecretVariable) && hasExternalRoute) {
    return commonResult('secret-exfiltration', 'deny', resolvedSecretTargets.length ? resolvedSecretTargets : targets, { secret_target: true, reason_codes: ['SECRET_EXFILTRATION_DENIED'] });
  }
  if (/github/.test(route)) {
    const routeClass = /review/.test(route) ? 'github-review-mutation' : /issue/.test(route) ? 'github-issue-mutation' : /(?:pull|pr)/.test(route) ? 'github-pr-mutation' : 'github-repository-workflow-mutation';
    if (['read', 'status', 'diff', 'list', 'view', 'checks'].includes(action)) return commonResult('github-read', 'allow', targets, { external_targets: [{ class: 'github', digest: sha256({ route }) }], reason_codes: ['ROUTINE_GITHUB_READ'] });
    return commonResult(routeClass, 'ask', targets, { external_targets: [{ class: 'github', digest: sha256({ route }) }], reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  }
  if (operation?.mcp_server || operation?.mcp_tool || operation?.external_targets?.length || /(?:database|cloud|provider|deploy|production|external|mcp)/.test(route)) return commonResult('external-mutation', 'ask', targets, { external_targets: operation.external_targets || [{ class: route || 'external-system', digest: sha256({ route }) }], reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  if (['secret-exfiltration', 'secret-dump', 'credential-dump'].includes(action)) return commonResult('secret-dump', 'deny', targets, { secret_target: true, reason_codes: ['SECRET_DUMP_DENIED'] });
  if (['dump', 'export', 'exfiltrate', 'read-all', 'list-secrets'].includes(action)) return commonResult('secret-dump', 'deny', targets, { secret_target: true, reason_codes: ['SECRET_DUMP_DENIED'] });
  if (action === 'secret-access' || action === 'read-secret') return commonResult('secret-access', 'ask', targets, { secret_target: true, reason_codes: ['SECRET_ACCESS_REQUIRES_APPROVAL'] });
  if (['guardrail-bypass', 'bypass', 'disable-guardrail', 'disable-hook'].includes(action)) return commonResult('guardrail-bypass', 'deny', targets, { reason_codes: ['GUARDRAIL_BYPASS_DENIED'] });
  if (['overwrite', 'truncate', 'delete', 'git-destructive', 'git-force-push'].includes(action)) return commonResult(action, 'ask', targets, { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (['read', 'edit', 'create', 'rename'].includes(action) && (resolvedSecretTargets.length || structuredSecretVariable)) {
    const bulk = resolvedSecretTargets.some((target) => isBulkSecretPath(target.canonical_path)) || (structuredSecretVariable && ['dump', 'export', 'read-all'].includes(action));
    if (bulk) return commonResult('secret-dump', 'deny', resolvedSecretTargets.length ? resolvedSecretTargets : targets, { secret_target: true, reason_codes: ['SECRET_DUMP_DENIED'] });
    return commonResult('secret-access', 'ask', resolvedSecretTargets.length ? resolvedSecretTargets : targets, { secret_target: true, reason_codes: ['SECRET_ACCESS_REQUIRES_APPROVAL'] });
  }
  if (['read', 'edit', 'create', 'rename', 'git-local-read', 'git-stage', 'git-commit', 'git-push', 'toolkit-temp-cleanup'].includes(action)) return commonResult(action, 'allow', targets, { reason_codes: [action.startsWith('git-') ? 'ROUTINE_GIT_OPERATION' : 'ROUTINE_REPOSITORY_OPERATION'] });
  if (action) return commonResult(action, 'unsupported', targets, { opaque: true, reason_codes: ['UNSUPPORTED_ROUTE'] });
  return commonResult('opaque-command', 'unsupported', targets, { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
}

function classifyOperation(record, options = {}) {
  const operation = record?.operation || record || {};
  if (typeof operation.command === 'string' && operation.command.trim()) return classifyCommand(operation.command, { ...options, shell: operation.shell, operation_cwd: operation.operation_cwd, repository: record.repository });
  return classifyStructuredOperation(operation, { ...options, repository: record.repository });
}

module.exports = {
  tokenize,
  splitTopLevel,
  extractPathTokens,
  redirectionTargets,
  classifyCommand,
  classifyStructuredOperation,
  classifyOperation,
  isSecretPath,
  catastrophicPath,
};
