# AI Agent Toolkit

Reusable AI-agent skills, templates, packs, registries, MCP design notes, and local-only tools.

## Mental Model

| Path | Purpose |
| --- | --- |
| [_projects/](_projects/) | Canonical preserved source library. Humans should use `_projects/**/_main/` for full source docs and original guides. |
| [for_ai/](for_ai/) | AI-facing published assets: skills, MCP notes, templates, packs, registries, tools, and operator playbooks. |
| [repo/](repo/) | Repo maintenance assets: validation scripts, tests, policy docs, migration notes, and CI support. |

Root stays intentionally small: `README.md`, `AGENTS.md`, `package.json`, `.gitignore`, `.gitattributes`, `.github/`, `_projects/`, `for_ai/`, and `repo/`.

## Source Library

Project modules keep preserved source material in:

```text
_projects/<category>/<project>/_main/
```

Each project module also carries `toolkit.project.json`, `SOURCE-MANIFEST.md`, `SOURCE-LOCK.json`, and a tiny landing `README.md`. Those landing cards point to `_main/` and do not replace the preserved source docs.

Current project modules:

- [Local n8n Setup](_projects/n8n/local-setup/)
- [n8n Workflow Templates](_projects/n8n/workflow-templates/)
- [Secure CI/CD Installer](_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/)

## AI Surfaces

Use [for_ai/](for_ai/) for published assets that agents or installers consume:

- [Skills](for_ai/skills/)
- [MCP design notes](for_ai/mcp/)
- [Templates](for_ai/templates/)
- [Packs](for_ai/packs/)
- [Registries](for_ai/registry/)
- [Tools](for_ai/tools/)
- [AI/operator playbooks](for_ai/playbooks/)

`for_ai/playbooks/` contains concise routing and operating notes. It is not the canonical human documentation layer; use `_projects/**/_main/` for full source docs.

## Maintenance

Repo-local policy, validation, and CI support live under [repo/](repo/):

- [Docs](repo/docs/)
- [Scripts](repo/scripts/)
- [Tests](repo/tests/)

Source-watch is advisory and read-only. It renders update candidates from source-lock metadata but does not fetch upstream commits, copy files, update `SOURCE-LOCK.json`, create branches, create PRs, run live n8n actions, or mutate credentials.

Retired internal source repos remain provenance-only:

- `weijunswj/codex-n8n-local-setup`
- `weijunswj/ai-cicd-installer`
- `weijunswj/n8n-workflow-templates`

The active third-party source `nextlevelbuilder/ui-ux-pro-max-skill` remains manual-review and attribution-gated.

## Validation

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/package-packs.cjs --check
python -m unittest discover -s for_ai/tools/design-system-generator/tests
git diff --check
```
