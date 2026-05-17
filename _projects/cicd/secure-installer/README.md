# Secure CI/CD Installer Project Module

This module preserves the secure CI/CD installer source project and declares the root toolkit surfaces that depend on it.

## Layout

- [_main/](_main/) keeps the actual project README, docs, templates, and tests.
- `curated_output_for_ai/` is absent because no intermediate curated source is needed.
- [_generated/](_generated/) is reserved for optional previews only.

## Safety

This project is approval-gated. It does not run commands by default, does not install packages from the toolkit repo, and does not perform live deployment or CI mutation in CI.
