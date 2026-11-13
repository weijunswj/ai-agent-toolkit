Title: reinstall after remove toolkit without hand repair

### Changed

- **Codex hook records:** `remove toolkit` now also takes out Codex's approval records for the Toolkit hooks (`[hooks.state."ai-agent-toolkit@ai-agent-toolkit-local:..."]` in `config.toml`) and the empty Toolkit plugin cache folder, once the Codex plugin is uninstalled. It backs up the file first, and the edit must read, with Python's `tomllib`, as the old file without exactly those tables; otherwise the file is left alone with a by-hand step.
- **Codex reinstall:** Codex setup no longer treats leftover Toolkit hook records alone as an earlier install. A computer cleaned by an older `remove toolkit` now installs the plugin without being asked for the old marketplace folder.
- **Reinstall note:** `remove toolkit` saves a note in the kept backups (`~/.ai-agent-toolkit/backups/remove-toolkit/reinstall.json`). It names the helper stack each app had and the checkouts whose scheduled tasks it removed; no keys.
  - `setup toolkit` puts the helper agents back for that stack where none are installed.
  - On Windows, setup lists the removed tasks with their exact `plan` and `apply` lines for the owner's OK. It never creates the tasks itself.
- **MCP key warning:** The removal plan lists each MCP server whose key helper runs `toolkit-env.cjs` from inside the Toolkit folder. Such a server gets no key until Toolkit is reinstalled, and its key stays in the credential store.
