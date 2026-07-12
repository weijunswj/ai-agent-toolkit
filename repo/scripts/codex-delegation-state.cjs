'use strict';

const {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  cleanError,
  codexConfigPath,
  parseTomlStructurally,
} = require('./codex-delegation-common.cjs');
const { structuralLayout } = require('./codex-delegation-layout.cjs');

function expectedCodexDelegationBlock(eol = '\n') {
  return [
    CODEX_DELEGATION_BEGIN,
    `max_threads = ${CODEX_AGENT_MAX_THREADS}`,
    `max_depth = ${CODEX_AGENT_MAX_DEPTH}`,
    CODEX_DELEGATION_END,
  ].join(eol);
}

function stateBase(configPath, text, bytes, extra = {}) {
  return {
    config_path: configPath,
    text,
    bytes,
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    client_scope: 'Codex user config; CLI and IDE config layers are documented. Native desktop and Codex Security compatibility remain pending real-host UAT.',
    ...extra,
  };
}

function codexDelegationConfigState(configBytes, configPath = codexConfigPath()) {
  const bytes = Buffer.isBuffer(configBytes) ? Buffer.from(configBytes) : Buffer.from(String(configBytes || ''), 'utf8');
  let text;
  try {
    text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('invalid UTF-8');
  } catch (error) {
    return stateBase(configPath, '', bytes, { status: 'conflicting', detail: `Codex config is not valid UTF-8: ${cleanError(error)}` });
  }
  const parsed = parseTomlStructurally(bytes);
  if (!parsed.ok) {
    const status = parsed.kind === 'parser-unavailable' ? 'unsupported' : 'conflicting';
    return stateBase(configPath, text, bytes, { status, detail: parsed.detail, parser: parsed.parser || 'unavailable' });
  }
  const layout = structuralLayout(text);
  if (!layout.ok) return stateBase(configPath, text, bytes, { status: 'conflicting', detail: layout.detail, parser: parsed.parser });
  if (layout.unsupportedAssignments.length) {
    return stateBase(configPath, text, bytes, {
      status: 'conflicting',
      detail: 'Codex agents configuration uses dotted or inline assignment syntax that Toolkit will not edit surgically.',
      parser: parsed.parser,
      layout,
    });
  }
  if (layout.agentsTables.length > 1 || layout.beginMarkers.length > 1 || layout.endMarkers.length > 1 || layout.beginMarkers.length !== layout.endMarkers.length) {
    return stateBase(configPath, text, bytes, {
      status: 'conflicting',
      detail: 'Codex agents configuration or Toolkit markers are duplicated or malformed.',
      parser: parsed.parser,
      layout,
    });
  }
  if (parsed.agents_present && parsed.agents_is_table === false) {
    return stateBase(configPath, text, bytes, { status: 'conflicting', detail: 'The TOML agents value is not a table.', parser: parsed.parser, layout });
  }
  const values = parsed.values || {};
  if (parsed.agents_present && layout.agentsTables.length === 0) {
    return stateBase(configPath, text, bytes, {
      status: 'conflicting',
      detail: 'The parsed agents table is not represented by one explicit bare [agents] table, so Toolkit will not treat it as configured or edit it.',
      parser: parsed.parser,
      layout,
    });
  }
  const thread = values.max_threads || { present: false };
  const depth = values.max_depth || { present: false };
  const anyValue = thread.present || depth.present;
  const exact = thread.present && depth.present
    && thread.exact_int === true && depth.exact_int === true
    && thread.value === CODEX_AGENT_MAX_THREADS && depth.value === CODEX_AGENT_MAX_DEPTH;
  if (anyValue && !exact) {
    return stateBase(configPath, text, bytes, {
      status: 'conflicting',
      detail: 'Existing Codex agent limits are missing, non-integer, duplicated, or differ from Toolkit values and were not overwritten.',
      parser: parsed.parser,
      layout,
    });
  }
  const managed = layout.beginMarkers.length === 1;
  if (managed) {
    const begin = layout.beginMarkers[0];
    const end = layout.endMarkers[0];
    const agents = layout.agentsTables[0];
    const nextTable = agents ? layout.tables.find((entry) => entry.index > agents.index) : null;
    if (!agents || begin.index <= agents.index || end.index <= begin.index || (nextTable && end.index >= nextTable.index)) {
      return stateBase(configPath, text, bytes, {
        status: 'conflicting',
        detail: 'Toolkit delegation markers are not a well-formed block inside the real [agents] table.',
        parser: parsed.parser,
        layout,
      });
    }
    const blockText = layout.lines.slice(begin.index, end.index + 1)
      .map((entry) => entry.raw.slice(0, entry.eol ? -entry.eol.length : undefined))
      .join('\n');
    if (blockText.replace(/\r/g, '') !== expectedCodexDelegationBlock('\n')) {
      return stateBase(configPath, text, bytes, {
        status: 'conflicting',
        detail: 'Toolkit delegation markers contain unsupported content.',
        parser: parsed.parser,
        layout,
      });
    }
  }
  if (exact) {
    return stateBase(configPath, text, bytes, {
      status: 'configured',
      max_threads: CODEX_AGENT_MAX_THREADS,
      max_depth: CODEX_AGENT_MAX_DEPTH,
      ownership: managed ? 'toolkit-managed' : 'user-owned-compatible',
      detail: managed ? 'Toolkit-managed limits are configured.' : 'Compatible user-owned integer limits are configured.',
      parser: parsed.parser,
      layout,
    });
  }
  if (managed) {
    return stateBase(configPath, text, bytes, {
      status: 'conflicting',
      detail: 'Toolkit markers exist without the exact parsed integer limits.',
      parser: parsed.parser,
      layout,
    });
  }
  if (layout.agentsChildren.length && layout.agentsTables.length === 0) {
    return stateBase(configPath, text, bytes, {
      status: 'conflicting',
      detail: 'Codex config contains [agents.<role>] child tables without an explicit [agents] table; Toolkit will not rewrite this ambiguous structure.',
      parser: parsed.parser,
      layout,
    });
  }
  return stateBase(configPath, text, bytes, {
    status: 'unconfigured',
    detail: 'Codex agent limits are not configured.',
    parser: parsed.parser,
    layout,
  });
}

module.exports = { expectedCodexDelegationBlock, stateBase, codexDelegationConfigState };
