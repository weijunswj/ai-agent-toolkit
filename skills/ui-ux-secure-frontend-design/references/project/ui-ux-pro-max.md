<!--
Generated from toolkit project source. Do not edit directly.
Project: design.ui-ux-pro-max
Source: _projects/design/ui-ux-pro-max/_main/skill/references/project/ui-ux-pro-max.md
Update the project source and run sync.
-->
# UI/UX Pro Max Design Module

The UI/UX Pro Max design module keeps design intelligence in two separate surfaces:

- Instruction-first design guidance in [skills/ui-ux-secure-frontend-design/](../../).
- Optional local-only CSV search/generation tooling in [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../tools/design-system-generator/).

The source-of-truth project module is [_projects/design/ui-ux-pro-max/](../../../../_projects/design/ui-ux-pro-max/). Its [_main/](../../../../_projects/design/ui-ux-pro-max/_main/) folder preserves the safe local-search subset. AI-facing surfaces are declared in the project manifest as linked or copy recipes.

## Safety Boundaries

- The skill remains instruction-first.
- The optional generator is never required for normal design or review tasks and must not run by default.
- The optional generator reads bundled CSV files only.
- No network downloads, dependency installation, browser automation, or default writes are allowed.
- Do not expand shell usage beyond the documented local Python command.
- Writes must stay inside the generator output folder documented by [skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md](../../tools/design-system-generator/README.md) and require explicit current-turn approval.

## Usage

For AI-agent design work, load the skill from [skills/ui-ux-secure-frontend-design/SKILL.md](../../SKILL.md).

For generator tasks, read [skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md](../../tools/design-system-generator/README.md) before running anything.

Use local design-system search only when the user asks for design-system generation, stack or component pattern exploration, or local CSV-backed recommendations:

```powershell
python .\tools\design-system-generator\scripts\design_system.py "SaaS dashboard" --project-name "Example"
```

For normal frontend design, redesign, planning, implementation, or review, use the instructions and references first.
