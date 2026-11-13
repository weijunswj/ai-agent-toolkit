### Fixed

- **Remove Toolkit in Codex:** `remove toolkit` always runs the full removal plan (scheduled tasks, app settings, hook records, helpers, skill copies, global rules, reinstall note and the Toolkit folder) after the user's OK. The setup skill's listing now names the plan script and says the app's own plugin uninstall tool is never the answer on its own, so a Codex session that cannot open the skill file still routes to the plan. Codex's own uninstall tool may do the Codex uninstall step once the user has said yes.
