'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const sourceSkill = path.join(repoRoot, '_projects', 'knowledge', 'knowledge-index-updater', '_main', 'skill', 'SKILL.md');
const generatedSkill = path.join(repoRoot, 'skills', 'knowledge-index-updater', 'SKILL.md');
const sourceReadme = path.join(repoRoot, '_projects', 'knowledge', 'knowledge-index-updater', '_main', 'skill', 'README.md');
const generatedReadme = path.join(repoRoot, 'skills', 'knowledge-index-updater', 'README.md');
const fakeDataSourceId = 'collection://replace-with-your-notion-data-source-id';
const realDataSourceIdPattern = /collection:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const sourceFiles = [
  { filePath: sourceSkill, label: 'source SKILL' },
  { filePath: generatedSkill, label: 'generated SKILL' },
  { filePath: sourceReadme, label: 'source README' },
  { filePath: generatedReadme, label: 'generated README' },
];
const skillFiles = [sourceSkill, generatedSkill];

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function section(text, heading, nextHeadingLevel = '##') {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const next = text.indexOf(`\n${nextHeadingLevel} `, start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

function subsection(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const next = text.indexOf('\n#### ', start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function updateSectionFor(filePath, text) {
  const heading = filePath.includes('README.md') ? '## Existing row update confirmation' : '### Existing row update confirmation';
  const nextLevel = filePath.includes('README.md') ? '##' : '###';
  return section(text, heading, nextLevel);
}

test('Knowledge Index clean default schema excludes Canonical Key', () => {
  for (const filePath of [sourceSkill, generatedSkill]) {
    const text = read(filePath);
    const schema = section(text, '## Default Index Schema');
    const ddl = section(text, '### Default database DDL', '##');
    const view = section(text, '## Default View Setup');

    assert.doesNotMatch(schema, /- `Canonical Key` .*identity/i, filePath);
    assert.doesNotMatch(ddl, /"Canonical Key" RICH_TEXT/, filePath);
    assert.doesNotMatch(view, /^\s*\d+\.\s+`Canonical Key`/m, filePath);
    assert.match(view, /`Category`[\s\S]*`Name`[\s\S]*`Description`[\s\S]*`GitHub Key`[\s\S]*`Notion Key`[\s\S]*`Source`[\s\S]*`Last checked`[\s\S]*`Status`[\s\S]*`Visibility`/, filePath);
  }
});

test('Knowledge Index scheduled prompt treats Notion and GitHub keys as the only hard identity fields', () => {
  const text = read(sourceSkill);
  const scheduled = section(text, '### 7. Scheduled updater behaviour');
  assert.match(scheduled, /Treat `Notion Key` and `GitHub Key` as the only hard identity fields\./);
  assert.match(scheduled, /Do not use `Canonical Key` for matching, creating, merging, or deduplication\./);
  assert.match(scheduled, /If an existing row still has a `Canonical Key`, ignore it unless I explicitly ask for legacy cleanup\./);
  assert.match(scheduled, /Do not create separate Notion Link, GitHub Link, Source Link, or Canonical Key fields\./);
  assert.doesNotMatch(scheduled, /Treat Notion Key, GitHub Key, and Canonical Key as identity fields/);
});

test('Knowledge Index scheduled prompt uses database placeholders instead of a real data source ID', () => {
  for (const filePath of [sourceSkill, generatedSkill]) {
    const text = read(filePath);
    const scheduled = section(text, '### 7. Scheduled updater behaviour');
    assert.match(scheduled, /Replace the placeholder database name and data source URL with the user's actual Notion Knowledge Index details before using this prompt in an external scheduler\./, filePath);
    assert.match(scheduled, /- Name: <Knowledge Index database name>/, filePath);
    assert.match(scheduled, /- Data source: <collection:\/\/your-notion-data-source-id>/, filePath);
    assert.doesNotMatch(text, realDataSourceIdPattern, filePath);
  }
});

test('Knowledge Index scheduled section includes Codex prompt and fallback guidance', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    const scheduled = section(text, '### 7. Scheduled updater behaviour');
    const codexPromptSection = subsection(scheduled, '#### Recommended Codex automation prompt');
    const staticPromptSection = subsection(scheduled, '#### Static fallback prompt for external schedulers that cannot load skills');

    assert.match(codexPromptSection, /Use the `knowledge-index-updater` skill\./, filePath);
    assert.match(codexPromptSection, /Locate and read the current `knowledge-index-updater\/SKILL\.md`/, filePath);
    assert.match(codexPromptSection, /Do not fall back to older inline Knowledge Index rules/, filePath);
    assert.match(codexPromptSection, /stop and report that the automation cannot safely run/, filePath);
    assert.match(staticPromptSection, /Static fallback prompt for external schedulers that cannot load skills/, filePath);
    assert.match(staticPromptSection, /Use this static fallback only when the scheduler cannot load or read the current skill at runtime\. Codex automation should use the self-loading prompt above instead\./, filePath);
    assert.equal(countMatches(staticPromptSection, /\n```text\n/g), 1, filePath);
    assert.equal(countMatches(staticPromptSection, /\n```\n/g), 1, filePath);
    assert.equal(countMatches(staticPromptSection, /Search my Notion and GitHub/g), 1, filePath);
    assert.equal(countMatches(staticPromptSection, /```text\nSearch my Notion and GitHub/g), 1, filePath);
    assert.doesNotMatch(scheduled, /```text\nSearch my Notion and GitHub[\s\S]*?\n```text\nSearch my Notion and GitHub/, filePath);
  }
});

test('Knowledge Index test fixture keeps fake Notion data source sentinel', () => {
  assert.equal(fakeDataSourceId, 'collection://replace-with-your-notion-data-source-id');
  assert.match(fakeDataSourceId, /^collection:\/\/[a-z-]+$/);
  assert.doesNotMatch(fakeDataSourceId, realDataSourceIdPattern);
});

test('Knowledge Index property-only Notion page updates include empty content updates', () => {
  for (const filePath of [sourceSkill, generatedSkill]) {
    const text = read(filePath);
    const updatePayloads = section(text, '### Property-only Notion page updates', '###');

    assert.match(updatePayloads, /"command": "update_properties"/, filePath);
    assert.match(updatePayloads, /"content_updates": \[\]/, filePath);
    assert.match(updatePayloads, /"GitHub Key"/, filePath);
    assert.match(updatePayloads, /"Status"/, filePath);
    assert.match(updatePayloads, /batched page updates/i, filePath);
  }
});

test('Knowledge Index proposes meaningful writes with explicit format and confirmation question', () => {
  for (const { filePath } of sourceFiles) {
    const text = read(filePath);
    const updateSection = updateSectionFor(filePath, text);

    assert.match(updateSection, /Default mode is \*\*audit\/propose first\*\*/i, filePath);
    assert.match(updateSection, /No meaningful write may happen unless the user gives explicit current-turn approval for the exact write or exact batch of writes\./i, filePath);
    assert.match(updateSection, /\*\*Target:\*\* `.*`/, filePath);
    assert.match(updateSection, /\*\*Write type:\*\* `.*`/, filePath);
    assert.match(updateSection, /\*\*Current data:\*\* `<current value or compact current row summary>`/, filePath);
    assert.match(updateSection, /\*\*Suggested data:\*\* `<suggested replacement>`/, filePath);
    assert.match(updateSection, /\*\*Reason:\*\* `<why this update is suggested>`/, filePath);
    assert.match(updateSection, /\*\*Do you want me to apply these proposed writes\?\*\*/, filePath);
    assert.match(updateSection, /If the user approves only some items, apply only those approved items\./, filePath);
  }
});

test('Knowledge Index scheduled updater prompt requires explicit approval for meaningful writes', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    const scheduled = section(text, '### 7. Scheduled updater behaviour');

    assert.doesNotMatch(scheduled, /unless the user\s+explicitly requested automatic updates/i, filePath);
    assert.match(scheduled, /Scheduled runs must propose meaningful writes instead of applying them automatically\./, filePath);
    assert.match(scheduled, /Do not apply meaningful writes to existing rows without current-turn confirmation\./, filePath);
    assert.match(scheduled, /Any meaningful write still requires explicit current-turn confirmation, including row creation\./, filePath);
    assert.match(scheduled, /Do not add or update rows, identity keys, source fields, archive\/delete state, or merge operations without explicit current-turn confirmation\./, filePath);
    assert.match(scheduled, /Do not refresh `Last checked` for rows with pending proposed meaningful changes until the proposal is approved or rejected\./, filePath);
  }
});

test('Knowledge Index scheduled updater proposal format includes required fields', () => {
  for (const filePath of [sourceSkill, generatedSkill]) {
    const text = read(filePath);
    const scheduled = section(text, '### 7. Scheduled updater behaviour');

    assert.match(scheduled, /- \*\*Target:\*\* /, filePath);
    assert.match(scheduled, /- \*\*Write type:\*\* /, filePath);
    assert.match(scheduled, /- \*\*Current data:\*\* /, filePath);
    assert.match(scheduled, /- \*\*Suggested data:\*\* /, filePath);
    assert.match(scheduled, /- \*\*Reason:\*\* /, filePath);
    assert.match(scheduled, /If confirmation is unavailable, report the proposed writes instead of applying them\./, filePath);
    assert.match(scheduled, /\*\*Do you want me to apply these proposed writes\?\*\*/, filePath);
  }
});

test('Knowledge Index explicitly requires confirmation for meaningful writes and row creation', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    const updateSection = section(text, '### Existing row update confirmation', '###');

    const requiredMeanings = [
      'Creating a Notion page/row.',
      'Updating `Category`.',
      'Updating `Name`.',
      'Updating `Description`.',
      'Updating `Status`.',
      'Updating `Visibility`.',
      'Updating `Source`.',
      'Updating `Notion Key`.',
      'Updating `GitHub Key`.',
      'Updating `Canonical Key`.',
      'Archiving rows.',
      'Deleting rows.',
      'Appending source identity data to an existing row.',
      'Adding, changing, or merging `Source`.',
      'Adding, changing, or merging `Notion Key`.',
      'Adding, changing, or merging `GitHub Key`.',
      'Adding, changing, or merging `Canonical Key`.',
    ];

    for (const phrase of requiredMeanings) {
      assert.match(updateSection, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), filePath);
    }
    assert.match(updateSection, /Do not apply any meaningful write without confirmation\./, filePath);
    assert.match(updateSection, /If approval is not available, report the proposed writes and reasons instead of applying them\./, filePath);
  }
});

test('Knowledge Index does not treat safe wording as confirmation bypass', () => {
  for (const { filePath } of sourceFiles) {
    const text = read(filePath);
    assert.doesNotMatch(text, /safe non-destructive/i, filePath);
    assert.doesNotMatch(text, /batch-style.*without confirmation/i, filePath);
    assert.doesNotMatch(text, /go ahead and.*apply/i, filePath);
    assert.doesNotMatch(text, /automation prompt .*authori[sz]es.*write/i, filePath);
    assert.doesNotMatch(text, /repo subpath/i, filePath);
    assert.doesNotMatch(text, /github\.com\/<owner>\/<repo>\/\.\.\./, filePath);
  }
});

test('Knowledge Index explicitly documents batch write rules', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    const updateSection = section(text, '### Existing row update confirmation', '###');

    assert.match(updateSection, /Special rule for batch writes:/, filePath);
    assert.match(updateSection, /Batch writes are allowed without confirmation only when every item in the batch is a pure `Last checked` refresh for a row with no meaningful changes\./, filePath);
    assert.match(updateSection, /If a batch contains even one meaningful write, propose meaningful writes first and request confirmation before applying anything\./, filePath);
  }
});

test('Knowledge Index allows only pure Last checked refreshes without confirmation', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    const updateSection = section(text, '### Existing row update confirmation', '###');

    assert.match(updateSection, /`Last checked` may be refreshed without confirmation only when all conditions are true:/, filePath);
    assert.match(updateSection, /1\.\s*The user requested a check\/update\/sync\/review run\./, filePath);
    assert.match(updateSection, /2\.\s*The row already exists\./, filePath);
    assert.match(updateSection, /3\.\s*No meaningful field changes are needed for that row\./, filePath);
    assert.match(updateSection, /4\.\s*The write changes only `Last checked`\./, filePath);
    assert.match(updateSection, /5\.\s*No other property, identity key, source field, status, visibility, title, description, archive\/delete state, or content changes are included\./, filePath);
    assert.match(updateSection, /If a row has any proposed meaningful change, do not refresh `Last checked` for that row until the user approves or rejects the proposed change\./, filePath);
  }
});

test('Knowledge Index documents the required Last checked refresh reporting format', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    const updateSection = section(text, '### Existing row update confirmation', '###');

    assert.match(updateSection, /#### Refreshed without confirmation/i, filePath);
    assert.match(updateSection, /- `<NAME>` - `Last checked` refreshed because no meaningful changes were found\./, filePath);
    assert.doesNotMatch(updateSection, /- `<NAME>`\s*[\u2013\u2014\u2015]\s*`Last checked` refreshed because no meaningful changes were found\./, filePath);
    assert.match(updateSection, /If approval is not available, report the proposed writes and reasons instead of applying them\./, filePath);
  }
});
test('Knowledge Index README documents same proposal-first rule', () => {
  for (const filePath of [sourceReadme, generatedReadme]) {
    const text = read(filePath);
    const updateSection = section(text, '## Existing row update confirmation', '##');
    assert.match(updateSection, /No meaningful write may happen unless the user gives explicit current-turn approval for the exact write or exact batch of writes\./, filePath);
    assert.match(updateSection, /If the user approves only some items, apply only those approved items\./, filePath);
    assert.match(updateSection, /Batch refresh without confirmation is allowed only when every batch item is a pure `Last checked` refresh for a row with no meaningful changes\./, filePath);
    assert.match(updateSection, /Refresh only `Last checked` when the row already exists, no meaningful change is needed for that row, and the user requested a check\/update run\./, filePath);
    assert.match(updateSection, /## Existing row update confirmation/, filePath);
  }
});

test('Knowledge Index preserves strict scheduled safety rules', () => {
  for (const filePath of skillFiles) {
    const text = read(filePath);
    assert.match(text, /Do not apply any meaningful write without confirmation\./, filePath);
    assert.match(text, /Scheduled runs must propose meaningful writes instead of applying them automatically\./, filePath);
    assert.match(text, /Add new canonical rows only when no key or clear real-world match exists, with explicit current-turn confirmation\./, filePath);
    assert.match(text, /Only pure `Last checked` refreshes[\s\S]*approval-free/i, filePath);
  }
});

test('Knowledge Index still permits read/search/proposal-only work without confirmation', () => {
  for (const { filePath } of sourceFiles) {
    const text = read(filePath);
    const updateSection = updateSectionFor(filePath, text);
    const allowedWork = /Allowed without confirmation:[\s\S]*Search\/read Notion[\s\S]*Search\/read GitHub[\s\S]*Compare current data against desired data[\s\S]*Produce a proposed change list[\s\S]*Explain what would be written if approved/i;
    assert.match(updateSection, allowedWork, filePath);
  }
});
