'use strict';

const state = require('./programme-state.cjs');
const audit = require('./decision-trace-audit.cjs');
const { commentTag } = require('./decision-tags.cjs');

const SECTIONS = ['PROBLEM', 'FIX', 'IF WE SKIP', 'DONE WHEN', 'NOT IN SCOPE'];
const LABELS = new Map([...SECTIONS.map(label => [label, label]), ['THE PROBLEM', 'PROBLEM'], ['THE FIX', 'FIX'], ['IF WE SKIP IT', 'IF WE SKIP']]);
const BLOCKS = ['STATE', 'TRACE', 'NAV', 'CURRENT', 'CONTEXT'];
const fail = (code, detail) => { throw new state.ProgrammeError(code, detail); };
const normalLabel = text => text.trim().replace(/[:.]$/, '').toUpperCase();
const placeholder = part => '#preview-comment-' + part;
const base = (repo, number) => audit.issueUrl(repo, number);

// Split only on top-level Markdown. Markers in examples, lists, details and blockquotes
// must stay in their authored span. An unclosed literal block cannot be safely reordered.
function markdownLines(source) {
  const result = [];
  let fence = null, html = null, listIndent = 0;
  const fenceStart = text => {
    const opening = /^ {0,3}(~{3,}|\x60{3,})(.*)$/.exec(text);
    return opening && (opening[1][0] === '~' || !opening[2].includes('\x60')) ? opening[1] : null;
  };
  const detailsDelta = text => /^ {0,3}<\/?details\b/i.test(text)
    ? [...text.matchAll(/<(\/?)details\b[^>]*>/gi)].reduce((depth, match) => depth + (match[1] ? -1 : 1), 0) : 0;
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) break;
    const { index: start } = match;
    const end = start + match[0].length;
    const text = match[0].replace(/\r?\n$/, '');
    const line = { start, end, text, top: false };
    result.push(line);
    if (fence) {
      const closing = /^ {0,3}([~\x60]+)[ \t]*$/.exec(text);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length && [...closing[1]].every(char => char === fence[0])) fence = null;
      continue;
    }
    if (html) {
      if (html.details) {
        fence = fenceStart(text);
        if (!fence) {
          html.details += detailsDelta(text);
          if (html.details <= 0) html = null;
        }
      } else if (html.until?.test(text) || html.blank && !text.trim()) html = null;
      continue;
    }
    if (!text.trim()) continue;
    const indent = /^ */.exec(text)[0].length;
    if (listIndent && indent >= listIndent || /^(?: {4}| {0,3}\t| {0,3}>)/.test(text)) continue;
    listIndent = 0;
    const list = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(text);
    if (list) listIndent = list[0].length;
    fence = fenceStart(text);
    if (fence) continue;
    line.top = true;
    if (/^ {0,3}<details\b/i.test(text)) {
      const details = detailsDelta(text);
      if (details > 0) html = { details };
      continue;
    }
    const literal = /^ {0,3}<(script|pre|style|textarea)\b/i.exec(text);
    if (literal) {
      const until = new RegExp('</' + literal[1] + '\\s*>', 'i');
      if (!until.test(text)) html = { until };
    } else if (/^ {0,3}<!--/.test(text) && !text.includes('-->')) html = { until: /-->/ };
    else if (/^ {0,3}<(?:\/?[a-z][\w-]*(?:\s[^<>]*)?\/?>|[!?])/i.test(text) && !/^ {0,3}<!--.*-->[ \t]*$/.test(text)) html = { blank: true };
  }
  return { lines: result, unfinished: Boolean(fence || html?.until || html?.details) };
}

function previewReferences(prs) {
  const refs = new Map();
  for (const pr of prs) {
    let quoted = false;
    for (const line of markdownLines(pr.page_body || '').lines) {
      if (!line.text.trim()) quoted = false;
      else if (/^ {0,3}>/.test(line.text)) quoted = true;
      if (!line.top || quoted) continue;
      const match = /^ {0,3}(?:[-+*][ \t]+)?(?:refs|closes):?[ \t]+(#\d+(?:(?:[ \t]*,[ \t]*(?:and[ \t]+)?|[ \t]+and[ \t]+)#\d+)*)[ \t]*[.]?[ \t]*$/i.exec(line.text);
      if (!match) continue;
      for (const [, raw] of match[1].matchAll(/#(\d+)/g)) {
        const number = Number(raw);
        if (!refs.has(number)) refs.set(number, []);
        if (!refs.get(number).includes(pr.number)) refs.get(number).push(pr.number);
      }
    }
  }
  return refs;
}

function splitBody(source, names, version, helpers, parent = null) {
  const { lines, unfinished } = markdownLines(source);
  if (unfinished) fail('PAGE_MARKDOWN_HELD', 'Close the unfinished Markdown code or HTML block and run the preview again.');
  const top = new Set(lines.filter(line => line.top).map(line => line.start));
  // Mask literal examples without changing offsets or line endings.
  const masked = lines.map(line => top.has(line.start) ? source.slice(line.start, line.end)
    : source.slice(line.start, line.end).replace(/[^\r\n]/g, ' ')).join('');
  const cuts = [];
  const legacyHeadings = new Set();
  const marker = new RegExp('^\\s*<!--\\s*AI-AGENT-TOOLKIT:' + state.BLOCK_SOURCE.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&') + ':');
  for (const line of lines.filter(line => line.top && marker.test(line.text))) {
    if (!BLOCKS.some(name => line.text.includes('BEGIN ' + name + ' ') || line.text.endsWith('END ' + name + ' -->'))) {
      fail('PAGE_BLOCK_HELD', 'An unfamiliar programme marker needs review before the page can be reformatted.');
    }
  }
  let context = null;
  const readContext = line => {
    const match = /^(?:- )?\[Agent context\]\(([^()\s]+#issuecomment-(\d+))\)(?:[ \t]+[^\[\]<>]*)?[ \t]*$/.exec(line.text);
    if (!match || match[1] !== audit.commentLink(base(parent.repository, parent.number), match[2])) return false;
    if (context) fail('PAGE_CONTEXT_HELD', 'More than one Agent context pointer matches the parent. Confirm which is authoritative.');
    const comment = parent.comments.find(comment => String(comment.id) === match[2] && !audit.isBot(comment));
    if (!comment || commentTag(comment.body) !== 'AGENT CONTEXT' || audit.recordId(comment.body, parent.prefix)
      || /SUPERSEDES=|<!-- decision-trace-(?:index|directory) -->/i.test(comment.body)) {
      fail('PAGE_CONTEXT_HELD', 'The Agent context pointer has no verified background-only comment on this issue. Retain the pointer and review the original.');
    }
    context = { id: match[2], line: line.text };
    return true;
  };
  for (const name of BLOCKS) {
    const { block, error } = state.findStateBlock(masked, name);
    if (error) fail('PAGE_BLOCK_HELD', error);
    if (!block) continue;
    if (!names.includes(name)) fail('PAGE_BLOCK_HELD', 'A managed section belongs to a different page type.');
    if (version && helpers.versionNewer(block.version, version)) fail('BLOCK_NEWER_TOOLKIT', 'Update Toolkit to at least ' + block.version + ' and run the preview again.');
    const original = state.findStateBlock(source.slice(block.start, block.end), name);
    if (!original.block || original.block.tampered) fail('PAGE_BLOCK_HELD', 'The ' + name + ' section has edits or malformed markers. Review it before reformatting.');
    if (name === 'CONTEXT' && parent) {
      for (const line of lines.filter(line => line.start > block.start && line.end <= block.end)) readContext(line);
    }
    if (name === 'CURRENT' && parent) {
      const adjacent = /^## CURRENT\r?\n(?:[ \t]*\r?\n)*$/m.exec(source.slice(0, block.start));
      if (adjacent && adjacent.index + adjacent[0].length === block.start && top.has(adjacent.index)) legacyHeadings.add(adjacent.index);
    }
    const last = lines.find(line => line.start <= block.end && block.end < line.end);
    cuts.push({ start: block.start, end: last?.end ?? block.end });
  }

  const extra = [];
  const specs = new Map();
  let section = 'MORE', start = 0;
  const keep = end => {
    const text = source.slice(start, end);
    if (!text.trim()) return;
    const span = { start, end, text };
    if (section === 'MORE') extra.push(span);
    else if (specs.has(section)) fail('PAGE_SECTION_HELD', 'The ' + section + ' section appears more than once. Combine it before reformatting.');
    else specs.set(section, span);
  };
  const seen = new Set();
  for (const line of lines) {
    if (!line.top) continue;
    const cut = cuts.find(span => span.start <= line.start && line.start < span.end);
    if (cut) {
      if (cut.start === line.start) { keep(line.start); start = cut.end; section = 'MORE'; }
      continue;
    }
    if (legacyHeadings.has(line.start) || parent && readContext(line)) { keep(line.start); start = line.end; continue; }
    const heading = /^ {0,3}(#{1,2})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line.text);
    const label = /^(\*\*([^*]+)\*\*:?[ \t]*)(.*)$/.exec(line.text);
    const name = heading ? normalLabel(heading[2]) : label ? normalLabel(label[2]) : null;
    const known = !parent && LABELS.get(name);
    if (!heading && !known) continue;
    if (heading?.[1] === '##' && !known && name !== 'MORE') continue;
    keep(line.start);
    if (known || name === 'MORE') {
      const canonical = known || 'MORE';
      if (seen.has(canonical)) fail('PAGE_SECTION_HELD', 'The ' + canonical + ' heading appears more than once.');
      seen.add(canonical);
      section = canonical;
      start = label && label[3] ? line.start + label[1].length : line.end;
    } else {
      section = 'MORE';
      start = line.start;
    }
  }
  keep(source.length);
  if (context && [...extra, ...specs.values()].some(span => span.text.includes('#issuecomment-' + context.id))) {
    fail('PAGE_CONTEXT_HELD', 'Another authored link points to the Agent context comment. Review that link before moving the pointer.');
  }
  return { specs, extra, context, eol: source.includes('\r\n') ? '\r\n' : '\n' };
}

function pageBody(layout, generated, moved, version) {
  const { specs, extra, eol } = layout;
  const append = (left, right) => {
    if (!left || !right) return left + right;
    const breaks = /(?:\r?\n){1,2}$/.exec(left)?.[0].match(/\n/g).length || 0;
    return left + eol.repeat(2 - breaks) + right;
  };
  let text = generated.reduce((body, [name, content]) =>
    append(body, state.renderBlock(content, version, name).replace(/\n/g, eol)), '');
  for (const name of SECTIONS) {
    const span = specs.get(name);
    if (span) text = append(text, '# ' + name + eol + (/^\r?\n/.test(span.text) ? '' : eol) + span.text);
  }
  if (extra.length) {
    const more = extra.reduce((body, span) => append(body, moved.get(span)?.link || span.text), '');
    text = append(text, '# MORE' + eol + (/^\r?\n/.test(more) ? '' : eol) + more);
  }
  return text.endsWith(eol) ? text : text + eol;
}

function previewPage(source, layout, kind, number, project, budget, limit, maxComment) {
  const moved = new Map();
  const history = [];
  const attempt = () => project(moved, history);
  let result = attempt();
  const fits = () => result.body.length < limit && !result.refused && (result.parts?.length || 0) + moved.size + history.length <= budget;
  // A definition, anchor or issue reference can affect Markdown or GitHub behaviour elsewhere
  // in the body. Leave that span in place. Complete remaining spans can move individually.
  const protectedText = /#\d+|\/issues\/\d+|\/pull\/\d+|#issuecomment-|\[[^\]\n]+\](?!\()|<[^>\n]+\b(?:id|name)\s*=/i;
  if (!fits() && result.continuation?.length && budget > 0) {
    history.push(result.continuation[0]);
    result = attempt();
  }
  if (!fits()) {
    for (const span of [...layout.extra].sort((a, b) => b.text.length - a.text.length || a.start - b.start)) {
      if (moved.size + history.length >= budget) break;
      if (protectedText.test(span.text) || /(?:^|\n) {0,3}(?:~~~|\x60\x60\x60)/.test(span.text) && !span.text.endsWith('\n')) continue;
      const id = moved.size + 1;
      const hash = state.sha256(span.text);
      const envelope = '<!-- page-preview section=MORE start=' + span.start + ' end=' + span.end + ' sha256=' + hash + ' -->\n';
      if (envelope.length + span.text.length >= maxComment || span.text.length <= 96) continue;
      const anchor = 'more-' + kind + '-' + number + '-' + id;
      moved.set(span, { section: 'MORE', anchor, link: '[Extra text, part ' + id + '](' + placeholder(anchor) + ')', start: span.start, end: span.end,
        sha256: hash, text: span.text, comment: envelope + span.text });
      result = attempt();
      if (fits()) break;
    }
  }
  if (!fits()) return { kind, number, status: 'held', length: result.body.length, code: 'PAGE_SIZE_HELD',
    detail: 'The page cannot fit below ' + limit + ' characters within the preview budget while keeping operational text intact.' };
  const body = result.previewBody || result.body;
  return { kind, number, status: source === body ? 'unchanged' : 'proposed', body,
    overflow: [...(result.parts || []), ...history, ...[...moved.values()].sort((a, b) => a.start - b.start)] };
}

function previewPages(reconciler, only, helpers) {
  const { store, reader, binding } = reconciler;
  const { repository, parent_issue: parentNumber, record_prefix: prefix } = binding;
  const version = reconciler.toolkitVersion || '0.0.0';
  const limit = Math.min(state.SAFE_LIMIT, reconciler.threshold);
  const report = { mode: 'page-preview', repository, parent_issue: parentNumber, pages: [], holds: [], writes: { state: 0, github: 0 } };
  const hold = (kind, number, code, detail) => report.holds.push({ target: (kind === 'pr' ? 'PR ' : '') + '#' + number, code, detail });
  let budget = helpers.MAX_TOPIC_COMMENTS_PER_PASS;
  const readPage = (kind, number, action) => {
    try { return action(); }
    catch (error) {
      if (!error.code || ['GH_AUTH', 'PASS_STOPPED', 'PAGE_PREVIEW_WRITE_REFUSED'].includes(error.code)) throw error;
      hold(kind, number, error.code, error.message);
      return null;
    }
  };
  const stored = readPage('parent', parentNumber, () => {
    const { doc } = store.read('parent', parentNumber);
    if (!doc || doc.parent_issue !== parentNumber || doc.repository.toLowerCase() !== repository.toLowerCase()) {
      fail('PAGE_PARENT_UNAVAILABLE', 'A parent state document matching this repository and issue is required.');
    }
    return doc;
  });
  if (!stored) return report;
  const issues = new Map();
  const readIssue = number => {
    if (!issues.has(number)) issues.set(number, readPage('issue', number, () => reader.issue(number)));
    return issues.get(number);
  };
  const outcomes = [...stored.outcomes];
  const known = new Set([parentNumber, ...outcomes.map(outcome => outcome.issue)]);
  const registered = new Set(helpers.registeredParents(binding));
  const adopted = new Set();
  let order = Math.max(0, ...outcomes.map(outcome => outcome.order));
  for (const number of [parentNumber, ...stored.outcomes.map(outcome => outcome.issue)]) {
    const issue = readIssue(number);
    if (!issue?.complete || issue.is_pull_request || number !== parentNumber && registered.has(number)) continue;
    const children = readPage('issue', number, () => reader.subIssues(number));
    for (const child of children || []) {
      if (known.has(child.number) || registered.has(child.number)) continue;
      const native = readIssue(child.number);
      if (!native?.complete || native.is_pull_request || native.parent !== number || native.id !== child.id) continue;
      known.add(child.number);
      adopted.add(child.number);
      outcomes.push({ issue: child.number, label: native.title, class: 'COMMITTED', parent: number, order: ++order });
    }
  }
  if (only && !outcomes.some(outcome => outcome.issue === only)) {
    fail('USAGE', '#' + only + ' is not a catalogued or verified native task.');
  }
  const parent = { ...stored, outcomes };
  const children = new Map();
  const docs = new Map();
  for (const outcome of outcomes) {
    reconciler.pass.planning();
    const number = outcome.issue;
    const entry = readPage('issue', number, () => store.read('child', number));
    if (!entry) continue;
    const doc = entry.doc || state.newChild({ repository, outcome });
    if (doc.repository.toLowerCase() !== repository.toLowerCase() || doc.issue !== number) {
      hold('issue', number, 'PAGE_CHILD_UNAVAILABLE', 'The task state belongs to a different repository or issue.');
      continue;
    }
    children.set(number, entry);
    docs.set(number, adopted.has(number) ? helpers.copyIssueLifecycle(doc, issues.get(number)) : doc);
  }
  const cache = new Map();
  const readPr = number => {
    if (!cache.has(number)) cache.set(number, reader.pullRequest(number));
    return cache.get(number);
  };
  const graph = reconciler.discoverGraph(parent, outcomes, children, new Map(), cache, readPr, true);
  const latest = new Map();
  for (const outcome of outcomes) {
    const number = outcome.issue;
    const complete = graph.discovery.get(number)?.complete === true && children.has(number);
    const facts = graph.historyFacts.get(number) || [];
    const sorted = [...facts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.number - a.number);
    latest.set(number, complete ? (sorted.length ? '#' + sorted[0].number : '-') : 'Unavailable');
    if (!complete) hold('issue', number, 'PAGE_PR_HISTORY_INCOMPLETE', 'PR history is incomplete. Known entries are shown on the task; the parent selection is unavailable.');
  }
  if (!graph.openComplete) hold('parent', parentNumber, 'PAGE_OPEN_PRS_INCOMPLETE', 'The open PR list could not be read completely. Run the preview again.');

  const comments = new Map();
  for (const number of [parentNumber, ...outcomes.filter(outcome => !only || outcome.issue === only || helpers.graphClass(outcome, docs.get(outcome.issue)) === 'NOW')
    .map(outcome => outcome.issue)]) {
    if (!issues.get(number)?.complete || issues.get(number).is_pull_request) continue;
    comments.set(number, readPage('issue', number, () => reader.comments(number)));
  }
  const traceParts = (number, projection) => projection.overflow.flatMap(part =>
    helpers.indexCommentBodies(number, part.lines, '0'.repeat(16), part.tag, part.label, part.directory)
      .map((comment, index) => ({ section: 'COMMENT TRACE', id: part.previewIds?.[index], comment })));
  const renderWithContinuations = (number, layout, generated, moved, parts) => {
    const anchors = parts.map((part, index) => ({ ...part, anchor: number + '-' + (index + 1) }));
    const replace = text => anchors.reduce((value, part) => part.id
      ? value.replaceAll(audit.commentLink(base(repository, number), part.id), placeholder(part.anchor)) : value, text);
    return { previewBody: pageBody(layout, generated.map(([name, text]) => [name, replace(text)]), moved, version),
      parts: anchors.map(({ id, comment, ...part }) => ({ ...part, comment: replace(comment) })) };
  };
  const proposal = (kind, number, source, layout, project) => {
    const page = previewPage(source, layout, kind, number, project, budget, limit, helpers.INDEX_COMMENT_LIMIT);
    const errors = [];
    state.screenSecrets(errors, [page.body, ...((page.overflow || []).map(part => part.comment))], 'preview');
    if (errors.length) fail('PAGE_CONTENT_HELD', 'A secret-shaped value was detected. Review the page and continuation inputs before previewing their text.');
    report.pages.push(page);
    if (page.status === 'held') hold(kind, number, page.code, page.detail);
    else budget -= page.overflow.length;
  };
  const foreignParent = issue => typeof issue?.parent === 'string' || registered.has(issue?.parent) && issue.parent !== parentNumber;
  const sourceFor = (kind, number) => {
    const issue = readIssue(number);
    if (!issue?.complete || issue.is_pull_request !== (kind === 'pr') || (kind !== 'pr' && !comments.get(number))) {
      fail('PAGE_READ_INCOMPLETE', 'The page and its required inputs could not be read completely.');
    }
    if (kind === 'issue' && foreignParent(issue)) fail('PAGE_FOREIGN_PARENT', 'This task has a native parent outside this programme. Confirm catalogue ownership first.');
    const errors = [];
    state.screenSecrets(errors, issue.body, 'page');
    if (errors.length) fail('PAGE_CONTENT_HELD', 'A secret-shaped value was detected. Review the source page before previewing its text.');
    return issue.body;
  };
  readPage('parent', parentNumber, () => {
    const source = sourceFor('parent', parentNumber);
    const originals = comments.get(parentNumber);
    const layout = splitBody(source, ['CURRENT', 'STATE', 'CONTEXT', 'TRACE'], version, helpers, { number: parentNumber, repository, prefix, comments: originals });
    const stateBody = state.renderParentBlockBody(parent, docs, issues, comments, latest);
    const current = state.renderCurrentBlockBody(parent, docs, issues, reconciler.now());
    const context = ['# AGENT CONTEXT', '<!-- programme-context -->', '', 'Background for agents that pick up a task.',
      ...(layout.context ? ['', layout.context.line] : [])].join('\n');
    const trace = input => audit.traceEntries(input, prefix, repository, parentNumber, layout.context?.id ?? null);
    proposal('parent', parentNumber, source, layout, moved => {
      const generated = parts => [['CURRENT', parts.currentBody], ['STATE', parts.stateBody], ['CONTEXT', parts.context], ['TRACE', parts.traceBody]];
      const built = reconciler.projectParentPage(parentNumber, source, stateBody, originals, version, null, current, null, budget - moved.size, {
        parent, context, trace, preview: true, traceTopicBudget: budget - moved.size,
        build: parts => pageBody(layout, generated(parts), moved, version),
      });
      return { body: built.body, refused: built.refused, ...renderWithContinuations(parentNumber, layout, generated(built.sections), moved, [
        ...built.previewGraphParts.map(part => ({ section: 'PROGRAMME GRAPH', ...part })), ...traceParts(parentNumber, built),
      ]) };
    });
  });

  const selected = outcomes.filter(outcome => !only || outcome.issue === only);
  for (const outcome of selected) readPage('issue', outcome.issue, () => {
    const number = outcome.issue;
    const doc = docs.get(number);
    if (!doc) return;
    const source = sourceFor('issue', number);
    const layout = splitBody(source, ['NAV', 'STATE', 'TRACE'], version, helpers);
    const facts = graph.historyFacts.get(number) || [];
    const rank = { OPEN: 0, MERGED: 1, CLOSED: 2 };
    const entries = [...new Map([...(doc.prs || []), ...(doc.pr.number && doc.pr.state ? [doc.pr] : []), ...facts].map(pr => [pr.number, pr])).values()]
      .sort((a, b) => rank[a.state === 'DRAFT' ? 'OPEN' : a.state] - rank[b.state === 'DRAFT' ? 'OPEN' : b.state]
        || (a.state === 'MERGED' ? (Date.parse(b.merged_at) - Date.parse(a.merged_at) || 0) : 0) || b.number - a.number);
    const complete = graph.discovery.get(number)?.complete === true;
    const fullHistory = entries.map(pr => '- [#' + pr.number + '](https://github.com/' + repository + '/pull/' + pr.number + ') ' + (pr.draft ? 'DRAFT' : pr.state)
      + (pr.state === 'MERGED' ? ' ' + helpers.shaLink(repository, pr.merge_sha) : ''));
    const nav = '# PATH\n\n' + reconciler.navFor(parent, number, docs);
    // A generated history suffix can move as one complete continuation, within the same budget.
    const historyPart = fullHistory.length > 1 ? ['# Pull request history', '', ...fullHistory.slice(1)].join('\n') : '';
    const historyAnchor = 'history-' + number;
    const continuation = historyPart && historyPart.length < helpers.INDEX_COMMENT_LIMIT ? [{ section: 'STATUS', anchor: historyAnchor, comment: historyPart }] : [];
    proposal('issue', number, source, layout, (moved, history) => {
      const status = '# STATUS\n\n' + state.renderChildBlockBody(doc, outcome, [
        '**Pull request history' + (complete ? '' : ' (incomplete)') + '**',
        ...(history.length ? [fullHistory[0], '- [More pull requests](' + placeholder(historyAnchor) + ')'] : fullHistory.length ? fullHistory
          : [complete ? '- None recorded.' : '- No verified entries available.']),
      ]);
      const generated = parts => [['NAV', parts.navBody], ['STATE', parts.stateBody], ['TRACE', '# COMMENT TRACE\n\n' + parts.traceBody]];
      const built = reconciler.projectTrace(number, source, status, comments.get(number), version, nav, null, reconciler.topicFor(parent, number, issues),
        budget - moved.size - history.length, { threshold: limit, preview: true, build: parts => pageBody(layout, generated(parts), moved, version) });
      return { body: built.body, refused: built.refused, continuation,
        ...renderWithContinuations(number, layout, generated(built.sections), moved, traceParts(number, built)) };
    });
  });

  const references = graph.openReferences;
  for (const listed of graph.openListed) {
    const paths = outcomes.filter(outcome => !foreignParent(issues.get(outcome.issue)) && references.get(outcome.issue)?.includes(listed.number));
    if (!paths.length || only && !paths.some(outcome => outcome.issue === only)) continue;
    readPage('pr', listed.number, () => {
      const number = listed.number;
      const pr = readPr(number);
      if (['MERGED', 'CLOSED'].includes(pr?.state) || readIssue(number)?.state === 'closed') return;
      const source = sourceFor('pr', number);
      if (!pr || pr.number !== number || !['OPEN', 'DRAFT'].includes(pr.state) || !/^[0-9a-f]{40}$/i.test(pr.head || '')
        || listed.head !== pr.head || source !== listed.page_body) {
        fail('PAGE_PR_MOVED', 'The PR body, head or lifecycle could not be confirmed against the open list. Run the preview again.');
      }
      const layout = splitBody(source, ['NAV', 'STATE'], version, helpers);
      const nav = ['# PATH', '', ...paths.map(outcome => '- ' + reconciler.navFor(parent, outcome.issue, new Map()).split('\n').at(-1)
        .replace('**Path:** ', '').replace(/#(\d+)(?!.*#\d+)/, (_full, task) => '[#' + task + '](' + base(repository, task) + ')'))].join('\n');
      const status = ['# STATUS', '', ...paths.map(({ issue }) => {
        const doc = docs.get(issue);
        const verdicts = doc?.review?.verdicts || [];
        const exact = verdicts.filter(verdict => verdict.head === pr.head);
        const review = exact.length ? exact.map(verdict => helpers.publicText(verdict.verdict)).join(', ') : verdicts.length ? 'stale' : doc ? 'pending' : 'unavailable';
        const gate = [doc?.gate?.role, doc?.gate?.state].filter(Boolean).join(' ') || 'unavailable';
        return '- Task #' + issue + ': gate ' + gate + '; review ' + review + ' at ' + pr.head.slice(0, 7) + '; merge route '
          + (doc?.release ? helpers.publicText(doc.release) : 'unavailable') + '; PR base ' + (helpers.publicText(pr.base || 'unavailable')) + '.';
      })].join('\n');
      proposal('pr', number, source, layout, moved => ({ body: pageBody(layout, [['NAV', nav], ['STATE', status]], moved, version) }));
    });
  }
  report.findings = report.pages.filter(page => page.status === 'proposed').map(({ kind, number }) =>
    ({ code: 'PAGE_LAYOUT_DIFFERS', kind, number, detail: 'Review the proposed order and any continuation before enabling live formatting.' }));
  return report;
}

function formatPreview(report) {
  const lines = ['Read-only programme page preview for ' + report.repository + '.',
    'Comment placeholders are local to this report. Programme state writes: 0. GitHub writes: 0.'];
  for (const page of report.pages) {
    lines.push('', (page.kind === 'pr' ? 'Pull request' : page.kind === 'parent' ? 'Programme' : 'Task') + ' #' + page.number + ' (' + page.status + ')');
    if (page.body !== undefined) lines.push('', page.body);
    for (const part of page.overflow || []) {
      lines.push('<a id="' + placeholder(part.anchor).slice(1) + '"></a>',
        'Proposed continuation in ' + part.section + (part.start === undefined ? '' : ' (UTF-16 source offsets ' + part.start + ' to ' + part.end + ', SHA-256 ' + part.sha256 + ')'),
        '', part.text || part.comment);
    }
  }
  for (const hold of report.holds) lines.push('', hold.target + ' ' + hold.code + '. ' + hold.detail);
  return lines.join('\n') + '\n';
}

module.exports = { previewReferences, splitBody, pageBody, previewPage, previewPages, formatPreview };
