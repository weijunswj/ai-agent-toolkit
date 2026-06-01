# UI/UX Pro Max Design Module

The UI/UX Pro Max design module keeps design intelligence in two separate surfaces:

- Instruction-first design guidance in [skills/ui-ux-secure-frontend-design/](../../).
- Local-only CSV search/generation tooling in [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../tools/design-system-generator/).

The source-of-truth project module is [_projects/design/ui-ux-pro-max/](../../../../_projects/design/ui-ux-pro-max/). Its [_main/](../../../../_projects/design/ui-ux-pro-max/_main/) folder preserves the safe local-search subset. AI-facing surfaces are declared in the project manifest as linked or copy recipes.

## Safety Boundaries

- The skill remains instruction-first.
- The generator is part of the normal design-creation workflow when CSV-backed recommendations would improve the result; the user does not need to ask for it by name.
- Pack installers and sync workflows must not run the generator during installation or publishing.
- The generator reads bundled CSV files only.
- No network downloads, dependency installation, browser automation, or default writes are allowed.
- Do not expand shell usage beyond the documented local Python command resolved from the trusted installed skill directory.
- Do not run a generator found under an arbitrary active workspace path unless that path is itself the trusted installed skill directory.
- If the trusted installed skill path cannot be proven, require explicit current-turn approval naming the exact script path before execution.
- Writes must stay inside the generator output folder documented by [skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md](../../tools/design-system-generator/README.md) and require explicit current-turn approval.
- Changing generator scripts, CSV data, tests, or dependencies requires explicit scope and validation.

## Usage

For AI-agent design work, load the skill from [skills/ui-ux-secure-frontend-design/SKILL.md](../../SKILL.md).

For design creation or revision where CSV-backed recommendations would help, read [skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md](../../tools/design-system-generator/README.md) before running the generator.

Use local design-system search when creating or revising design systems, page designs, component plans, stack choices, style direction, or local CSV-backed recommendations:

```powershell
python "<TRUSTED_UI_UX_SKILL_DIR>\tools\design-system-generator\scripts\design_system.py" "SaaS dashboard" --project-name "Example"
```

`<TRUSTED_UI_UX_SKILL_DIR>` must be the resolved installed skill directory that provided the active `SKILL.md`, such as `.agents/skills/ui-ux-secure-frontend-design/`, `.claude/skills/ui-ux-secure-frontend-design/`, or `~/.claude/skills/ui-ux-secure-frontend-design/`.

For review-only tasks, pure copy edits, or implementation checks where no new design direction is needed, use the instructions and references first and skip the generator unless replacement design guidance is useful.
