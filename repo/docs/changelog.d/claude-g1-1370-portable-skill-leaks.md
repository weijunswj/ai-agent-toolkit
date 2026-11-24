### Changed

- The portable skills no longer name Toolkit terms or a coding app in their main instructions, so they read the same in any agent. App-specific and Toolkit-specific details moved to a reference file in each skill (`agent-cost-control`, `n8n-environment-setup`, `secure-ci-cd`, `windows-local-dev-services`), and the rest were reworded (`external-operation-preflight`, `frontend-art-direction`, `host-observability`, `managed-app-foundation-review`, `n8n-workflow-transport`, `release-readiness-audit`, `skill-product-review`). The Hostinger maintainer skill keeps its Codex name, now recorded as an app it depends on.
- `agent-cost-control` calls the planning, build and review sessions by those names and a merge train a batch merge; they stay outside the model ladder as before.

### Fixed

- `release-readiness-audit` no longer asks for scope again when the request already gives a full read-only scope (the target, that nothing is changed, and what to report); it starts the audit.
