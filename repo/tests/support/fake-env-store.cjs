'use strict';

// An in-memory stand-in for the OS credential store, with the same methods and checks.
const { assertName, assertValue } = require('../../scripts/toolkit-env-store.cjs');

class FakeEnvStore {
  #values = new Map();
  #corruptReadBack;

  // corruptReadBack: names whose read-back returns something else (to test read-back checks).
  constructor({ values = {}, corruptReadBack = [] } = {}) {
    for (const [name, value] of Object.entries(values)) this.#values.set(name, value);
    this.#corruptReadBack = new Set(corruptReadBack);
    this.writes = 0;
    this.reads = 0;
  }

  get backend() { return 'Test store'; }

  list() { return [...this.#values.keys()].sort(); }

  // reads counts value reads (read calls readAll), so a test can prove a command never read one.
  readAll(names) {
    this.reads += 1;
    const out = new Map();
    for (const name of names.map(assertName)) {
      if (!this.#values.has(name)) continue;
      out.set(name, this.#corruptReadBack.has(name) && this.writes ? `${this.#values.get(name)}-changed` : this.#values.get(name));
    }
    return out;
  }

  read(name) { return this.readAll([name]).get(name); }

  writeAll(entries) {
    for (const [name, value] of entries) this.#values.set(assertName(name), assertValue(name, value));
    this.writes += 1;
  }

  remove(name) { return this.#values.delete(assertName(name)); }

  peek(name) { return this.#values.get(name); }
}

module.exports = { FakeEnvStore };
