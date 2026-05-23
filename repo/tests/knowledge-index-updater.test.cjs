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
