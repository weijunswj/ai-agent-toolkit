'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// JSON read-back is a local integrity check. Claude Code load proof still needs
// a real restart and successful turn; never start a paid session from this check.
class HostJsonConfigWrite {
  #file; #backupDir; #options;
  constructor(file, backupDir, options = {}) { this.#file = file; this.#backupDir = backupDir; this.#options = options; }

  #atomic(bytes) {
    const temp = `${this.#file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, this.#file);
    } finally { fs.rmSync(temp, { force: true }); }
  }

  // Native plugin commands also write settings.json. They own the new values;
  // Toolkit still owns backup, post-command JSON read-back and exact rollback.
  #captureExternal() {
    const original = fs.existsSync(this.#file) ? fs.readFileSync(this.#file) : null;
    fs.mkdirSync(this.#backupDir, { recursive: true, mode: 0o700 });
    const backup = path.join(this.#backupDir, `settings-native-${crypto.randomUUID()}.json.original`);
    fs.writeFileSync(backup, original || Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    return { original, backup };
  }

  #verifyExternal({ original, backup }) {
    try {
      if (fs.existsSync(this.#file)) {
        const bytes = fs.readFileSync(this.#file);
        const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        if (!value || typeof value !== 'object' || Array.isArray(value) || !fs.readFileSync(this.#file).equals(bytes)) throw new Error();
      }
    } catch {
      try {
        if (original === null) fs.rmSync(this.#file, { force: true });
        else {
          if (!fs.readFileSync(backup).equals(original)) throw new Error();
          this.#atomic(original);
        }
        if (original === null ? fs.existsSync(this.#file) : !fs.readFileSync(this.#file).equals(original)) throw new Error();
      } catch { throw new Error(`Claude Code settings failed the JSON read-back check and automatic rollback failed. Backup: ${backup}.`); }
      throw new Error(`Claude Code settings failed the JSON read-back check. ${original === null ? 'The setup-created file was removed.' : 'The previous file was restored exactly.'} Backup: ${backup}. Native plugin or cache changes may remain; inspect the plugin state before retrying.`);
    }
  }

  async runExternal(effect) {
    const snapshot = this.#captureExternal();
    let result; let effectError;
    try { result = await effect(); } catch (error) { effectError = error; }
    this.#verifyExternal(snapshot);
    if (effectError) throw effectError;
    return result;
  }

  runExternalSync(effect) {
    const snapshot = this.#captureExternal();
    let result; let effectError;
    try { result = effect(); } catch (error) { effectError = error; }
    this.#verifyExternal(snapshot);
    if (effectError) throw effectError;
    return result;
  }

  run(previousText, text) {
    const original = fs.existsSync(this.#file) ? fs.readFileSync(this.#file) : null;
    if (previousText === null ? original !== null : original === null || !original.equals(Buffer.from(previousText))) {
      throw new Error('The Claude Code user settings file changed while setup was running; run setup again.');
    }
    fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    fs.mkdirSync(this.#backupDir, { recursive: true, mode: 0o700 });
    const backup = path.join(this.#backupDir, `settings-${crypto.randomUUID()}.json.original`);
    // An absence receipt also records that rollback must remove the created file.
    fs.writeFileSync(backup, original || Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    const replacement = text === null ? null : Buffer.from(text);
    if (replacement === null) fs.rmSync(this.#file, { force: true });
    else this.#atomic(replacement);
    try {
      this.#options.afterReplace?.(this.#file);
      if (replacement === null) {
        if (fs.existsSync(this.#file)) throw new Error();
      } else {
        const actual = fs.readFileSync(this.#file);
        if (!actual.equals(replacement)) throw new Error();
        const parsed = JSON.parse(actual.toString('utf8').replace(/^\uFEFF/, ''));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      }
    } catch {
      try {
        if (original === null) fs.rmSync(this.#file, { force: true });
        else {
          const bytes = fs.readFileSync(backup);
          if (!bytes.equals(original)) throw new Error();
          this.#atomic(bytes);
        }
        if (original === null ? fs.existsSync(this.#file) : !fs.readFileSync(this.#file).equals(original)) throw new Error();
      } catch { throw new Error(`Claude Code settings failed the JSON read-back check and automatic rollback failed. Backup: ${backup}.`); }
      throw new Error(`Claude Code settings failed the JSON read-back check. ${original === null ? 'The setup-created file was removed.' : 'The previous file was restored exactly.'} Backup: ${backup}.`);
    }
    return { backup, verification: 'JSON read-back passed; host load not verified. Restart Claude Code and complete one successful turn.' };
  }
}

module.exports = { HostJsonConfigWrite };
