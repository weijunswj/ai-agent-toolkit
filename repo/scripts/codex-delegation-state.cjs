'use strict';

const {
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
  CODEX_V2_ROOT_GUIDANCE,
  CODEX_V2_HELPER_GUIDANCE,
  cleanError,
  codexConfigPath,
  helpersToTotalThreads,
  parseTomlStructurally,
  totalThreadsToHelpers,
} = require('./codex-delegation-common.cjs');
const { structuralLayout } = require('./codex-delegation-layout.cjs');

const RUNTIMES = Object.freeze({
  V2: 'MultiAgentV2',
  V1: 'MultiAgentV1',
  DISABLED: 'disabled',
  UNKNOWN: 'unknown',
});

function tomlString(value) {
  return JSON.stringify(String(value)).replace(/\\u2028|\\u2029/g, (match) => match.toLowerCase());
}

function expectedLegacyBlock(helperCount = 1, eol = '\n') {
  return [
    CODEX_DELEGATION_BEGIN,
    `max_threads = ${helperCount}`,
    `max_depth = ${CODEX_AGENT_MAX_DEPTH}`,
    CODEX_DELEGATION_END,
  ].join(eol);
}

function expectedCodexDelegationBlock(eol = '\n') {
  return expectedLegacyBlock(1, eol);
}

function expectedV2Block(helperCount = 1, eol = '\n') {
  return [
    CODEX_HELPER_CAPACITY_BEGIN,
    'enabled = true',
    `max_concurrent_threads_per_session = ${helpersToTotalThreads(helperCount)}`,
    `root_agent_usage_hint_text = ${tomlString(CODEX_V2_ROOT_GUIDANCE)}`,
    `subagent_usage_hint_text = ${tomlString(CODEX_V2_HELPER_GUIDANCE)}`,
    CODEX_HELPER_CAPACITY_END,
  ].join(eol);
}

function stateBase(configPath, text, bytes, runtime, extra = {}) {
  return {
    config_path: configPath,
    text,
    bytes,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    runtime,
    client_scope: 'Codex effective runtime inspected through app-server experimentalFeature/list; configuration target is the Codex user config.',
    ...extra,
  };
}

function markerFailure(layout) {
  return layout.beginMarkers.length > 1
    || layout.endMarkers.length > 1
    || layout.beginMarkers.length !== layout.endMarkers.length
    || layout.helperBeginMarkers.length > 1
    || layout.helperEndMarkers.length > 1
    || layout.helperBeginMarkers.length !== layout.helperEndMarkers.length;
}

function linesBetween(layout, begin, end) {
  return layout.lines.slice(begin.index, end.index + 1)
    .map((entry) => entry.raw.slice(0, entry.eol ? -entry.eol.length : undefined))
    .join('\n')
    .replace(/\r/g, '');
}

function validateManagedBlock(layout, table, begin, end, expected, label) {
  const nextTable = table ? layout.tables.find((entry) => entry.index > table.index) : null;
  if (!table || begin.index <= table.index || end.index <= begin.index || (nextTable && end.index >= nextTable.index)) {
    return `${label} markers are not a well-formed block inside the expected table.`;
  }
  if (linesBetween(layout, begin, end) !== expected.replace(/\r/g, '')) {
    return `${label} markers contain unsupported content.`;
  }
  return '';
}

function exactInteger(value, expected) {
  return value?.present === true && value.exact_int === true && value.value === expected;
}

function exactString(value, expected) {
  return value?.present === true && value.type === 'str' && value.value === expected;
}

function exactBoolean(value, expected) {
  return value?.present === true && value.type === 'bool' && value.value === expected;
}

function v2State(parsed, layout, base) {
  if (parsed.multi_agent_v2_present && parsed.multi_agent_v2_is_table === false) {
    if (parsed.multi_agent_v2_type === 'bool' && parsed.multi_agent_v2_scalar === true && layout.featuresTables.length === 1) {
      return {
        ...base,
        status: 'enablement-migration-required',
        ownership: 'user-owned-compatible-v2-enable',
        helper_count: null,
        total_threads: null,
        hard_nested_helper_enforcement: 'not-supported',
        detail: 'MultiAgentV2 is enabled with the official boolean form; Toolkit can migrate that exact enablement to the configured V2 table when helper capacity is explicitly approved.',
      };
    }
    return { ...base, status: 'conflicting', detail: 'features.multi_agent_v2 is not a compatible enabled table or boolean; Toolkit will not rewrite that user-owned shape.' };
  }
  if (layout.multiAgentV2Tables.length > 1 || layout.multiAgentV2Children.length) {
    return { ...base, status: 'conflicting', detail: 'The MultiAgentV2 table layout is duplicated or has unsupported child tables.' };
  }
  if (parsed.multi_agent_v2_present && layout.multiAgentV2Tables.length !== 1) {
    return { ...base, status: 'conflicting', detail: 'The effective MultiAgentV2 table is not represented by one explicit [features.multi_agent_v2] table.' };
  }

  const values = parsed.multi_agent_v2_values || {};
  const enabled = values.enabled;
  const anyTarget = ['max_concurrent_threads_per_session', 'root_agent_usage_hint_text', 'subagent_usage_hint_text']
    .some((key) => values[key]?.present === true);
  const capacity = values.max_concurrent_threads_per_session;
  const helperCount = capacity?.exact_int ? totalThreadsToHelpers(capacity.value) : null;
  const exactGuidance = exactString(values.root_agent_usage_hint_text, CODEX_V2_ROOT_GUIDANCE)
    && exactString(values.subagent_usage_hint_text, CODEX_V2_HELPER_GUIDANCE);
  const managed = layout.helperBeginMarkers.length === 1;

  if (managed) {
    if (!exactBoolean(enabled, true) || !Number.isSafeInteger(helperCount) || helperCount < 0 || !exactGuidance) {
      return { ...base, status: 'conflicting', detail: 'Toolkit MultiAgentV2 markers do not contain valid capacity and guidance values.' };
    }
    const error = validateManagedBlock(
      layout,
      layout.multiAgentV2Tables[0],
      layout.helperBeginMarkers[0],
      layout.helperEndMarkers[0],
      expectedV2Block(helperCount, '\n'),
      'Toolkit MultiAgentV2 helper-capacity'
    );
    if (error) return { ...base, status: 'conflicting', detail: error };
    return {
      ...base,
      status: 'configured',
      ownership: 'toolkit-managed-v2',
      helper_count: helperCount,
      total_threads: helperCount + 1,
      hard_nested_helper_enforcement: 'not-supported',
      recursive_helper_control: 'policy-only; no native hard block verified',
      recursive_hard_block: false,
      detail: `Toolkit-managed MultiAgentV2 capacity allows ${helperCount} helper(s) plus the root (${helperCount + 1} total session threads); the root counts toward the total.`,
    };
  }

  if (anyTarget) {
    if (exactBoolean(enabled, true) && Number.isSafeInteger(helperCount) && helperCount >= 0 && exactGuidance) {
      return {
        ...base,
        status: 'configured',
        ownership: 'user-owned-compatible-v2',
        helper_count: helperCount,
        total_threads: helperCount + 1,
        hard_nested_helper_enforcement: 'not-supported',
        recursive_helper_control: 'policy-only; no native hard block verified',
        recursive_hard_block: false,
        detail: `Compatible user-owned MultiAgentV2 values allow ${helperCount} helper(s) plus the root (${helperCount + 1} total session threads); the root counts toward the total and Toolkit will not claim ownership.`,
      };
    }
    return { ...base, status: 'conflicting', detail: 'User-owned MultiAgentV2 capacity or guidance values are present; Toolkit will not overwrite them.' };
  }

  if (enabled?.present && !exactBoolean(enabled, true)) {
    return { ...base, status: 'conflicting', detail: 'User-owned MultiAgentV2 enablement is false or non-boolean; Toolkit will not overwrite it.' };
  }

  if (layout.beginMarkers.length === 1) {
    const legacyValues = parsed.values || {};
    const legacyExact = exactInteger(legacyValues.max_threads, 1) && exactInteger(legacyValues.max_depth, 1);
    const error = validateManagedBlock(
      layout,
      layout.agentsTables[0],
      layout.beginMarkers[0],
      layout.endMarkers[0],
      expectedLegacyBlock(1, '\n'),
      'Toolkit PR #237 legacy delegation'
    );
    if (!legacyExact || error) {
      return { ...base, status: 'conflicting', detail: error || 'Toolkit PR #237 markers do not contain the complete expected legacy values.' };
    }
    return {
      ...base,
      status: 'migration-required',
      ownership: 'toolkit-managed-v1-legacy',
      helper_count: 1,
      total_threads: 2,
      detail: 'The exact Toolkit PR #237 legacy block is present and will be migrated to MultiAgentV2 without touching user-owned settings.',
    };
  }

  const legacyValues = parsed.values || {};
  if (legacyValues.max_threads?.present || legacyValues.max_depth?.present) {
    return { ...base, status: 'conflicting', detail: 'User-owned legacy [agents] limits are present while MultiAgentV2 is effective; Toolkit will not modify them.' };
  }

  return {
    ...base,
    status: 'unconfigured',
    helper_count: null,
    total_threads: null,
    hard_nested_helper_enforcement: 'not-supported',
    detail: 'MultiAgentV2 is effective and no Toolkit-managed helper capacity is configured.',
  };
}

function v1State(parsed, layout, base) {
  if (parsed.agents_present && parsed.agents_is_table === false) {
    return { ...base, status: 'conflicting', detail: 'The TOML agents value is not a table.' };
  }
  if (layout.agentsTables.length > 1 || layout.unsupportedAssignments.length) {
    return { ...base, status: 'conflicting', detail: 'The legacy [agents] layout is duplicated, dotted, or inline and cannot be edited surgically.' };
  }
  if (parsed.agents_present && layout.agentsTables.length === 0) {
    return { ...base, status: 'conflicting', detail: 'The parsed agents table is not represented by one explicit bare [agents] table.' };
  }
  const values = parsed.values || {};
  const thread = values.max_threads || { present: false };
  const depth = values.max_depth || { present: false };
  const anyValue = thread.present || depth.present;
  const helperCount = thread.exact_int && Number.isSafeInteger(thread.value) && thread.value >= 0 ? thread.value : null;
  const exact = helperCount !== null && exactInteger(depth, 1);
  const managed = layout.beginMarkers.length === 1;
  if (managed) {
    const error = helperCount === null ? 'Toolkit legacy helper count is not a non-negative integer.' : validateManagedBlock(
      layout,
      layout.agentsTables[0],
      layout.beginMarkers[0],
      layout.endMarkers[0],
      expectedLegacyBlock(helperCount, '\n'),
      'Toolkit legacy delegation'
    );
    if (!exact || error) return { ...base, status: 'conflicting', detail: error || 'Toolkit legacy markers contain unsupported values.' };
  }
  if (exact) {
    return {
      ...base,
      status: 'configured',
      ownership: managed ? 'toolkit-managed-v1' : 'user-owned-compatible-v1',
      helper_count: helperCount,
      total_threads: null,
      hard_nested_helper_enforcement: 'supported',
      detail: managed ? `Toolkit-managed MultiAgentV1 capacity allows ${helperCount} helper(s).` : `Compatible user-owned MultiAgentV1 values allow ${helperCount} helper(s).`,
    };
  }
  if (anyValue) return { ...base, status: 'conflicting', detail: 'User-owned MultiAgentV1 limits are incomplete, non-integer, or use a different nesting depth; Toolkit will not overwrite them.' };
  if (layout.agentsChildren.length && layout.agentsTables.length === 0) {
    return { ...base, status: 'conflicting', detail: 'Codex config contains [agents.<role>] child tables without an explicit [agents] table.' };
  }
  return { ...base, status: 'unconfigured', helper_count: null, total_threads: null, hard_nested_helper_enforcement: 'supported', detail: 'MultiAgentV1 is effective and helper capacity is not configured.' };
}

function codexDelegationConfigState(configBytes, configPath = codexConfigPath(), runtime = RUNTIMES.UNKNOWN) {
  const bytes = Buffer.isBuffer(configBytes) ? Buffer.from(configBytes) : Buffer.from(String(configBytes || ''), 'utf8');
  let text;
  try {
    text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('invalid UTF-8');
  } catch (error) {
    return stateBase(configPath, '', bytes, runtime, { status: 'conflicting', detail: `Codex config is not valid UTF-8: ${cleanError(error)}` });
  }
  const parsed = parseTomlStructurally(bytes);
  if (!parsed.ok) {
    return stateBase(configPath, text, bytes, runtime, { status: parsed.kind === 'parser-unavailable' ? 'unsupported' : 'conflicting', detail: parsed.detail, parser: parsed.parser || 'unavailable' });
  }
  const layout = structuralLayout(text);
  if (!layout.ok) return stateBase(configPath, text, bytes, runtime, { status: 'conflicting', detail: layout.detail, parser: parsed.parser });
  const base = stateBase(configPath, text, bytes, runtime, { parser: parsed.parser, layout, parsed });
  if (markerFailure(layout)) return { ...base, status: 'conflicting', detail: 'Toolkit helper-capacity markers are duplicated, mismatched, or malformed.' };
  if (layout.beginMarkers.length && layout.helperBeginMarkers.length) return { ...base, status: 'conflicting', detail: 'Legacy and MultiAgentV2 Toolkit marker blocks cannot coexist.' };

  if (runtime === RUNTIMES.V2) return v2State(parsed, layout, base);
  if (runtime === RUNTIMES.V1) return v1State(parsed, layout, base);
  return {
    ...base,
    status: runtime === RUNTIMES.DISABLED ? 'disabled' : 'unsupported',
    helper_count: null,
    total_threads: null,
    hard_nested_helper_enforcement: runtime === RUNTIMES.DISABLED ? 'not-applicable' : 'unverified',
    detail: runtime === RUNTIMES.DISABLED
      ? 'Codex multi-agent support is disabled; Toolkit will not write helper capacity.'
      : 'The effective Codex multi-agent runtime is unknown; Toolkit will not write helper capacity.',
  };
}

module.exports = {
  RUNTIMES,
  tomlString,
  expectedLegacyBlock,
  expectedCodexDelegationBlock,
  expectedV2Block,
  stateBase,
  codexDelegationConfigState,
};
