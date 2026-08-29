#!/usr/bin/env node
'use strict';

/**
 * prepare-n8n-template.js
 *
 * Converts an exported n8n workflow JSON into a reusable template JSON.
 * This script is generic: it sanitises every node, not only specific node types.
 */

const fs = require('fs');
const path = require('path');

const TOP_LEVEL_STRIP_FIELDS = new Set([
  'id',
  'versionId',
  'createdAt',
  'updatedAt',
  'isArchived',
  'shared',
  'staticData',
  'pinData',
  'activeVersionId',
  'versionCounter',
  'triggerCount',
  'versionMetadata',
  'meta',
  'tags',
  'credentials',
]);

const NODE_STRIP_FIELDS = new Set([
  'credentials',
  'webhookId',
]);

const SETTINGS_STRIP_FIELDS = new Set([
  'availableInMCP',
  'errorWorkflow',
]);

const CACHE_FIELDS = new Set([
  'cachedResultName',
  'cachedResultUrl',
]);

const SENSITIVE_KEY_RE = /(api.?key|access.?token|refresh.?token|secret|password|credential|client.?id|client.?secret|document.?id|sheet.?id|folder.?id|database.?id|spreadsheet.?id|channel.?id|chat.?id|workspace.?id|account.?id)$/i;
const TEMPLATE_CONFIG_KEY_RE = /(namespace|index|model.?name|model|workflow.?id|send.?to|document.?id|sheet.?name|folder.?to.?watch|pinecone.?index|pinecone_index_name|url)$/i;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const URL_RE = /https?:\/\/[^\s"'`)\]}><]+/i;
const LONG_ID_RE = /^[0-9A-Za-z_-]{28,}$/;
const LONG_ID_HINT_RE = /\b[0-9A-Za-z_-]{33,}\b/;
const TEMPLATE_PLACEHOLDER_RE = /__SET_[A-Za-z0-9_]+__/g;
const STRONG_METADATA_CONFIG_PHRASE_RE = /\b(api.?key|access.?token|refresh.?token|client.?id|client.?secret|workflow.?id|document.?id|sheet.?id|folder.?id|database.?id|spreadsheet.?id|channel.?id|chat.?id|workspace.?id|account.?id|pinecone.?index|pinecone_index_name)\b/i;
const SEPARATED_METADATA_CONFIG_RE = /\b(?:[A-Za-z0-9]+[_-])*(?:namespace|index|model|workflow|document|sheet|folder|database|chat|workspace|account|token|key|secret|credential)(?:[_-][A-Za-z0-9]+)+\b/i;
const EXPRESSION_DEFAULT_LITERAL_RE = /(\|\||\?\?)\s*(['"])([^'"]+)\2/g;
const SENSITIVE_EXPRESSION_PATTERNS = [
  { label: 'Bearer token', regex: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i },
  { label: 'API key', regex: /\b(?:AIza[0-9A-Za-z_-]{20,}|pcsk_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})\b/i },
  { label: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/i },
];
const SAFE_CONFIG_LITERAL_VALUES = new Set([
  '',
  'false',
  'true',
  'id',
  'list',
  'manual',
  'string',
  'number',
  'boolean',
  'json',
]);

function usage(exitCode = 1) {
  console.error(`Usage: node prepare-n8n-template.js <input.json> <output.template.json> [--preserve-unicode] [--allow-empty]`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const positional = [];
  const options = {
    preserveUnicode: false,
    allowEmpty: false,
    quiet: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--preserve-unicode') options.preserveUnicode = true;
    else if (arg === '--allow-empty') options.allowEmpty = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }

  if (positional.length !== 2) usage(1);

  return {
    inputPath: positional[0],
    outputPath: positional[1],
    options,
  };
}

function readJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function unwrapWorkflow(raw) {
  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      throw new Error(`Expected an array containing exactly one workflow, got ${raw.length}.`);
    }
    return raw[0];
  }

  if (raw && typeof raw === 'object' && raw.workflow && typeof raw.workflow === 'object') {
    return raw.workflow;
  }

  return raw;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toAsciiSafeString(value) {
  return String(value)
    .replace(/ΓåÆ/g, '->')
    .replace(/ΓÇÖ/g, "'")
    .replace(/ΓÇÿ/g, "'")
    .replace(/ΓÇ£/g, '"')
    .replace(/ΓÇ¥/g, '"')
    .replace(/ΓÇô/g, '-')
    .replace(/ΓÇö/g, '-')
    .replace(/╬ô├ç├┐/g, '"')
    .replace(/╬ô├ç├û/g, '"')
    .replace(/[→➜➝⇒]/g, '->')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\u00A0/g, ' ');
}

function slug(value) {
  const cleaned = toAsciiSafeString(value || '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
  return cleaned || 'VALUE';
}

function fieldName(pathParts) {
  for (let i = pathParts.length - 1; i >= 0; i -= 1) {
    const part = pathParts[i];
    if (!/^\d+$/.test(part) && !['parameters', 'value', '__rl'].includes(part)) return part;
  }
  return 'value';
}

function placeholder(node, pathParts, suffix = '') {
  const nodePart = slug(node.name || node.type || 'NODE');
  const fieldPart = slug(suffix || fieldName(pathParts));
  return `__SET_${nodePart}_${fieldPart}__`;
}

function configPlaceholder(node, pathParts, suffix = '') {
  const cleanSuffix = String(suffix || fieldName(pathParts)).replace(/\./g, '_');
  return placeholder(node, pathParts, cleanSuffix);
}

function isConfigKey(value) {
  return SENSITIVE_KEY_RE.test(value || '') || TEMPLATE_CONFIG_KEY_RE.test(value || '');
}

function isTemplatableConfigLiteral(value) {
  const trimmed = String(value || '').trim();
  const normalized = trimmed.toLowerCase();

  if (trimmed.includes('__SET_')) return false;
  if (trimmed.startsWith('=')) return false;
  if (SAFE_CONFIG_LITERAL_VALUES.has(normalized)) return false;
  if (EMAIL_RE.test(trimmed)) return true;
  if (URL_RE.test(trimmed)) return true;
  if (LONG_ID_RE.test(trimmed) && trimmed.length >= 12) return true;
  if (/^models\/[A-Za-z0-9._/-]+$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/.test(trimmed) && trimmed.length >= 8) return true;

  return false;
}

function stripTemplatePlaceholders(value) {
  return String(value || '').replace(TEMPLATE_PLACEHOLDER_RE, ' ');
}

function findSuspiciousExpressionFindings(value) {
  const trimmed = String(value || '').trim();
  const inspected = stripTemplatePlaceholders(trimmed);
  const findings = new Set();

  if (!trimmed.startsWith('=') && !/\{\{.*\}\}/.test(trimmed)) return [];

  if (EMAIL_RE.test(inspected)) findings.add('email');
  if (URL_RE.test(inspected)) findings.add('URL');
  if (LONG_ID_HINT_RE.test(inspected)) findings.add('long ID');
  for (const suspect of SENSITIVE_EXPRESSION_PATTERNS) {
    if (suspect.regex.test(inspected)) findings.add(suspect.label);
  }

  return Array.from(findings);
}

function sanitiseExpressionDefaults(value, node, pathParts, warnings, suffix = '') {
  return value.replace(EXPRESSION_DEFAULT_LITERAL_RE, (match, operator, quote, literal) => {
    if (!isTemplatableConfigLiteral(literal)) return match;

    const next = configPlaceholder(node, pathParts, suffix ? `${suffix}_default` : 'default');
    warnings.push(`Replaced expression default on node "${node.name}" at ${pathParts.join('.')}.`);
    return `${operator} ${quote}${next}${quote}`;
  });
}

function sanitiseConfigString(value, node, pathParts, warnings, suffix = '') {
  const safe = toAsciiSafeString(value);
  const trimmed = safe.trim();

  if (trimmed.startsWith('=')) {
    return sanitiseExpressionDefaults(safe, node, pathParts, warnings, suffix);
  }

  if (!isTemplatableConfigLiteral(trimmed)) return safe;

  const next = configPlaceholder(node, pathParts, suffix);
  warnings.push(`Replaced template config on node "${node.name}" at ${pathParts.join('.')}.`);
  return next;
}

function addTemplateConfigReplacement(replacements, literal, replacement) {
  const text = String(literal || '').trim();
  if (!isTemplatableConfigLiteral(text)) return;
  if (!replacements.has(text)) replacements.set(text, replacement);
}

function addExpressionDefaultReplacements(replacements, value, node, pathParts, suffix = '') {
  const safe = toAsciiSafeString(value);
  for (const match of safe.matchAll(EXPRESSION_DEFAULT_LITERAL_RE)) {
    const literal = match[3];
    const replacement = configPlaceholder(node, pathParts, suffix ? `${suffix}_default` : 'default');
    addTemplateConfigReplacement(replacements, literal, replacement);
  }
}

function collectTemplateConfigReplacements(workflow) {
  const replacements = new Map();

  function visit(value, node, pathParts) {
    if (typeof value === 'string') {
      const last = fieldName(pathParts);
      if (isConfigKey(last)) {
        if (value.trim().startsWith('=')) {
          addExpressionDefaultReplacements(replacements, value, node, pathParts, last);
        } else {
          addTemplateConfigReplacement(replacements, value, configPlaceholder(node, pathParts, last));
        }
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, node, pathParts.concat(String(index))));
      return;
    }

    if (!isObject(value)) return;

    if (value.__rl === true && typeof value.value === 'string' && !value.value.trim().startsWith('=')) {
      addTemplateConfigReplacement(replacements, value.value, configPlaceholder(node, pathParts));
    }

    if (typeof value.name === 'string' && typeof value.value === 'string' && isConfigKey(value.name)) {
      if (value.value.trim().startsWith('=')) {
        addExpressionDefaultReplacements(replacements, value.value, node, pathParts.concat('value'), value.name);
      } else {
        addTemplateConfigReplacement(replacements, value.value, configPlaceholder(node, pathParts.concat('value'), value.name));
      }
    }

    for (const [key, child] of Object.entries(value)) {
      visit(child, node, pathParts.concat(key));
    }
  }

  for (const node of workflow.nodes || []) {
    visit(node.parameters || {}, node, ['parameters']);
  }

  return replacements;
}

function replaceTemplateConfigParameterReferences(value, replacements) {
  if (!replacements.size) return value;

  const entries = Array.from(replacements.entries()).sort((a, b) => b[0].length - a[0].length);

  function replaceString(text) {
    let result = text;
    for (const [literal, replacement] of entries) {
      result = result.split(literal).join(replacement);
    }
    return result;
  }

  function visit(child) {
    if (typeof child === 'string') return replaceString(child);
    if (Array.isArray(child)) return child.map(visit);
    if (!isObject(child)) return child;

    const result = {};
    for (const [key, nested] of Object.entries(child)) {
      result[key] = visit(nested);
    }
    return result;
  }

  return visit(value);
}

function stripTopLevelFields(workflow) {
  const clean = {};
  for (const [key, value] of Object.entries(workflow)) {
    if (!TOP_LEVEL_STRIP_FIELDS.has(key)) clean[key] = value;
  }
  return clean;
}

function stripWorkflowSettings(settings) {
  if (!isObject(settings)) return {};

  const clean = {};
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTINGS_STRIP_FIELDS.has(key)) clean[key] = value;
  }
  return clean;
}

function normaliseKeys(value) {
  if (Array.isArray(value)) return value.map(normaliseKeys);
  if (!isObject(value)) return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[toAsciiSafeString(key)] = normaliseKeys(child);
  }
  return result;
}

function sanitiseString(value, node, pathParts, warnings) {
  const original = String(value);
  const safe = toAsciiSafeString(original);
  const trimmed = safe.trim();

  if (trimmed.startsWith('=')) {
    const last = fieldName(pathParts);
    const withSanitisedDefaults = isConfigKey(last)
      ? sanitiseExpressionDefaults(safe, node, pathParts, warnings, last)
      : safe;
    const expressionFindings = findSuspiciousExpressionFindings(trimmed);
    if (expressionFindings.length > 0) {
      warnings.push(`Expression may still contain ${expressionFindings.join(' / ')} at ${node.name}.${pathParts.join('.')}. Review manually.`);
    }
    return withSanitisedDefaults;
  }

  if (trimmed.includes('__SET_')) return safe;

  if (EMAIL_RE.test(trimmed)) {
    const next = placeholder(node, pathParts, 'email');
    warnings.push(`Replaced email on node "${node.name}" at ${pathParts.join('.')}.`);
    return next;
  }

  if (URL_RE.test(trimmed)) {
    const next = placeholder(node, pathParts, 'url');
    warnings.push(`Replaced URL on node "${node.name}" at ${pathParts.join('.')}.`);
    return next;
  }

  const last = fieldName(pathParts);
  if ((SENSITIVE_KEY_RE.test(last) || LONG_ID_RE.test(trimmed)) && trimmed.length >= 12) {
    const next = placeholder(node, pathParts);
    warnings.push(`Replaced likely live ID/config on node "${node.name}" at ${pathParts.join('.')}.`);
    return next;
  }

  if (isConfigKey(last) && isTemplatableConfigLiteral(trimmed)) {
    return sanitiseConfigString(safe, node, pathParts, warnings, last);
  }

  return safe;
}

function sanitiseResourceLocator(value, node, pathParts, warnings) {
  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (CACHE_FIELDS.has(key)) continue;
    clean[key] = child;
  }

  if (typeof clean.value === 'string' && clean.value.trim().startsWith('=')) {
    clean.value = toAsciiSafeString(clean.value);
  } else {
    clean.value = placeholder(node, pathParts);
    clean.mode = 'id';
    warnings.push(`Replaced resource locator on node "${node.name}" at ${pathParts.join('.')}.`);
  }

  return clean;
}

function isLikelyMetadataConfigLiteral(value) {
  const trimmed = String(value || '').trim();
  const inspected = stripTemplatePlaceholders(trimmed).trim();
  if (!inspected) return false;
  if (trimmed.length < 8) return false;

  if (EMAIL_RE.test(inspected)) return true;
  if (URL_RE.test(inspected)) return true;
  if (LONG_ID_HINT_RE.test(inspected)) return true;
  if (findSuspiciousExpressionFindings(trimmed).length > 0) return true;
  if (SENSITIVE_EXPRESSION_PATTERNS.some((suspect) => suspect.regex.test(inspected))) return true;
  if (SENSITIVE_KEY_RE.test(inspected)) return true;
  if (TEMPLATE_CONFIG_KEY_RE.test(inspected)) return true;
  if (STRONG_METADATA_CONFIG_PHRASE_RE.test(inspected)) return true;
  if (SEPARATED_METADATA_CONFIG_RE.test(inspected)) return true;

  return false;
}

function collectMetadataWarnings(workflow, warnings) {
  const seen = new Set();
  const maybeAdd = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    warnings.push(`Possible config-like stable metadata at ${path}. Review manually.`);
  };

  if (isLikelyMetadataConfigLiteral(workflow.name)) {
    maybeAdd('workflow.name');
  }

  if (isObject(workflow.connections)) {
    for (const [sourceName, outputMap] of Object.entries(workflow.connections)) {
      if (isLikelyMetadataConfigLiteral(sourceName)) {
        maybeAdd(`connections key "${sourceName}"`);
      }
      if (!isObject(outputMap)) continue;
      for (const outputGroups of Object.values(outputMap)) {
        if (!Array.isArray(outputGroups)) continue;
        for (const branch of outputGroups) {
          if (!Array.isArray(branch)) continue;
          for (const connection of branch) {
            if (connection && typeof connection === 'object' && typeof connection.node === 'string' && isLikelyMetadataConfigLiteral(connection.node)) {
              maybeAdd(`connection target "${connection.node}"`);
            }
          }
        }
      }
    }
  }

  if (!Array.isArray(workflow.nodes)) return;
  for (const node of workflow.nodes) {
    if (node && typeof node === 'object' && isLikelyMetadataConfigLiteral(node.name)) {
      maybeAdd(`node "${node.name}".name`);
    }
  }
}

function sanitiseValue(value, node, pathParts, warnings) {
  if (typeof value === 'string') return sanitiseString(value, node, pathParts, warnings);
  if (Array.isArray(value)) return value.map((item, index) => sanitiseValue(item, node, pathParts.concat(String(index)), warnings));

  if (isObject(value)) {
    if (value.__rl === true) return sanitiseResourceLocator(value, node, pathParts, warnings);

    const result = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === 'credentials') continue;
      if (CACHE_FIELDS.has(key)) continue;
      const cleanKey = toAsciiSafeString(key);
      if (cleanKey === 'value' && typeof child === 'string' && typeof value.name === 'string' && isConfigKey(value.name)) {
        result[cleanKey] = sanitiseConfigString(child, node, pathParts.concat(cleanKey), warnings, value.name);
      } else {
        result[cleanKey] = sanitiseValue(child, node, pathParts.concat(cleanKey), warnings);
      }
    }
    return result;
  }

  return value;
}

function stripNode(node, warnings) {
  const clean = clone(node);
  for (const field of NODE_STRIP_FIELDS) delete clean[field];

  clean.name = toAsciiSafeString(clean.name || 'Unnamed Node');
  clean.type = toAsciiSafeString(clean.type || '');
  clean.parameters = sanitiseValue(clean.parameters || {}, clean, ['parameters'], warnings);

  return clean;
}

function findSuspiciousValues(value) {
  const warnings = [];

  function visit(child, pathParts) {
    if (typeof child === 'string') {
      const label = pathParts.join('.') || '(root)';
      const trimmed = child.trim();
      const inspected = stripTemplatePlaceholders(trimmed).trim();
      if (!inspected) return;

      if (EMAIL_RE.test(inspected)) warnings.push(`Possible real email remains at ${label}.`);
      if (URL_RE.test(inspected)) warnings.push(`Possible real URL remains at ${label}.`);

      const expressionFindings = findSuspiciousExpressionFindings(trimmed)
        .filter((finding) => finding !== 'email' && finding !== 'URL');
      if (expressionFindings.length > 0) {
        warnings.push(`Possible real ${expressionFindings.join(' / ')} remains at ${label}.`);
      }
      return;
    }

    if (Array.isArray(child)) {
      child.forEach((item, index) => visit(item, pathParts.concat(String(index))));
      return;
    }

    if (isObject(child)) {
      for (const [key, nested] of Object.entries(child)) {
        visit(nested, pathParts.concat(key));
      }
    }
  }

  visit(value, []);
  return Array.from(new Set(warnings));
}

function stripTemplate(workflow, options) {
  if (!isObject(workflow)) {
    throw new Error('Workflow JSON must be an object, an array containing one workflow, or an object with a workflow property.');
  }

  const warnings = [];
  let clean = stripTopLevelFields(clone(workflow));

  clean.name = toAsciiSafeString(clean.name || 'n8n Workflow Template');
  clean.active = false;

  if (!Array.isArray(clean.nodes)) throw new Error('Workflow is missing a nodes array.');
  if (!options.allowEmpty && clean.nodes.length === 0) {
    throw new Error('Workflow has zero nodes. Refusing to create an empty template.');
  }

  collectMetadataWarnings(clean, warnings);

  const templateConfigReplacements = collectTemplateConfigReplacements(clean);

  clean.nodes = clean.nodes.map((node, index) => {
    if (!isObject(node)) throw new Error(`Node at index ${index} must be an object.`);
    return stripNode(node, warnings);
  });

  for (const node of clean.nodes) {
    // Only rewrite parameter values. Node names and connections must remain aligned.
    node.parameters = replaceTemplateConfigParameterReferences(node.parameters || {}, templateConfigReplacements);
  }

  clean.connections = isObject(clean.connections) ? normaliseKeys(clean.connections) : {};
  clean.settings = normaliseKeys(stripWorkflowSettings(clean.settings));

  if (options.preserveUnicode) {
    // Node parameters have already been sanitised. PreserveUnicode only keeps future manual non-ASCII untouched.
    return { workflow: clean, warnings: warnings.concat(findSuspiciousValues(clean)) };
  }

  clean = normaliseKeys(clean);
  return { workflow: clean, warnings: warnings.concat(findSuspiciousValues(clean)) };
}

function main() {
  try {
    const { inputPath, outputPath, options } = parseArgs(process.argv);
    const raw = readJson(inputPath);
    const workflow = unwrapWorkflow(raw);
    const { workflow: template, warnings } = stripTemplate(workflow, options);

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(template, null, 2) + '\n');

    if (!options.quiet) {
      console.log(`Sanitised template: ${outputPath}`);
      console.log(`Nodes: ${template.nodes.length}`);
      console.log(`Active: ${template.active}`);
      if (warnings.length) {
        console.warn('\nWarnings:');
        for (const warning of warnings) console.warn(`- ${warning}`);
      }
    }
  } catch (error) {
    console.error(`prepare-n8n-template failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  stripTemplate,
  toAsciiSafeString,
  findSuspiciousValues,
};
