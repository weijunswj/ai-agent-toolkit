# UI/UX Pro Max Design Module

The UI/UX Pro Max design module keeps design intelligence in two separate surfaces:

- Instruction-only design guidance in [skills/ui-ux-secure-frontend-design/](../../).
- Optional local-only CSV search/generation tooling in [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../tools/design-system-generator/).

The source-of-truth project module is [_projects/design/ui-ux-pro-max/](../../../../_projects/design/ui-ux-pro-max/). Its [_main/](../../../../_projects/design/ui-ux-pro-max/_main/) folder preserves the safe local-search subset. AI-facing surfaces are declared in the project manifest as linked or copy recipes.

## Safety Boundaries

- The skill remains instruction-only.
- The optional generator reads bundled CSV files only.
- No network, shell execution, dependency installation, browser automation, or default writes are allowed.
- If persistence is added, writes must stay under `skills/ui-ux-secure-frontend-design/tools/design-system-generator/output/` and be explicitly requested.

## Usage

For AI-agent design work, load the skill from [skills/ui-ux-secure-frontend-design/SKILL.md](../../SKILL.md).

For local design-system search:

```powershell
python .\tools\design-system-generator\scripts\design_system.py "SaaS dashboard" --project-name "Example"
```

See [skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md](../../tools/design-system-generator/README.md) for tool-specific usage and safety notes.
