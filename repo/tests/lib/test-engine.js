'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSubjectMap } = require('../../scripts/lib/subject-map');
const { validateAgainstSchema } = require('../../scripts/lib/schema-validate');

const detectorPath = path.resolve(__dirname, '..', '..', 'scripts', 'lib', 'detectors');

const detectorUnits = {
  GOV001: require(path.join(detectorPath, 'det-gov001')),
  GOV002: require(path.join(detectorPath, 'det-gov002')),
  GOV003: require(path.join(detectorPath, 'det-gov003')),
  GOV004: require(path.join(detectorPath, 'det-gov004')),
  GOV005: require(path.join(detectorPath, 'det-gov005')),
  GOV006: require(path.join(detectorPath, 'det-gov006')),
  GOV007: require(path.join(detectorPath, 'det-gov007')),
  GOV008: require(path.join(detectorPath, 'det-gov008')),
  GOV009: require(path.join(detectorPath, 'det-gov009')),
  GOV010: require(path.join(detectorPath, 'det-gov010')),
  GOV011: require(path.join(detectorPath, 'det-gov011')),
  GOV012: require(path.join(detectorPath, 'det-gov012')),
  GOV013: require(path.join(detectorPath, 'det-gov013')),
  GOV014: require(path.join(detectorPath, 'det-gov014')),
  GOV015: require(path.join(detectorPath, 'det-gov015')),
  GOV016: require(path.join(detectorPath, 'det-gov016')),
  GOV017: require(path.join(detectorPath, 'det-gov017')),
  GOV018: require(path.join(detectorPath, 'det-gov018')),
  GOV019: require(path.join(detectorPath, 'det-gov019')),
  GOV020: require(path.join(detectorPath, 'det-gov020')),
  GOV021: require(path.join(detectorPath, 'det-gov021')),
  GOV022: require(path.join(detectorPath, 'det-gov022')),
  GOV023: require(path.join(detectorPath, 'det-gov023')),
  GOV024: require(path.join(detectorPath, 'det-gov024')),
  GOV025: require(path.join(detectorPath, 'det-gov025')),
  GOV026: require(path.join(detectorPath, 'det-gov026')),
  GOV027: require(path.join(detectorPath, 'det-gov027'))
};

function loadPolicy() {
  const POLICY_PATH = path.resolve(__dirname, '..', '..', '..', '_projects', 'development', 'issue-governance', '_main', 'policy', 'issue-governance-policy.json');
  return JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
}

function buildTestRegistry(overrides) {
  overrides = overrides || {};
  const policy = loadPolicy();
  const policyCodes = Object.keys(policy.finding_codes);

  for (const code of Object.keys(overrides)) {
    if (!policyCodes.includes(code)) {
      throw new Error('Unknown finding code in override: ' + code);
    }
    if (typeof overrides[code] !== 'function') {
      throw new Error('Override for ' + code + ' must be a function');
    }
  }

  return Object.assign({}, detectorUnits, overrides);
}

function auditWithRegistry(registry, snapshot) {
  const schemaResult = validateAgainstSchema(snapshot);
  if (!schemaResult.ok) return { findings: [], schemaErrors: schemaResult.errors };

  const repo = snapshot.repository;
  const issues = JSON.parse(JSON.stringify(snapshot.issues));
  const findings = [];
  const subjects = buildSubjectMap(issues);

  const orderedCodes = Object.keys(registry).sort();
  for (const code of orderedCodes) {
    registry[code](repo, issues, findings, subjects);
  }

  findings.sort(function(a, b) {
    if (a.code < b.code) return -1; if (a.code > b.code) return 1;
    var aId = a.subject === null ? '' : String(a.subject);
    var bId = b.subject === null ? '' : String(b.subject);
    if (aId < bId) return -1; if (aId > bId) return 1;
    if (a.message < b.message) return -1; if (a.message > b.message) return 1;
    return 0;
  });

  return { findings, schemaErrors: [], subjects };
}

module.exports = { detectorUnits, buildTestRegistry, auditWithRegistry, loadPolicy };
