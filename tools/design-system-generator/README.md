# Design System Generator

Optional local-only tooling for design-system search and recommendation generation.

This tool searches bundled CSV data under `data/` and returns a small design-system recommendation from local files only. It is separate from the instruction-only frontend design skill so executable tooling does not live under `skills/`.

## Safety Model

- Local CSV reads only.
- No network clients.
- No shell execution.
- No browser automation.
- No dependency setup logic.
- No file writes by default.

## Usage

From this folder, with Python 3 available:

```powershell
python .\scripts\design_system.py "SaaS dashboard" --project-name "Example"
```

Or import directly from Python after adding `scripts/` to `sys.path`:

```python
from design_system import generate_design_system

result = generate_design_system("SaaS dashboard", "Example")
```

## Data

The bundled CSV data is a safe subset copied from `nextlevelbuilder/ui-ux-pro-max-skill`:

- `products.csv`
- `styles.csv`
- `colors.csv`
- `landing.csv`
- `typography.csv`
- `ui-reasoning.csv`

See [third-party notes](LICENSE-THIRD-PARTY-NOTES.md) for attribution.
