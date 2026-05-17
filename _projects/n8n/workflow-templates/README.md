# n8n Workflow Templates Project Module

This project module preserves the n8n workflow-template source material and declares the root toolkit surfaces for safe workflow sync, sanitizer helpers, and workflow policy.

## Layout

- [_main/](_main/) keeps the actual README, scripts, and template workflow files.
- No curated or generated preview folder is used for this module.

## Safety

The source scripts in `_main/` are archived source material. They are not executed by the toolkit sync workflow just because they exist. Live n8n import/export remains explicit-confirmation only and never runs in CI.
