# Retired Source Provenance

Reviewed date: 2026-08-25.

This document records the migration boundary for former internal source repositories. It is historical provenance, not an active update plan. The Toolkit now owns the canonical skills, contracts, scripts, tests, and documentation directly under `skills/**` and `repo/**`.

## Retired Internal Inputs

The following former internal inputs were inspected and their reusable material was retained in the direct Toolkit surfaces:

- `weijunswj/ai-agent-toolkit`: UI/UX, Windows localhost, and other reusable skill material.
- `weijunswj/codex-n8n-local-setup`: n8n setup, platform guidance, helper safety, and agent-rule material.
- `weijunswj/ai-cicd-installer`: CI/CD safety concepts and reviewed n8n helper templates.
- `weijunswj/n8n-workflow-templates`: generic inactive workflow templates and sanitizer guidance.

Retained outputs include `skills/n8n-local-setup/`, `skills/n8n-workflow-helper-scripts/`, `skills/n8n-workflow-templates/`, `skills/secure-cicd-installer/`, `skills/ui-ux-secure-frontend-design/`, `skills/windows-localhost-workflows/`, and the matching `repo/contracts/`, `repo/scripts/`, and `repo/tests/` surfaces.

No retired internal source is an active source-watch target. No live workflow export, credential binding, package artifact, or external runtime dependency was copied into the Toolkit.

## Active Third-Party Attribution

Active source locks remain only at:

- `repo/source-watch/provenance/google-design-md/SOURCE-LOCK.json`
- `repo/source-watch/provenance/ui-ux-pro-max/SOURCE-LOCK.json`

They preserve the locked upstream commits, allowlists, blob pins, attribution requirements, and manual-review update policy. Source-watch may notify through a review PR, but it must not update pins, copy upstream files, execute upstream code, or treat notification as approval.

## Historical Records

The current direct surfaces are the source of truth. Historical migration names and provenance notes must not be used as active file paths or as evidence that a second source/publishing tree still exists.
