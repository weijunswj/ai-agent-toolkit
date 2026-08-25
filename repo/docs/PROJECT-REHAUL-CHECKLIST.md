# Canonical Surface Checklist

Use this checklist when reviewing the direct canonical Toolkit architecture.

## Canonical Shape

- [ ] Complete AI-facing skills live under `skills/<skill-name>/`.
- [ ] Machine contracts, fixtures, templates, and agent-rule inputs live under `repo/contracts/`.
- [ ] Active third-party provenance lives under `repo/source-watch/provenance/`.
- [ ] No legacy project tree, project manifests, generated pack manifests, or duplicate publishing tree is introduced.

## AI-Facing Surfaces

- [ ] [skills/](../../skills/) remains obvious as the published AI-facing root surface.
- [ ] Skills are complete and locally usable without a source or publishing tree.
- [ ] Managed root instruction blocks and templates use the retained canonical synchronizers.
- [ ] Active `SOURCE-LOCK.json` files pass the source-lock audit.

## Safety

- [ ] Live actions are explicit-confirmation only.
- [ ] CI live actions are disabled.
- [ ] Forbidden files and private/generated artifacts are absent.
- [ ] Instruction-only skills contain no executable files.

## Design Generator

- [ ] Optional generator lives under [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../skills/ui-ux-secure-frontend-design/tools/design-system-generator/).
- [ ] It searches local CSV data only.
- [ ] It contains no network, shell, browser, subprocess, or installer code.
- [ ] Third-party MIT attribution is preserved.

## Validation

Run:

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-agent-instruction-shims.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/run-design-tests.cjs
git diff --check
```
