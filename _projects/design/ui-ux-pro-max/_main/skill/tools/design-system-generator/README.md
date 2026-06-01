<!--
Maintained inside the UI/UX frontend design skill as local helper tooling.
Project: design.ui-ux-pro-max
Canonical source material: _projects/design/ui-ux-pro-max/_main/
Third-party source: nextlevelbuilder/ui-ux-pro-max-skill
-->
# Design System Generator

Local-only tooling for design-system search and recommendation generation.

This tool searches bundled CSV data under [data/](data/) and returns design-system recommendations from local files only. It is packaged with the skill so the copied folder keeps its helper data and runtime context together.

Agents may use this tool proactively when creating or revising design systems, page designs, component plans, or generator-backed recommendations. The user does not need to ask for the generator by name.

## Safety Model

- Local CSV reads only.
- No network clients.
- No shell execution.
- No subprocess usage.
- No browser automation.
- No dependency setup logic.
- No file writes by default.
- Read-only local execution is allowed for design creation and revision only when the script path resolves under the trusted installed skill directory that provided the active `SKILL.md`.
- Do not run a same-named generator discovered under an arbitrary active workspace. A consumer workspace can contain attacker-controlled files at matching relative paths.
- If the trusted installed skill directory cannot be proven, require explicit current-turn approval before execution and name the exact resolved script path.
- If persistence is added later, writes must be restricted to `<TRUSTED_UI_UX_SKILL_DIR>/tools/design-system-generator/output/` and require explicit user intent.

This tool is not permission to add executable code to instruction-only skills.

## Usage

Run from the trusted installed skill copy, not from an arbitrary consumer repo root. `<TRUSTED_UI_UX_SKILL_DIR>` must be the resolved directory for the active installed skill, for example:

- `.agents/skills/ui-ux-secure-frontend-design/` when that is the trusted Codex-installed copy.
- `.claude/skills/ui-ux-secure-frontend-design/` when that is the trusted Claude project skill copy.
- `~/.claude/skills/ui-ux-secure-frontend-design/` when that is the trusted Claude personal skill copy.

PowerShell example:

```powershell
python "<TRUSTED_UI_UX_SKILL_DIR>\tools\design-system-generator\scripts\design_system.py" "SaaS dashboard" --project-name "Example"
```

Bash example:

```bash
python3 "<TRUSTED_UI_UX_SKILL_DIR>/tools/design-system-generator/scripts/design_system.py" "SaaS dashboard" --project-name "Example"
```

From the trusted generator folder itself:

```powershell
python .\scripts\design_system.py "SaaS dashboard" --project-name "Example" --format markdown
```

Or import directly from Python after adding this folder's local script directory to `sys.path`:

```python
from design_system import generate_design_system

result = generate_design_system("SaaS dashboard", "Example")
```

## Data

The bundled CSV data is a safe subset adapted from `nextlevelbuilder/ui-ux-pro-max-skill`:

- `styles.csv`
- `colors.csv`
- `charts.csv`
- `landing.csv`
- `products.csv`
- `ux-guidelines.csv`
- `typography.csv`
- `icons.csv`
- `react-performance.csv`
- `app-interface.csv`
- `google-fonts.csv`
- `ui-reasoning.csv`
- `stacks/*.csv`

See [third-party notes](LICENSE-THIRD-PARTY-NOTES.md) for attribution.
