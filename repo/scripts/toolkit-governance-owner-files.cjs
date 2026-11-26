'use strict';

// What a turn-on pull request may write over what GitHub already holds. The wanted files come from this
// computer's checkout, which can be behind the default branch, so each one is judged by the text on
// GitHub right before the commit is made (toolkit-governance-proposal.cjs, its first publish and its
// update of an open pull request):
//
//   - A settings file that is already there is the owner's and is kept: the personal data guard's, the
//     plain-text check's (its baseline too, which belongs to its settings), the Dependabot settings and
//     the test shard list. So is an existing plain-text workflow, as its installer keeps it.
//   - A file Toolkit did not write is kept, and what depends on it is left out with it: the rest of a
//     copied workflow's files, the other rendered copies, the rest of the plain-text check.
//   - A Toolkit copy is brought to the wanted text; a hand-edited one is named.
//
// Every kept or replaced file is named, so the pull request and the turn-on's summary show it.
const copied = require('./toolkit-cloud-workflows-copied.cjs');
const { CONFIG_PATH, VENDORED_PATH, WORKFLOW_PATH, vendoredState } = require('../../skills/secure-ci-cd/scripts/install-plain-text-check.cjs');

// What `held` gives for something that is there but is no text file Toolkit can read.
const UNREADABLE = Symbol('unreadable');
const slash = file => file.split('\\').join('/');
const PLAIN_TEXT = Object.freeze({ settings: slash(CONFIG_PATH), baseline: '.github/plain-text-baseline.json', script: slash(VENDORED_PATH), workflow: slash(WORKFLOW_PATH) });
const lf = text => text.replace(/\r\n/g, '\n');

class OwnerFiles {
  #wanted; #held; #onBase; #write; #notes = []; #texts = new Map();

  // `wanted` is { path: text }; `held(path)` gives the text the pull request's next commit starts from
  // (null when nothing is there, UNREADABLE when it cannot be read), and `onBase(path)` whether a path it
  // holds is on the default branch, rather than added by the open pull request itself.
  constructor(wanted, { held, onBase = () => true }) {
    this.#wanted = wanted;
    this.#held = held;
    this.#onBase = onBase;
    this.#write = { ...wanted };
  }

  #text(file) {
    if (!this.#texts.has(file)) this.#texts.set(file, this.#held(file));
    return this.#texts.get(file);
  }

  #wants(file) { return Object.hasOwn(this.#write, file); }

  // There, and not what this run would write.
  #differs(file) {
    const text = this.#text(file);
    return text !== null && (text === UNREADABLE || !Object.hasOwn(this.#wanted, file) || lf(text) !== lf(this.#wanted[file]));
  }

  #leave(file) { delete this.#write[file]; }

  #state(file, read) {
    const text = this.#text(file);
    return text === null ? 'missing' : text === UNREADABLE ? 'unmanaged' : read(text);
  }

  // The state a Toolkit copy reads as; a hand edit this run brings back is named.
  #copy(file, read) {
    const state = this.#state(file, read);
    if (state === 'edited' && this.#wants(file) && this.#differs(file)) this.#notes.push(`${file} was edited by hand and is brought back to the Toolkit's own text.`);
    return state;
  }

  #copiedWorkflows() {
    for (const [id, files] of Object.entries(copied.COPIED_FILES)) {
      if (!files.some(file => this.#wants(file))) continue;
      const foreign = files.filter(file => (file === copied.GUARD_CONFIG ? this.#text(file) === UNREADABLE : this.#state(file, text => copied.copiedState(file, text)) === 'unmanaged'));
      if (foreign.length) {
        for (const file of files) this.#leave(file);
        this.#notes.push(...foreign.map(file => copied.clashNote(file, id)));
        continue;
      }
      for (const file of files) if (file !== copied.GUARD_CONFIG) this.#copy(file, text => copied.copiedState(file, text));
      if (files.includes(copied.GUARD_CONFIG)) this.#keepSettings(copied.GUARD_CONFIG);
    }
  }

  #renderedWorkflows() {
    const workflows = require('./toolkit-cloud-workflows.cjs');
    const files = Object.keys(this.#write).filter(file => workflows.copyIdAt(file, this.#write[file]));
    const read = (file, text) => (!workflows.copyIdAt(file, text) ? 'unmanaged' : workflows.copyState(text, this.#wanted[file]).state);
    const foreign = files.filter(file => this.#state(file, text => read(file, text)) === 'unmanaged');
    if (!foreign.length) { for (const file of files) this.#copy(file, text => read(file, text)); return; }
    for (const file of files) this.#leave(file);
    this.#notes.push(...foreign.map(file => `${file} is not a Toolkit copy, so it is left as it is and the Toolkit's rendered workflow copies are not added around it; move it aside in a pull request first.`));
  }

  #plainText() {
    const { settings, baseline, script, workflow } = PLAIN_TEXT;
    if (this.#wants(script) && this.#onBase(script) && this.#state(script, text => vendoredState(text).state) === 'unmanaged') {
      for (const file of Object.values(PLAIN_TEXT)) this.#leave(file);
      this.#notes.push(`${script} is not a Toolkit copy, so it is left as it is and the plain-text check is not added around it; move it aside in a pull request first.`);
      return;
    }
    if (this.#wants(script) && this.#onBase(script)) this.#copy(script, text => vendoredState(text).state);
    // The baseline belongs to the settings it was made with.
    if (this.#owners(settings)) this.#leave(baseline);
    this.#owners(baseline);
    this.#owners(workflow);
  }

  // Keeps an existing settings file of the default branch: true when it was kept.
  #owners(file) { return this.#onBase(file) && this.#keepSettings(file); }

  // Keeps an existing settings file as it is, line ends included: true when it holds something else.
  #keepSettings(file) {
    if (!this.#wants(file) || this.#text(file) === null) return false;
    const differs = this.#differs(file);
    if (differs || this.#text(file) !== this.#wanted[file]) this.#leave(file);
    if (!differs) return false;
    this.#notes.push(`${file} is already on GitHub with other content, so it is left as it is.`);
    return true;
  }

  // GitHub reads either Dependabot name, so one that is there keeps the other out.
  #dependabot() {
    const names = require('./toolkit-governance-security.cjs').DEPENDABOT_NAMES;
    const kept = names.find(file => names.some(name => this.#wants(name)) && this.#onBase(file) && this.#text(file) !== null && this.#differs(file));
    if (!kept) { for (const file of names) this.#owners(file); return; }
    for (const file of names) this.#leave(file);
    this.#notes.push(`${kept} is already on GitHub with other content, so it is left as it is.`);
  }

  // { files (what to write), left (the wanted paths that are not written), notes, onBase (the wanted
  // paths the default branch already holds) }.
  judge() {
    this.#copiedWorkflows();
    this.#renderedWorkflows();
    this.#plainText();
    this.#dependabot();
    this.#owners(require('./governed-test-shards.cjs').MANIFEST_REL);
    const wanted = Object.keys(this.#wanted);
    return {
      files: this.#write,
      left: wanted.filter(file => !this.#wants(file)),
      notes: this.#notes,
      onBase: wanted.filter(file => this.#texts.has(file) && this.#text(file) !== null && this.#onBase(file)),
    };
  }
}

module.exports = Object.freeze({ OwnerFiles, UNREADABLE });
