'use strict';

const { ProgrammeError } = require('./resolve-executable.cjs');
const { closingReferences } = require('./issue-closure.cjs');
const STORY = '<!-- toolkit-closing kind=story -->';
const FACTS = '<!-- toolkit-closing kind=facts -->';
const COMMENT_READ_CAP = 120;
const PLANNING_READ_CAP = 60;
const POST_CAP = 20;
const key = item => `${item.kind}:${item.number}`;
const after = (comment, item) => Number.isFinite(Date.parse(comment.created_at)) && Date.parse(comment.created_at) > Date.parse(item.closed_at);
const marked = (comments, item, marker) => comments.some(comment => after(comment, item) && comment.body?.includes(marker));

// Owns the bounded closing scan and comment IO. Reconciler owns its durable cursors and the
// existing parent intent journal owns all backstop writes. No separate post ledger exists.
class ClosingComments {
  constructor({ transport, repository, pass = null, screenSecrets }) {
    Object.assign(this, { transport, repository, pass, screenSecrets });
    this.requests = 0;
  }
  beginPass() { this.requests = 0; }
  request(method, path, body) {
    if (this.pass) this.pass.planning();
    const response = this.transport.request(method, `repos/${this.repository}/${path}`, body);
    if (response.status === 401 || response.status === 403) throw new ProgrammeError('GH_AUTH', 'Closing comments need authenticated repository access.');
    if (response.status < 200 || response.status >= 300) throw new ProgrammeError('CLOSING_INCOMPLETE', 'Closing comment evidence could not be read or written.');
    return response.json;
  }
  item(kind, number) {
    const raw = this.request('GET', `${kind === 'pr' ? 'pulls' : 'issues'}/${number}`);
    if (raw.number !== number || (kind === 'issue' && raw.pull_request) || !['open','closed'].includes(raw.state))
      throw new ProgrammeError('CLOSING_INCOMPLETE', 'The closing item identity or state is incomplete.');
    const closed_at = raw.closed_at || raw.merged_at;
    if (raw.state === 'closed' && !Number.isFinite(Date.parse(closed_at))) throw new ProgrammeError('CLOSING_INCOMPLETE', 'The closing time is unavailable.');
    return { kind, number, closed_at, raw };
  }
  comments(item, { page = 1, facts = false, limit = COMMENT_READ_CAP } = {}) {
    while (true) {
      if (this.requests >= limit) return { complete:false, page, facts };
      this.requests++;
      const rows = this.request('GET', `issues/${item.number}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(rows) || rows.some(row => typeof row.body !== 'string' || !Number.isFinite(Date.parse(row.created_at))))
        throw new ProgrammeError('CLOSING_INCOMPLETE', 'Closing comments were not fully readable.');
      facts ||= marked(rows, item, FACTS);
      if (marked(rows, item, STORY)) return { complete:true, story:true, facts };
      if (rows.length < 100) return { complete:true, story:false, facts };
      page++;
    }
  }
  guard(body) {
    if (typeof body !== 'string' || !body.trim() || body.length > 60000) throw new ProgrammeError('CLOSING_BODY_INVALID', 'Supply a non-empty closing story under 60,000 characters.');
    const errors = []; this.screenSecrets(errors, body, 'closing comment');
    if (errors.length) throw new ProgrammeError('SECRET_REFUSED', 'The closing comment contains a secret-shaped value.');
    if (closingReferences(body, this.repository).length) throw new ProgrammeError('CLOSING_REFERENCE', 'Use Refs before issue references in a closing comment.');
    return body;
  }
  story({ kind, number, body, dryRun = false, force = false }) {
    const text = this.guard(`${body.trim()}\n\n${STORY}`);
    const item = this.item(kind, number);
    if (item.raw.state !== 'closed') throw new ProgrammeError('ITEM_OPEN', 'Wait until the item is merged or closed before posting its story.');
    const result = this.comments(item);
    if (!result.complete) throw new ProgrammeError('CLOSING_INCOMPLETE', 'The comment read cap was reached; no story was posted.');
    if (result.story && !force) throw new ProgrammeError('ALREADY_COMMENTED', 'A closing story already exists; --force-another explicitly adds another.');
    if (dryRun) return { outcome:'DRY_RUN', kind, number, body:text };
    // Reconfirm the close immediately before the irreversible append.
    const fresh = this.item(kind, number);
    if (fresh.raw.state !== 'closed' || fresh.closed_at !== item.closed_at) throw new ProgrammeError('CLOSING_MOVED', 'The item changed; read it again before posting.');
    this.request('POST', `issues/${number}/comments`, {body:text});
    if (!this.comments(fresh).story) throw new ProgrammeError('CLOSING_INCOMPLETE', 'The story post could not be verified; read comments before retrying.');
    return { outcome:'POSTED', kind, number };
  }
  closedIssues(watermark) {
    const items = [], cutoff = watermark ? Date.parse(watermark)-5*60000 : null;
    for (let page=1; page<=10; page++) {
      const rows = this.request('GET', `issues?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new ProgrammeError('CLOSING_INCOMPLETE', 'The closed issue list is incomplete.');
      for (const raw of rows) {
        if (!Number.isFinite(Date.parse(raw.updated_at))) throw new ProgrammeError('CLOSING_INCOMPLETE', 'A closed issue update time is unavailable.');
        if (cutoff !== null && Date.parse(raw.updated_at)<cutoff) return items;
        if (raw.pull_request) continue;
        if (!Number.isSafeInteger(raw.number) || !Number.isFinite(Date.parse(raw.closed_at))) throw new ProgrammeError('CLOSING_INCOMPLETE', 'A closed issue is incomplete.');
        items.push({kind:'issue',number:raw.number,closed_at:raw.closed_at});
      }
      if (rows.length<100) return items;
    }
    throw new ProgrammeError('CLOSING_INCOMPLETE', 'The closed issue scan reached ten full pages.');
  }
  scan(parent, graph, now, excluded) {
    const saved = parent.private?.closing_scan || [];
    if (!Array.isArray(saved) || saved.some(item=>!item || !['pr','issue'].includes(item.kind)
      || !Number.isSafeInteger(item.number) || item.number<1
      || Object.keys(item).some(field=>!['kind','number','closed_at','page','facts'].includes(field))
      || item.closed_at!==undefined && !Number.isFinite(Date.parse(item.closed_at))
      || item.page!==undefined && (!Number.isSafeInteger(item.page) || item.page<1)
      || item.facts!==undefined && typeof item.facts!=='boolean'))
      throw new ProgrammeError('STATE_INVALID','Closing scan cursors are invalid; preserve and inspect the parent state.');
    const incomplete = [], seen = [], due = [], checked = new Set(), errors = [];
    const watermark = parent.private?.graph_issue_watermark;
    let issueWatermark = watermark, issues = [], complete = true;
    const start = now();
    this.pass?.phaseAt('closing');
    try {
      issues = this.closedIssues(watermark);
      if (!watermark || issues.some(item=>Date.parse(item.closed_at)>Date.parse(watermark))) issueWatermark=start;
    } catch(error) { if (['GH_AUTH','PASS_STOPPED'].includes(error.code)) throw error; complete=false; errors.push('Closed issue list incomplete; its watermark was kept.'); }
    const candidates = new Map(saved.map(item=>[key(item),item]));
    for (const entry of parent.attention || []) if (entry.code==='CLOSING_COMMENT_MISSING' && ['new','acknowledged'].includes(entry.state))
      candidates.set(`${entry.kind}:${entry.issue}`,candidates.get(`${entry.kind}:${entry.issue}`) || {kind:entry.kind,number:entry.issue});
    if (graph?.closedComplete && graph.watermark) for (const pr of graph.closedListed) {
      if (!excluded(pr) && Date.parse(pr.closed_at)>Date.parse(graph.watermark)) {
        const item={kind:'pr',number:pr.number,closed_at:pr.closed_at}; if (!candidates.has(key(item))) candidates.set(key(item),item);
      }
    }
    if (watermark) for (const item of issues) if (Date.parse(item.closed_at)>Date.parse(watermark) && !candidates.has(key(item))) candidates.set(key(item),item);
    this.pass?.phaseAt('closing', candidates.size);
    for (const candidate of candidates.values()) {
      if (this.requests>=PLANNING_READ_CAP) { incomplete.push(candidate); continue; }
      try {
        const item=this.item(candidate.kind,candidate.number);
        if (item.raw.state!=='closed') { incomplete.push(candidate); continue; } // Only a story settles this finding.
        if (item.kind==='pr' && excluded({author:item.raw.user?.login,branch:item.raw.head?.ref})) { checked.add(key(item)); continue; }
        const cursor=candidate.closed_at===item.closed_at ? candidate : {};
        const result=this.comments(item,{...cursor,limit:PLANNING_READ_CAP});
        if (!result.complete) { incomplete.push({kind:item.kind,number:item.number,closed_at:item.closed_at,page:result.page,facts:result.facts}); continue; }
        checked.add(key(item));
        if (!result.story) {
          seen.push({code:'CLOSING_COMMENT_MISSING',issue:item.number,kind:item.kind,detail:'The closing agent posts the missing story with closing-comment; facts alone leave it waiting.'});
          const prior=(parent.attention || []).find(e=>e.code==='CLOSING_COMMENT_MISSING' && e.kind===item.kind && e.issue===item.number);
          if (!result.facts && prior && ['new','acknowledged'].includes(prior.state) && Date.parse(now())-Date.parse(prior.first_seen)>=24*3600000 && due.length<POST_CAP) due.push(item);
        }
      } catch(error) {
        if (['GH_AUTH','PASS_STOPPED'].includes(error.code)) throw error;
        incomplete.push(candidate);
      }
    }
    return {incomplete,seen,due,checked,complete,issueWatermark,requests:this.requests,errors};
  }
  facts(item, children) {
    const raw=item.raw, lines=['Closing facts only. The closing story is still needed.'];
    if (item.kind==='pr' && raw.merged_at) {
      const sha=raw.merge_commit_sha;
      let version='not recorded', branch='not recorded';
      if (/^[0-9a-f]{40}$/.test(sha || '')) {
        this.pass?.planning();
        const response=this.transport.request('GET',`repos/${this.repository}/contents/repo/contracts/toolkit-local-bridge/version.json?ref=${sha}`);
        if (response.status===200) { try { const v=JSON.parse(Buffer.from(response.json.content,'base64').toString()).version; if (/^\d+\.\d+\.\d+$/.test(v)) version=v; } catch { /* Missing recorded version. */ } }
      }
      if (raw.head?.ref) {
        this.pass?.planning();
        const response=this.transport.request('GET',`repos/${this.repository}/git/ref/heads/${encodeURIComponent(raw.head.ref)}`);
        if (response.status===404) branch='yes'; else if(response.status===200) branch='no';
      }
      lines.push(`Merged commit: ${sha ? sha.slice(0,7) : 'not recorded'}. Version: ${version}. Branch deleted: ${branch}.`);
      const { referencedIssues }=require('./programme-state.cjs');
      const references=referencedIssues([{number:item.number,body:[raw.title,raw.body].filter(Boolean).join('\n')}]);
      for (const [number] of references) {
        const linked=this.item('issue',number);
        lines.push(`Refs #${number}: ${linked.raw.state}.`);
      }
      let linkedTask=false;
      for (const [number,entry] of children) {
        const doc=entry.doc || entry;
        if (doc.pr?.number===item.number || doc.prs?.some(pr=>pr.number===item.number)) {
          linkedTask=true;
          lines.push(`Task ${number}: G2 ${doc.review?.state || 'not recorded'}; UAT ${doc.uat?.state || 'not recorded'}.`);
          for (const verdict of doc.review?.verdicts || []) lines.push(`G2 ${verdict.reviewer}: ${verdict.verdict} at ${verdict.head}.`);
          if (doc.uat?.at_head) lines.push(`UAT head: ${doc.uat.at_head}.`);
        }
      }
      if (!linkedTask) lines.push('G2 and UAT: not recorded for a linked task.');
    } else if (item.kind==='pr') {
      // closed_by is not part of the PR resource; use the closure event actor.
      let event=null;
      for (let page=1;page<=10;page++) {
        const events=this.request('GET',`issues/${item.number}/events?per_page=100&page=${page}`);
        if (!Array.isArray(events)) throw new ProgrammeError('CLOSING_INCOMPLETE','Closure events are unreadable.');
        event=events.filter(e=>e.event==='closed' && e.created_at===item.closed_at).at(-1) || event;
        if (event || events.length<100) break;
      }
      lines.push(`Closed by ${event?.actor?.login || 'not recorded'} at ${item.closed_at}; reason not recorded.`);
    } else {
      const { closing }=this.issueClosingPr(item.number);
      lines.push(`Issue outcome: ${raw.state_reason==='completed' ? 'completed' : 'not planned'}. Closing PR: ${closing || 'not recorded'}.`);
    }
    return this.guard(`${lines.join('\n')}\n\n${FACTS}`);
  }
  issueClosingPr(number) {
    const [owner,name]=this.repository.split('/');
    this.pass?.planning();
    const result=this.transport.request('POST','graphql',{query:'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){closedByPullRequestsReferences(first:1){nodes{number}}}}}',variables:{owner,name,number}});
    return {closing:result.status===200 ? result.json?.data?.repository?.issue?.closedByPullRequestsReferences?.nodes?.map(pr=>`#${pr.number}`).join(', ') : null};
  }
}
module.exports={ClosingComments,STORY,FACTS,COMMENT_READ_CAP,PLANNING_READ_CAP,POST_CAP,marked};
