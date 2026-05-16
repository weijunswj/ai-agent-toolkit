# Secure CI/CD Installer Project Module

This module preserves the secure CI/CD installer source project and publishes curated prompts, status templates, guides, pack metadata, and optional instruction-only skill surfaces.

## Layout

- [main/](main/) keeps the actual project README, docs, templates, and tests.
- [exports/](exports/) contains explicit curated sources for root-level toolkit outputs.
- [_generated/](_generated/) is reserved for optional previews only.

## Safety

This project is approval-gated. It does not run commands by default, does not install packages from the toolkit repo, and does not perform live deployment or CI mutation in CI.
