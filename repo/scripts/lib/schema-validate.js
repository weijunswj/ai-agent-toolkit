'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, '_projects', 'development', 'issue-governance', '_main', 'schema', 'issue-snapshot.schema.json');

let _schema = null;
let _ajvValidate = null;

function loadSchema() {
  if (!_schema) _schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return _schema;
}

function getValidator() {
  if (!_ajvValidate) {
    const schema = loadSchema();
    const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
    _ajvValidate = ajv.compile(schema);
  }
  return _ajvValidate;
}

function getSnapshotVersion() {
  return loadSchema().properties.snapshot_version.const;
}

function validateAgainstSchema(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Input must be a JSON object.'] };
  }
  const validate = getValidator();
  const valid = validate(data);
  if (valid) return { ok: true, data };
  const errors = validate.errors.map(e => {
    const ptr = e.instancePath || '/';
    const kw = e.keyword;
    if (kw === 'additionalProperties') {
      return `Schema violation at ${ptr}: unknown property.`;
    }
    if (kw === 'required') {
      return `Schema violation at ${ptr}: missing required property.`;
    }
    if (kw === 'type') {
      return `Schema violation at ${ptr}: wrong type.`;
    }
    if (kw === 'enum') {
      return `Schema violation at ${ptr}: value not in allowed set.`;
    }
    if (kw === 'const') {
      return `Schema violation at ${ptr}: unexpected value.`;
    }
    if (kw === 'minLength') {
      return `Schema violation at ${ptr}: minimum length not met.`;
    }
    if (kw === 'pattern') {
      return `Schema violation at ${ptr}: does not match pattern.`;
    }
    return `Schema violation at ${ptr}: ${kw}.`;
  });
  return { ok: false, errors };
}

module.exports = { loadSchema, getValidator, getSnapshotVersion, validateAgainstSchema, SCHEMA_PATH };
