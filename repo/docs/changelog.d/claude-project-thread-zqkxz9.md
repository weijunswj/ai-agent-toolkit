Title: one-app remove toolkit and a setup bank asked once

### Fixed

- `remove toolkit` asks first whether to remove Toolkit from only the app it runs in or from every app, and `toolkit-remove.cjs` needs that answer as `--app codex`, `--app claude-code` or `--app all`. One app removes only its own plugin, global rules file, settings, helper files and skill copies; scheduled tasks, Antigravity's copies and the Toolkit folder stay while another app still has the plugin. Running it in Codex no longer uninstalls Claude Code's Toolkit.
- Codex `setup toolkit` no longer stops and shows the question bank again after its own plugin install writes the plugin's tables into `config.toml`. The approved helper limit carries over when only those tables changed and the edit is the same, so the instruction limit, Antigravity copy and global rules steps run in the same pass. Any other change to the file still asks again.
- A setup preview (`--plan`, `--explain`) shows the bank exactly as the run shows it, with the same reference, and runs from the managed checkout like the run does. Before, a preview's reference was never accepted by the run.
