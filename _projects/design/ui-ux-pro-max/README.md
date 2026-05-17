# UI/UX Pro Max Design Project Module

This module preserves the safe local-search subset adapted from `nextlevelbuilder/ui-ux-pro-max-skill` and exposes toolkit surfaces for instruction-only design guidance and optional local-only design-system search tooling.

## Layout

- [_main/](_main/) keeps the safe preserved source subset and notes.
- `curated_output_for_ai/` is absent because no intermediate curated source is needed.
- [_generated/](_generated/) is reserved for optional previews only.

## Third-Party Attribution

This module keeps MIT attribution for `nextlevelbuilder/ui-ux-pro-max-skill`. See [LICENSE-THIRD-PARTY-NOTES.md](LICENSE-THIRD-PARTY-NOTES.md).

## Safety

The optional generator searches local CSV data only. It does not use network clients, shell execution, browser automation, dependency installers, or default writes.
