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

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function section(text, heading, nextHeadingLevel = '##') {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading ${heading}`);
  const next = text.indexOf(`\n${nextHeadingLevel} `, start + heading.length);
  return next === -1 ? text.slice(start) : text.slice(start, next);
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

test('Knowledge Index tests use a clearly fake Notion data source ID sentinel', () => {
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

test('Knowledge Index requires confirmation before non-trivial existing row updates', () => {
  for (const filePath of [sourceSkill, generatedSkill]) {
    const text = read(filePath);
    const updateConfirmation = section(text, '### Existing row update confirmation', '###');
    const scheduled = section(text, '### 7. Scheduled updater behaviour');

    assert.match(updateConfirmation, /Existing rows are treated as user-confirmed unless the user explicitly asks for automatic updates\./, filePath);
    assert.match(updateConfirmation, /When an existing Knowledge Index row already exists and a non-trivial update seems needed, do not write immediately\./, filePath);
    assert.match(updateConfirmation, /1\. \*\*<NAME>:\*\*[\s\S]*- \*\*Current data:\*\* `<current value or compact current row summary>`[\s\S]*- \*\*Suggested data:\*\* `<suggested replacement>`[\s\S]*- \*\*Reason:\*\* `<why this update is suggested>`/, filePath);
    assert.match(updateConfirmation, /2\. \*\*<NAME>:\*\*[\s\S]*- \*\*Current data:\*\* `<current value or compact current row summary>`[\s\S]*- \*\*Suggested data:\*\* `<suggested replacement>`[\s\S]*- \*\*Reason:\*\* `<why this update is suggested>`/, filePath);
    assert.match(updateConfirmation, /\*\*Do you want me to apply these suggested updates\?\*\*/, filePath);
    assert.match(updateConfirmation, /Do not update existing `Name`, `Category`, `Description`, `Source`, `Notion Key`, `GitHub Key`, `Visibility`, `Status`, or other meaningful fields without confirmation\./, filePath);
    assert.match(updateConfirmation, /Safe refresh fields such as `Last checked` may be updated only if the user requested a check\/update run/, filePath);
    assert.match(updateConfirmation, /If confirmation is unavailable, report the suggested changes instead of applying them\./, filePath);
    assert.match(scheduled, /Treat existing rows as user-confirmed unless I explicitly ask for automatic updates\./, filePath);
    assert.match(scheduled, /Do not update existing `Name`, `Category`, `Description`, `Source`, `Notion Key`, `GitHub Key`, `Visibility`, `Status`, or other meaningful fields without confirmation\./, filePath);
    assert.doesNotMatch(scheduled, /Update `Name`, `Category`, `Description`, `Source`, `Notion Key`, `GitHub Key`, `Visibility`, `Status`, and `Last checked`\./, filePath);
    assert.doesNotMatch(scheduled, /For safe non-destructive creates and updates, proceed without asking me for extra confirmation\./, filePath);
  }
});

test('Knowledge Index README documents existing row update confirmation', () => {
  for (const filePath of [sourceReadme, generatedReadme]) {
    const text = read(filePath);
    const updateConfirmation = section(text, '## Existing row update confirmation');

    assert.match(updateConfirmation, /Existing rows are treated as user-confirmed unless the user explicitly asks for automatic updates\./, filePath);
    assert.match(updateConfirmation, /1\. \*\*<NAME>:\*\*[\s\S]*- \*\*Current data:\*\* `<current value or compact current row summary>`[\s\S]*- \*\*Suggested data:\*\* `<suggested replacement>`[\s\S]*- \*\*Reason:\*\* `<why this update is suggested>`/, filePath);
    assert.match(updateConfirmation, /\*\*Do you want me to apply these suggested updates\?\*\*/, filePath);
    assert.match(updateConfirmation, /Do not update existing `Name`, `Category`, `Description`, `Source`, `Notion Key`, `GitHub Key`, `Visibility`, `Status`, or other meaningful fields without confirmation\./, filePath);
  }
});

test('Knowledge Index README documents only Notion and GitHub hard identity keys', () => {
  for (const filePath of [sourceReadme, generatedReadme]) {
    const text = read(filePath);
    const keyRule = section(text, '## Key rule');
    const view = section(text, '## Default view');

    assert.match(keyRule, /`Notion Key` and `GitHub Key` are the only hard identity fields\./, filePath);
    assert.match(keyRule, /Do not use `Canonical Key` for matching, creating, merging, or deduplication\./, filePath);
    assert.doesNotMatch(keyRule, /Canonical Key = stable-slug/, filePath);
    assert.doesNotMatch(view, /^\s*\d+\.\s+Canonical Key$/m, filePath);
  }
});
