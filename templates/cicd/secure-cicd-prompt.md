# Secure CI/CD Installer Prompt

```text
You are my AI coding agent. Set up a security-first CI/CD plan for this repository.

First inspect the repo before editing:
- Confirm the project root.
- Inspect git status and existing workflows.
- Detect package managers, frameworks, tests, builds, Docker files, deployment files, and n8n workflow structure.
- Scan for risky files and possible secrets before creating CI files.

Hard rules:
- Do not print secret values.
- Do not commit, push, create a PR, merge, or deploy without approval.
- Do not enable deployment until I approve a deployment plan.
- Use GitHub Secrets for private values.
- Prefer CI first and deployment later.
- Create or update CURRENT_CICD_STATUS.md as the source of truth.

Before implementing, show:
- Detected project type.
- Evidence.
- Existing workflows.
- Security preflight result.
- Recommended CI jobs.
- Recommended security gates.
- Files to create or edit.
- Risks and assumptions.
```
