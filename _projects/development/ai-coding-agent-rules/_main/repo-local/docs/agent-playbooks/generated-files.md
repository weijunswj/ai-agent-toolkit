# Generated Files

Use this for generated outputs, templates, schemas, source data, migrations, publishing, or files with generated notices.

## Procedure

- Treat generated notices as ownership markers.
- Do not edit generated output directly unless the user explicitly asks for generated output only.
- Find the source partial, template, schema, generator, or source data.
- Read any documented generation or freshness command.
- Update the source first, regenerate, then run the matching freshness check when available.
- If generated output appears stale before your change, report the blocker before broadening the task.

Generated-file caution in `AGENTS.md` remains active even if this playbook is missing.
