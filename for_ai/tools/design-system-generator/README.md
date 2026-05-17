<!--
Generated from toolkit project exports. Do not edit directly.
Project: design.ui-ux-pro-max
Source: projects/design/ui-ux-pro-max/exports/tools/design-system-generator-README.md
Update the source project export and run the sync/check workflow.
-->
# Design System Generator

Optional local-only tooling for design-system search and recommendation generation.

This tool searches bundled CSV data under [data/](data/) and returns design-system recommendations from local files only. It is separate from the instruction-only frontend design skill so executable tooling does not live under [for_ai/skills/](../../skills/).

## Safety Model

- Local CSV reads only.
- No network clients.
- No shell execution.
- No subprocess usage.
- No browser automation.
- No dependency setup logic.
- No file writes by default.
- If persistence is added later, writes must be restricted to `for_ai/tools/design-system-generator/output/` and require explicit user intent.

This tool is not permission to add executable code to instruction-only skills.

## Usage

From the repo root, with Python 3 available:

```powershell
python .\for_ai\tools\design-system-generator\scripts\design_system.py "SaaS dashboard" --project-name "Example"
```

From this folder:

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
