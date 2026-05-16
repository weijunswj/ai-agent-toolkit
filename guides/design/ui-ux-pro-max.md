<!--
Generated from toolkit project exports. Do not edit directly.
Project: design.ui-ux-pro-max
Source: projects/design/ui-ux-pro-max/exports/guides/design/ui-ux-pro-max.md
Update the source project export and run the sync/check workflow.
-->
# UI/UX Pro Max Design Module

The UI/UX Pro Max design module keeps design intelligence in two separate surfaces:

- Instruction-only design guidance in [skills/design/ui-ux-secure-frontend-design/](../../skills/design/ui-ux-secure-frontend-design/).
- Optional local-only CSV search/generation tooling in [tools/design-system-generator/](../../tools/design-system-generator/).

The source-of-truth project module is [projects/design/ui-ux-pro-max/](../../projects/design/ui-ux-pro-max/). Its [main/](../../projects/design/ui-ux-pro-max/main/) folder preserves the safe local-search subset and its [exports/](../../projects/design/ui-ux-pro-max/exports/) folder feeds root-level consumer surfaces.

## Safety Boundaries

- The skill remains instruction-only.
- The optional generator reads bundled CSV files only.
- No network, shell execution, dependency installation, browser automation, or default writes are allowed.
- If persistence is added, writes must stay under `tools/design-system-generator/output/` and be explicitly requested.

## Usage

For AI-agent design work, load the skill from [skills/design/ui-ux-secure-frontend-design/SKILL.md](../../skills/design/ui-ux-secure-frontend-design/SKILL.md).

For local design-system search:

```powershell
python .\tools\design-system-generator\scripts\design_system.py "SaaS dashboard" --project-name "Example"
```

See [tools/design-system-generator/README.md](../../tools/design-system-generator/README.md) for tool-specific usage and safety notes.
