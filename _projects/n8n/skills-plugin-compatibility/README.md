# Official n8n Skills Plugin Compatibility

This source-only project pins the official `n8n-skills@n8n-io` package evidence used by Toolkit's bounded Windows hook compatibility adapters.

It does not publish or install the upstream skill pack. The exact current Codex plugin manifest is retained under [`_main/`](_main/) for source identity and synthetic fixture construction; executable hooks and skill content remain excluded from Toolkit publication and are represented only by immutable upstream blob pins plus first-party compatibility fingerprints.

Runtime repair remains in [repair-codex-plugin-windows-hooks.cjs](../../../repo/scripts/repair-codex-plugin-windows-hooks.cjs), current-cache selection and maintenance transactions remain in [toolkit-local-bridge.cjs](../../../repo/scripts/toolkit-local-bridge.cjs), and report-only drift detection reads this project's active [SOURCE-LOCK.json](SOURCE-LOCK.json).
