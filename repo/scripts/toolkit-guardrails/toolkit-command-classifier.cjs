'use strict';

const {
  sha256,
} = require('./toolkit-guardrail-policy.cjs');
const {
  resolveTargets,
} = require('./toolkit-active-repository.cjs');

const CLASS_DECISION_RANK = Object.freeze({ allow: 0, ask: 1, unsupported: 2, deny: 3 });

function lower(value) {
  return String(value || '').toLowerCase();
}

function splitTopLevel(command) {
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
    if (char === '\\' && quote !== '"') {
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
    if (!quote && (char === '&' && next === '&')) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function tokenize(command) {
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
    if (char === '\\' && quote !== '"') {
      escaped = true;
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
  while (index < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index]) || tokens[index] === 'sudo' || tokens[index] === 'env')) index += 1;
  return lower(tokens[index] || '').replace(/^.*[\\/]/, '');
}

function isOption(token) {
  return typeof token === 'string' && token.startsWith('-');
}

function pathLike(token) {
  if (!token || isOption(token)) return false;
  if (token === '.' || token === '..' || token.startsWith('./') || token.startsWith('../') || token.startsWith('.\\') || token.startsWith('..\\')) return true;
  if (/^[A-Za-z]:[\\/]/.test(token) || token.startsWith('/') || token.startsWith('\\\\')) return true;
  return /[\\/]/.test(token) || /\.(md|json|js|cjs|ts|txt|log|env|key|pem|sh|ps1|cmd|bat)$/i.test(token);
}

function extractPathTokens(tokens, start = 1) {
  const paths = [];
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (isOption(token)) {
      if (['-path', '--path', '-literalpath', '--literal-path', '-destination', '--output', '-o', '/path', '/d'].includes(lower(token))) {
        const value = tokens[index + 1];
        if (value && !isOption(value)) paths.push({ path: value, kind: 'command-target' });
        index += 1;
      }
      continue;
    }
    if (pathLike(token)) paths.push({ path: token, kind: 'command-target' });
  }
  return paths;
}

function redirectionTargets(command) {
  const result = [];
  const pattern = /(?:^|\s)(?:\d{0,2})(>>|>)(?:\s*)("[^"]+"|'[^']+'|[^\s|;&]+)/g;
  let match;
  while ((match = pattern.exec(command))) {
    result.push({ path: match[2].replace(/^['"]|['"]$/g, ''), kind: match[1] === '>>' ? 'append-redirection' : 'redirection' });
  }
  return result;
}

function hasNestedShell(tokens, shell) {
  const name = commandName(tokens);
  const shellName = lower(shell);
  if (['sh', 'bash', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'cmd', 'cmd.exe'].includes(name)) {
    return tokens.some((token) => ['-c', '-command', '/c', '/k'].includes(lower(token)));
  }
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

function classifyGit(tokens) {
  const subcommand = lower(tokens[1] || '');
  if (!subcommand) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  if (['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'branch'].includes(subcommand) && !tokens.some((token) => ['-d', '-D', '--delete'].includes(token))) {
    return commonResult('git-local-read', 'allow', extractPathTokens(tokens, 2), { reason_codes: ['ROUTINE_GIT_OPERATION'] });
  }
  if (subcommand === 'add') return commonResult('git-stage', 'allow', extractPathTokens(tokens, 2), { reason_codes: ['ROUTINE_GIT_OPERATION'] });
  if (subcommand === 'commit') {
    const destructive = tokens.some((token) => ['--amend', '--no-verify'].includes(lower(token)));
    return commonResult(destructive ? 'git-destructive' : 'git-commit', destructive ? 'ask' : 'allow', [], { reason_codes: [destructive ? 'DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL' : 'ROUTINE_GIT_OPERATION'] });
  }
  if (subcommand === 'push') {
    const force = tokens.some((token) => ['--force', '-f', '--force-with-lease'].includes(lower(token)) || token.startsWith('+'));
    const deletion = tokens.some((token) => lower(token) === '--delete' || lower(token) === '-d');
    const args = tokens.slice(2).filter((token) => !token.startsWith('-'));
    const remote = args[0] || 'origin';
    const refs = args.slice(1);
    const refText = refs.join(' ');
    const otherTarget = remote !== 'origin' || refs.some((ref) => {
      const destination = ref.includes(':') ? ref.split(':').pop() : ref;
      return destination && !['HEAD', 'head'].includes(destination) && destination !== 'CURRENT_BRANCH';
    }) || tokens.some((token) => ['--tags', '--all', '--mirror'].includes(lower(token)));
    if (force) return commonResult('git-force-push', 'ask', [], { git_push: { remote, refs, force: true, deletion, other_target: otherTarget }, reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
    if (deletion) return commonResult('git-other-target', 'ask', [], { git_push: { remote, refs, force: false, deletion: true, other_target: true }, reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
    if (otherTarget) return commonResult('git-other-target', 'ask', [], { git_push: { remote, refs, force: false, deletion: false, other_target: true }, reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
    return commonResult('git-push', 'allow', [], { git_push: { remote, refs, force: false, deletion: false, other_target: false }, reason_codes: ['AUTHORISED_NORMAL_PUSH'] });
  }
  if (subcommand === 'reset' && tokens.some((token) => lower(token) === '--hard')) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'clean' || subcommand === 'rebase' || subcommand === 'filter-branch' || subcommand === 'filter-repo') return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'restore' || (subcommand === 'checkout' && tokens.some((token) => token === '--'))) return commonResult('git-destructive', 'ask', extractPathTokens(tokens, 2), { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'branch' && tokens.some((token) => ['-d', '-D', '--delete'].includes(token))) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (subcommand === 'tag' && tokens.some((token) => ['-d', '--delete'].includes(token))) return commonResult('git-destructive', 'ask', [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (['remote', 'config', 'clone', 'fetch', 'pull', 'submodule'].includes(subcommand)) return commonResult('external-mutation', 'ask', [], { external_targets: [{ class: 'git-remote', digest: sha256(tokens) }], reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  return commonResult('opaque-command', 'unsupported', extractPathTokens(tokens, 2), { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
}

function classifyAtomic(command, shell) {
  const tokens = tokenize(command);
  const name = commandName(tokens);
  const normalized = lower(command);
  const protectedPath = /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|credentials(?:\.json)?|\.env(?:\.|$)|id_rsa|id_ed25519)(?:[\\/]|$)/i.test(command)
    || /(?:^|\s)(?:[A-Za-z]:)?[\\/]Windows(?:[\\/]|$)/i.test(command)
    || /(?:^|\s)\/(?:etc|sys|boot|root)(?:[\\/]|$)/i.test(command);
  const secretDump = /(?:printenv|\benv\b|\bset(?:\s|$)|Get-ChildItem\s+env:|Get-Content[^\n]*(?:\.env|\.ssh|credentials|id_rsa)|(?:cat|type|more|head|tail)[^\n]*(?:\.env|\.ssh|credentials|id_rsa))/i.test(command)
    || (protectedPath && /(?:cat|type|more|Get-Content|copy|cp|curl|wget|Invoke-WebRequest|Invoke-RestMethod|base64|ConvertTo-Base64)/i.test(command));
  if (secretDump || /(curl|wget|Invoke-WebRequest|Invoke-RestMethod)[^\n]*(?:token|secret|password|api[-_]?key|\.env|\.ssh)/i.test(command)) {
    return commonResult('secret-exfiltration', 'deny', [], { reason_codes: ['SECRET_EXFILTRATION_DENIED'], protected_hint: protectedPath });
  }
  if (/(dangerously[-_]?skip[-_]?permissions|bypass[-_]?permissions|disable[^\n]*(?:hook|guardrail|sandbox|trust)|(?:--no-verify|--no-hooks)|always\s+allow|auto[-_]?approve|force[_ -]?ask)/i.test(command)) {
    return commonResult('guardrail-bypass', 'deny', [], { reason_codes: ['GUARDRAIL_BYPASS_DENIED'] });
  }
  if (name === 'git') return classifyGit(tokens);
  if (['sh', 'bash', 'zsh', 'dash', 'fish', 'pwsh', 'powershell', 'cmd', 'cmd.exe'].includes(name) && hasNestedShell(tokens, shell)) {
    return commonResult('opaque-command', 'unsupported', [], { nested: true, opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  }
  if (['node', 'node.exe', 'python', 'python3', 'pwsh', 'powershell', 'cmd', 'cmd.exe'].includes(name) && tokens.slice(1).some((token) => /\.(?:cjs|js|mjs|py|ps1|sh|bat|cmd)$/i.test(token))) {
    return commonResult('opaque-command', 'unsupported', extractPathTokens(tokens, 1), { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  }
  if (['curl', 'curl.exe', 'wget', 'invoke-webrequest', 'invoke-restmethod', 'scp', 'ftp', 'ssh'].includes(name)) {
    return commonResult('external-mutation', 'ask', [], { external_targets: [{ class: 'network-or-remote-system', digest: sha256(command) }], reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'] });
  }
  if (name === 'gh' && tokens.some((token) => ['issue', 'pr', 'api', 'review'].includes(lower(token)))) {
    return commonResult('role-boundary-violation', 'deny', [], { reason_codes: ['ROLE_AUTHORITY_VIOLATION'] });
  }
  if (['rm', 'rmdir', 'del', 'erase', 'Remove-Item'.toLowerCase()].includes(name)) {
    return commonResult('delete', 'ask', extractPathTokens(tokens, 1), { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'], protected_hint: protectedPath });
  }
  if (['mv', 'move', 'Move-Item'.toLowerCase(), 'ren', 'rename', 'Rename-Item'.toLowerCase()].includes(name)) {
    return commonResult('rename', 'allow', extractPathTokens(tokens, 1), { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'], protected_hint: protectedPath });
  }
  if (['cp', 'copy', 'Copy-Item'.toLowerCase(), 'install'].includes(name)) {
    return commonResult('create', 'allow', extractPathTokens(tokens, 1), { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'], protected_hint: protectedPath });
  }
  if (['touch', 'mkdir', 'md', 'New-Item'.toLowerCase(), 'tee'].includes(name)) {
    return commonResult('create', 'allow', extractPathTokens(tokens, 1), { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'], protected_hint: protectedPath });
  }
  if (['set-content', 'out-file', 'add-content', 'echo', 'printf', 'set'].includes(name)) {
    return commonResult('overwrite', 'ask', extractPathTokens(tokens, 1), { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'], protected_hint: protectedPath });
  }
  if (['get-content', 'get-childitem', 'dir', 'ls', 'find', 'grep', 'rg', 'sed', 'awk', 'cat', 'type', 'more', 'head', 'tail', 'pwd', 'where', 'findstr'].includes(name)) {
    return commonResult('read', 'allow', extractPathTokens(tokens, 1), { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'], protected_hint: protectedPath });
  }
  if (name === 'cd' || name === 'pushd' || name === 'popd') return commonResult('read', 'allow', extractPathTokens(tokens, 1), { reason_codes: ['ROUTINE_REPOSITORY_OPERATION'] });
  if (['npm', 'pnpm', 'yarn', 'pip', 'cargo'].includes(name)) {
    const install = tokens.some((token) => ['install', 'add', 'remove', 'uninstall', 'publish', 'update'].includes(lower(token)));
    return commonResult(install ? 'external-mutation' : 'opaque-command', install ? 'ask' : 'unsupported', [], { opaque: !install, reason_codes: [install ? 'EXTERNAL_MUTATION_REQUIRES_APPROVAL' : 'OPAQUE_COMMAND_UNSUPPORTED'] });
  }
  if (protectedPath) return commonResult('protected-target', 'deny', [], { reason_codes: ['PROTECTED_TARGET_DENIED'], protected_hint: true });
  return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
}

function mergeResults(results) {
  const list = Array.isArray(results) ? results : [];
  if (!list.length) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  let selected = list[0];
  for (const candidate of list.slice(1)) {
    if (CLASS_DECISION_RANK[candidate.decision_hint] > CLASS_DECISION_RANK[selected.decision_hint]) selected = candidate;
  }
  return {
    ...selected,
    compound: list.length > 1 || Boolean(selected.compound),
    pipeline: Boolean(list.length > 1 && selected.pipeline),
    reason_codes: [...new Set(list.flatMap((entry) => entry.reason_codes || []))],
    target_inputs: list.flatMap((entry) => entry.target_inputs || []),
    external_targets: list.flatMap((entry) => entry.external_targets || []),
    nested: list.some((entry) => entry.nested),
    opaque: list.some((entry) => entry.opaque),
    protected_hint: list.some((entry) => entry.protected_hint),
    components: list.map((entry) => ({ operation_class: entry.operation_class, decision_hint: entry.decision_hint })),
  };
}

function classifyCommand(command, options = {}) {
  if (typeof command !== 'string' || !command.trim()) return commonResult('opaque-command', 'unsupported', [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
  const parts = splitTopLevel(command);
  const results = parts.map((part) => classifyAtomic(part, options.shell));
  const hasPipeline = /(^|[^\\])\|([^|]|$)/.test(command);
  const hasRedirection = /(?:^|\s)\d{0,2}(?:>>|>)/.test(command);
  const redirection = redirectionTargets(command);
  const merged = mergeResults(results);
  merged.pipeline = hasPipeline;
  merged.redirection = hasRedirection;
  merged.target_inputs = [...merged.target_inputs, ...redirection];
  if (hasPipeline && merged.decision_hint === 'allow') {
    merged.operation_class = 'opaque-command';
    merged.mutation_class = 'opaque-command';
    merged.decision_hint = 'unsupported';
    merged.opaque = true;
    merged.reason_codes.push('OPAQUE_COMMAND_UNSUPPORTED');
  }
  if (hasRedirection && merged.operation_class === 'read') {
    merged.operation_class = 'overwrite';
    merged.mutation_class = 'overwrite';
    merged.decision_hint = 'ask';
    merged.reason_codes.push('DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL');
  }
  if (options.repository) {
    merged.targets = resolveTargets(merged.target_inputs, options.repository, {
      ...options,
      operation_cwd: options.operation_cwd,
    });
  } else {
    merged.targets = [];
  }
  return merged;
}

function classifyStructuredOperation(operation, options = {}) {
  const structured = operation?.structured_input || {};
  const declaredAction = lower(operation?.mutation_class || '');
  const action = declaredAction && declaredAction !== 'unknown'
    ? declaredAction
    : lower(structured.action || structured.operation || structured.type || '');
  const route = lower(operation?.canonical_route || operation?.host_tool || '');
  if (/github.*(?:issue|pull|review)|(?:issue|pull|review).*github/.test(route) && action && !['read', 'status', 'diff'].includes(action)) {
    return commonResult('role-boundary-violation', 'deny', operation.targets || [], { reason_codes: ['ROLE_AUTHORITY_VIOLATION'] });
  }
  if (operation?.mcp_server || operation?.mcp_tool || operation?.external_targets?.length || /(?:database|cloud|provider|deploy|production|external|mcp)/.test(route)) {
    return commonResult('external-mutation', 'ask', operation.targets || [], {
      external_targets: operation.external_targets || [{ class: route || 'external-system', digest: sha256(route) }],
      reason_codes: ['EXTERNAL_MUTATION_REQUIRES_APPROVAL'],
    });
  }
  if (['secret-exfiltration', 'secret-dump', 'credential-dump'].includes(action)) return commonResult('secret-exfiltration', 'deny', operation.targets || [], { reason_codes: ['SECRET_EXFILTRATION_DENIED'] });
  if (['guardrail-bypass', 'bypass', 'disable-guardrail', 'disable-hook'].includes(action)) return commonResult('guardrail-bypass', 'deny', operation.targets || [], { reason_codes: ['GUARDRAIL_BYPASS_DENIED'] });
  if (['overwrite', 'truncate', 'delete', 'git-destructive', 'git-force-push'].includes(action)) return commonResult(action, 'ask', operation.targets || [], { reason_codes: ['DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL'] });
  if (['read', 'edit', 'create', 'rename', 'git-local-read', 'git-stage', 'git-commit', 'git-push', 'toolkit-temp-cleanup'].includes(action)) return commonResult(action, 'allow', operation.targets || [], { reason_codes: [action.startsWith('git-') ? 'ROUTINE_GIT_OPERATION' : 'ROUTINE_REPOSITORY_OPERATION'] });
  if (action) return commonResult(action, 'unsupported', operation.targets || [], { opaque: true, reason_codes: ['UNSUPPORTED_ROUTE'] });
  return commonResult('opaque-command', 'unsupported', operation.targets || [], { opaque: true, reason_codes: ['OPAQUE_COMMAND_UNSUPPORTED'] });
}

function classifyOperation(record, options = {}) {
  const operation = record?.operation || record || {};
  const command = operation.command;
  if (typeof command === 'string' && command.trim()) return classifyCommand(command, {
    ...options,
    shell: operation.shell,
    operation_cwd: operation.operation_cwd,
    repository: record.repository,
  });
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
};
