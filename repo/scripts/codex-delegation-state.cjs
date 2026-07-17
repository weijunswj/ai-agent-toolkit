'use strict';

const {
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  CODEX_V2_ENABLEMENT_BEGIN,
  CODEX_V2_ENABLEMENT_END,
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
  CODEX_ROOT_GUIDANCE_BEGIN,
  CODEX_ROOT_GUIDANCE_END,
  CODEX_HELPER_GUIDANCE_BEGIN,
  CODEX_HELPER_GUIDANCE_END,
  CODEX_V2_ROOT_GUIDANCE,
  CODEX_V2_HELPER_GUIDANCE,
  cleanError,
  codexConfigPath,
  helpersToTotalThreads,
  parseTomlStructurally,
  sha256,
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

function managedAssignmentBlock(begin, assignment, end, eol = '\n') {
  return [begin, assignment, end].join(eol);
}

function expectedV2Block(helperCount = 1, eol = '\n', options = {}) {
  const blocks = [];
  if (options.manageEnablement !== false) blocks.push(managedAssignmentBlock(CODEX_V2_ENABLEMENT_BEGIN, 'enabled = true', CODEX_V2_ENABLEMENT_END, eol));
  else blocks.push('enabled = true');
  blocks.push(
    managedAssignmentBlock(CODEX_HELPER_CAPACITY_BEGIN, `max_concurrent_threads_per_session = ${helpersToTotalThreads(helperCount)}`, CODEX_HELPER_CAPACITY_END, eol),
    managedAssignmentBlock(CODEX_ROOT_GUIDANCE_BEGIN, `root_agent_usage_hint_text = ${tomlString(CODEX_V2_ROOT_GUIDANCE)}`, CODEX_ROOT_GUIDANCE_END, eol),
    managedAssignmentBlock(CODEX_HELPER_GUIDANCE_BEGIN, `subagent_usage_hint_text = ${tomlString(CODEX_V2_HELPER_GUIDANCE)}`, CODEX_HELPER_GUIDANCE_END, eol)
  );
  return blocks.join(eol);
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
  const pairs = [
    ['beginMarkers', 'endMarkers'],
    ['enablementBeginMarkers', 'enablementEndMarkers'],
    ['helperBeginMarkers', 'helperEndMarkers'],
    ['rootGuidanceBeginMarkers', 'rootGuidanceEndMarkers'],
    ['helperGuidanceBeginMarkers', 'helperGuidanceEndMarkers'],
  ];
  return pairs.some(([begin, end]) => layout[begin].length > 1 || layout[end].length > 1 || layout[begin].length !== layout[end].length);
}

function rawLine(layout, index) {
  const entry = layout.lines[index];
  return entry.raw.slice(0, entry.eol ? -entry.eol.length : undefined);
}

function tableBounds(layout, table) {
  const next = layout.tables.find((entry) => entry.index > table.index);
  return { first: table.index + 1, last: next ? next.index - 1 : layout.lines.length - 1 };
}

function markerRepairKinds(markers) {
  const kinds = new Set();
  const categories = [...new Set(markers.map((marker) => marker.category))];
  for (const category of categories) {
    const group = markers.filter((marker) => marker.category === category);
    const begins = group.filter((marker) => marker.boundary === 'begin');
    const ends = group.filter((marker) => marker.boundary === 'end');
    if (!begins.length) kinds.add('missing-begin-marker');
    if (!ends.length) kinds.add('missing-end-marker');
    if (begins.length > 1 || ends.length > 1) kinds.add('duplicate-recognized-marker');
    if (begins.length && ends.length && Math.min(...ends.map((marker) => marker.index)) < Math.max(...begins.map((marker) => marker.index))) {
      kinds.add('reversed-marker-order');
    }
  }
  return [...kinds].sort();
}

function repairRanges(layout, entries, text) {
  return [...entries]
    .sort((left, right) => left.index - right.index)
    .map((entry) => ({
      line_start: entry.index + 1,
      line_end: entry.index + 1,
      byte_start: Buffer.byteLength(text.slice(0, entry.start), 'utf8'),
      byte_end: Buffer.byteLength(text.slice(0, entry.end), 'utf8'),
    }));
}

function classifyMalformedToolkitRepair(parsed, layout, base) {
  const markers = layout.recognizedToolkitDelegationMarkers || [];
  if (!markers.length || ![RUNTIMES.V1, RUNTIMES.V2].includes(base.runtime)) return null;
  const families = new Set(markers.map((marker) => marker.family));
  if (families.size !== 1) return null;
  const expectedFamily = base.runtime === RUNTIMES.V2 ? 'v2' : 'legacy';
  if (!families.has(expectedFamily)) return null;

  const table = base.runtime === RUNTIMES.V2 ? layout.multiAgentV2Tables[0] : layout.agentsTables[0];
  const exactlyOneTable = base.runtime === RUNTIMES.V2
    ? layout.multiAgentV2Tables.length === 1 && layout.multiAgentV2Children.length === 0
    : layout.agentsTables.length === 1 && layout.agentsChildren.length === 0 && layout.unsupportedAssignments.length === 0;
  if (!exactlyOneTable || !table) return null;
  const bounds = tableBounds(layout, table);
  if (markers.some((marker) => marker.index < bounds.first || marker.index > bounds.last)) return null;

  const markerIndices = new Set(markers.map((marker) => marker.index));
  const markerFirst = Math.min(...markers.map((marker) => marker.index));
  const markerLast = Math.max(...markers.map((marker) => marker.index));
  const markerRegionIsolated = Array.from({ length: markerLast - markerFirst + 1 }, (_, offset) => markerFirst + offset)
    .every((index) => markerIndices.has(index) || rawLine(layout, index).trim() === '');
  const begins = markers.filter((marker) => marker.boundary === 'begin');
  const ends = markers.filter((marker) => marker.boundary === 'end');
  const markerOnlyBoundarySafe = markerRegionIsolated && (
    (!begins.length && markerFirst === bounds.first)
    || (!ends.length && markerLast === bounds.last)
    || (begins.length && ends.length
      && Math.max(...ends.map((marker) => marker.index)) < Math.min(...begins.map((marker) => marker.index)))
  );
  if (markerOnlyBoundarySafe) {
    const markerRanges = repairRanges(layout, markers, base.text);
    let cursor = 0;
    const kept = [];
    for (const range of markerRanges) {
      kept.push(base.bytes.subarray(cursor, range.byte_start));
      cursor = range.byte_end;
    }
    kept.push(base.bytes.subarray(cursor));
    const cleaned = codexDelegationConfigState(Buffer.concat(kept), base.config_path, base.runtime);
    const expectedOwnership = base.runtime === RUNTIMES.V2 ? 'user-owned-compatible-v2' : 'user-owned-compatible-v1';
    if (cleaned.status === 'configured' && cleaned.ownership === expectedOwnership) {
      const affectedBytes = Buffer.concat(markerRanges.map((range) => base.bytes.subarray(range.byte_start, range.byte_end)));
      return {
        ...base,
        status: 'repair-required',
        ownership: 'toolkit-malformed-repairable',
        enablement_ownership: cleaned.enablement_ownership,
        helper_count: cleaned.helper_count,
        total_threads: cleaned.total_threads,
        repair: {
          schema: 'ai-agent-toolkit.codex-malformed-marker-repair.v1',
          family: expectedFamily,
          mode: 'markers-only-preserve-user-values',
          kinds: markerRepairKinds(markers),
          marker_categories: [...new Set(markers.map((marker) => marker.category))].sort(),
          affected_keys: [],
          affected_ranges: markerRanges,
          affected_bytes_sha256: sha256(affectedBytes),
          remove_legacy_material: expectedFamily === 'legacy',
          remove_current_material: expectedFamily === 'v2',
          write_current_representation: false,
          preserved_user_helper_count: cleaned.helper_count,
          unrelated_bytes_unchanged: true,
        },
        detail: 'Malformed historical Toolkit marker lines are isolated at the supported table boundary; compatible user-owned values remain effective and can be preserved byte-for-byte through an exact approval-bound marker-only repair.',
      };
    }
  }

  const markerCategories = new Set(markers.map((marker) => marker.category));
  if (base.runtime === RUNTIMES.V2
    && ['helper-capacity', 'root-guidance', 'helper-guidance'].some((category) => !markerCategories.has(category))) return null;

  const assignments = layout.assignments.filter((entry) => entry.index >= bounds.first && entry.index <= bounds.last);
  const selected = [];
  const affectedKeys = [];
  if (base.runtime === RUNTIMES.V1) {
    const threads = parsed.values?.max_threads;
    const depth = parsed.values?.max_depth;
    const threadLine = assignments.find((entry) => entry.key === 'max_threads');
    const depthLine = assignments.find((entry) => entry.key === 'max_depth');
    if (!threads?.exact_int || !Number.isSafeInteger(threads.value) || threads.value < 0 || !exactInteger(depth, 1)
      || !threadLine || !depthLine
      || rawLine(layout, threadLine.index).trim() !== `max_threads = ${threads.value}`
      || rawLine(layout, depthLine.index).trim() !== 'max_depth = 1') return null;
    selected.push(threadLine, depthLine);
    affectedKeys.push('agents.max_threads', 'agents.max_depth');
  } else {
    const values = parsed.multi_agent_v2_values || {};
    const total = values.max_concurrent_threads_per_session;
    const capacityLine = assignments.find((entry) => entry.key === 'max_concurrent_threads_per_session');
    const rootLine = assignments.find((entry) => entry.key === 'root_agent_usage_hint_text');
    const helperLine = assignments.find((entry) => entry.key === 'subagent_usage_hint_text');
    if (!exactBoolean(values.enabled, true)
      || !total?.exact_int || !Number.isSafeInteger(total.value) || total.value < 1
      || !exactString(values.root_agent_usage_hint_text, CODEX_V2_ROOT_GUIDANCE)
      || !exactString(values.subagent_usage_hint_text, CODEX_V2_HELPER_GUIDANCE)
      || !capacityLine || !rootLine || !helperLine
      || rawLine(layout, capacityLine.index).trim() !== `max_concurrent_threads_per_session = ${total.value}`
      || rawLine(layout, rootLine.index).trim() !== `root_agent_usage_hint_text = ${tomlString(CODEX_V2_ROOT_GUIDANCE)}`
      || rawLine(layout, helperLine.index).trim() !== `subagent_usage_hint_text = ${tomlString(CODEX_V2_HELPER_GUIDANCE)}`) return null;
    if (markers.some((marker) => marker.category === 'enablement')) {
      const enabledLine = assignments.find((entry) => entry.key === 'enabled');
      if (!enabledLine || rawLine(layout, enabledLine.index).trim() !== 'enabled = true') return null;
      selected.push(enabledLine);
      affectedKeys.push('features.multi_agent_v2.enabled');
    }
    selected.push(capacityLine, rootLine, helperLine);
    affectedKeys.push(
      'features.multi_agent_v2.max_concurrent_threads_per_session',
      'features.multi_agent_v2.root_agent_usage_hint_text',
      'features.multi_agent_v2.subagent_usage_hint_text'
    );
  }

  const affected = [...markers, ...selected].sort((left, right) => left.index - right.index);
  const affectedIndices = new Set(affected.map((entry) => entry.index));
  const first = affected[0].index;
  const last = affected[affected.length - 1].index;
  for (let index = first; index <= last; index += 1) {
    if (affectedIndices.has(index)) continue;
    if (rawLine(layout, index).trim() !== '') return null;
  }
  const ranges = repairRanges(layout, affected, base.text);
  const affectedBytes = Buffer.concat(affected.map((entry) => Buffer.from(base.text.slice(entry.start, entry.end), 'utf8')));
  const categories = [...new Set(markers.map((marker) => marker.category))].sort();
  return {
    ...base,
    status: 'repair-required',
    ownership: 'toolkit-malformed-repairable',
    enablement_ownership: base.runtime === RUNTIMES.V2
      ? (markers.some((marker) => marker.category === 'enablement') ? 'toolkit-malformed' : 'user-owned-table')
      : undefined,
    helper_count: base.runtime === RUNTIMES.V2
      ? totalThreadsToHelpers(parsed.multi_agent_v2_values.max_concurrent_threads_per_session.value)
      : parsed.values.max_threads.value,
    total_threads: base.runtime === RUNTIMES.V2 ? parsed.multi_agent_v2_values.max_concurrent_threads_per_session.value : null,
    repair: {
      schema: 'ai-agent-toolkit.codex-malformed-marker-repair.v1',
      family: expectedFamily,
      mode: 'remove-owned-material-and-write-current',
      kinds: markerRepairKinds(markers),
      marker_categories: categories,
      affected_keys: affectedKeys,
      affected_ranges: ranges,
      affected_bytes_sha256: sha256(affectedBytes),
      remove_legacy_material: expectedFamily === 'legacy',
      remove_current_material: expectedFamily === 'v2',
      write_current_representation: true,
      unrelated_bytes_unchanged: true,
    },
    detail: 'A malformed historical Toolkit-owned delegation marker region is isolated inside the one supported runtime table and can be repaired only through an exact approval-bound transaction.',
  };
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
        enablement_ownership: 'user-owned-boolean',
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
  const managedEnablement = layout.enablementBeginMarkers.length === 1;
  const managedCapacity = layout.helperBeginMarkers.length === 1;
  const managedRootGuidance = layout.rootGuidanceBeginMarkers.length === 1;
  const managedHelperGuidance = layout.helperGuidanceBeginMarkers.length === 1;
  const anyManaged = managedEnablement || managedCapacity || managedRootGuidance || managedHelperGuidance;
  const completeManagedValues = managedCapacity && managedRootGuidance && managedHelperGuidance;

  if (anyManaged) {
    if (!exactBoolean(enabled, true) || !Number.isSafeInteger(helperCount) || helperCount < 0 || !exactGuidance) {
      return { ...base, status: 'conflicting', detail: 'Toolkit MultiAgentV2 markers do not contain valid capacity and guidance values.' };
    }
    if (!completeManagedValues) return { ...base, status: 'conflicting', detail: 'Toolkit MultiAgentV2 capacity and guidance ownership markers are incomplete.' };
    const table = layout.multiAgentV2Tables[0];
    const checks = [
      ...(managedEnablement ? [[layout.enablementBeginMarkers[0], layout.enablementEndMarkers[0], managedAssignmentBlock(CODEX_V2_ENABLEMENT_BEGIN, 'enabled = true', CODEX_V2_ENABLEMENT_END), 'Toolkit MultiAgentV2 enablement']] : []),
      [layout.helperBeginMarkers[0], layout.helperEndMarkers[0], managedAssignmentBlock(CODEX_HELPER_CAPACITY_BEGIN, `max_concurrent_threads_per_session = ${helpersToTotalThreads(helperCount)}`, CODEX_HELPER_CAPACITY_END), 'Toolkit MultiAgentV2 helper capacity'],
      [layout.rootGuidanceBeginMarkers[0], layout.rootGuidanceEndMarkers[0], managedAssignmentBlock(CODEX_ROOT_GUIDANCE_BEGIN, `root_agent_usage_hint_text = ${tomlString(CODEX_V2_ROOT_GUIDANCE)}`, CODEX_ROOT_GUIDANCE_END), 'Toolkit MultiAgentV2 root guidance'],
      [layout.helperGuidanceBeginMarkers[0], layout.helperGuidanceEndMarkers[0], managedAssignmentBlock(CODEX_HELPER_GUIDANCE_BEGIN, `subagent_usage_hint_text = ${tomlString(CODEX_V2_HELPER_GUIDANCE)}`, CODEX_HELPER_GUIDANCE_END), 'Toolkit MultiAgentV2 helper guidance'],
    ];
    for (const [begin, end, expected, label] of checks) {
      const error = validateManagedBlock(layout, table, begin, end, expected, label);
      if (error) return { ...base, status: 'conflicting', detail: error };
    }
    return {
      ...base,
      status: 'configured',
      ownership: 'toolkit-managed-v2',
      enablement_ownership: managedEnablement ? 'toolkit-managed' : 'user-owned-table',
      capacity_ownership: 'toolkit-managed',
      root_guidance_ownership: 'toolkit-managed',
      helper_guidance_ownership: 'toolkit-managed',
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
        enablement_ownership: 'user-owned-table',
        capacity_ownership: 'user-owned',
        root_guidance_ownership: 'user-owned',
        helper_guidance_ownership: 'user-owned',
        helper_count: helperCount,
        total_threads: helperCount + 1,
        hard_nested_helper_enforcement: 'not-supported',
        recursive_helper_control: 'policy-only; no native hard block verified',
        recursive_hard_block: false,
        detail: `Compatible user-owned MultiAgentV2 values allow ${helperCount} helper(s) plus the root (${helperCount + 1} total session threads); the root counts toward the total and Toolkit will not claim ownership.`,
      };
    }
    return {
      ...base,
      status: 'conflicting',
      enablement_ownership: exactBoolean(enabled, true) ? 'user-owned-table' : 'replace-required',
      detail: 'User-owned MultiAgentV2 capacity or guidance values are present; Toolkit will not overwrite them.',
    };
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
    return {
      ...base,
      status: 'unconfigured',
      ownership: 'user-owned-legacy-ignored-by-v2',
      legacy_values_ignored: true,
      helper_count: null,
      total_threads: null,
      hard_nested_helper_enforcement: 'not-supported',
      detail: 'MultiAgentV2 is effective, so the preserved user-owned legacy [agents] values do not enforce the active helper capacity. No effective Toolkit helper capacity is configured.',
    };
  }

  return {
    ...base,
    status: 'unconfigured',
    enablement_ownership: exactBoolean(enabled, true) ? 'user-owned-table' : 'absent',
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
      recursive_helper_control: 'hard-enforced by the supported V1 nesting-depth control',
      recursive_hard_block: true,
      detail: managed ? `Toolkit-managed MultiAgentV1 capacity allows ${helperCount} helper(s).` : `Compatible user-owned MultiAgentV1 values allow ${helperCount} helper(s).`,
    };
  }
  if (anyValue) return { ...base, status: 'conflicting', detail: 'User-owned MultiAgentV1 limits are incomplete, non-integer, or use a different nesting depth; Toolkit will not overwrite them.' };
  if (layout.agentsChildren.length && layout.agentsTables.length === 0) {
    return { ...base, status: 'conflicting', detail: 'Codex config contains [agents.<role>] child tables without an explicit [agents] table.' };
  }
  return { ...base, status: 'unconfigured', helper_count: null, total_threads: null, hard_nested_helper_enforcement: 'supported', recursive_helper_control: 'hard-enforced when Toolkit configures the supported V1 nesting-depth control', recursive_hard_block: true, detail: 'MultiAgentV1 is effective and helper capacity is not configured.' };
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
  if (layout.unknownToolkitDelegationMarkers.length) return { ...base, status: 'conflicting', detail: 'Unknown or obsolete Toolkit delegation ownership markers are present; ownership is ambiguous and Toolkit will not modify the file.' };
  const anyV2Marker = layout.enablementBeginMarkers.length || layout.helperBeginMarkers.length || layout.rootGuidanceBeginMarkers.length || layout.helperGuidanceBeginMarkers.length;
  if (layout.beginMarkers.length && anyV2Marker) return { ...base, status: 'conflicting', detail: 'Legacy and MultiAgentV2 Toolkit marker blocks cannot coexist.' };
  const malformedMarkers = markerFailure(layout)
    || markerRepairKinds(layout.recognizedToolkitDelegationMarkers || []).includes('reversed-marker-order');
  if (malformedMarkers) {
    const repairable = classifyMalformedToolkitRepair(parsed, layout, base);
    if (repairable) return repairable;
    return { ...base, status: 'conflicting', detail: 'Toolkit helper-capacity markers are duplicated, mismatched, reversed, malformed, outside the effective runtime table, or interleaved with content whose ownership cannot be proven.' };
  }

  if (runtime === RUNTIMES.V2) return v2State(parsed, layout, base);
  if (runtime === RUNTIMES.V1) return v1State(parsed, layout, base);
  if (anyV2Marker) return v2State(parsed, layout, base);
  if (layout.beginMarkers.length) return v1State(parsed, layout, base);
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
  managedAssignmentBlock,
  expectedV2Block,
  stateBase,
  codexDelegationConfigState,
};
