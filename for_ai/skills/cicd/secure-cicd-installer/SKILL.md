---
name: secure-cicd-installer
description: Instruction-only guidance for reviewing, planning, and applying secure CI/CD installer materials with approval-gated writes, safe status tracking, and no default command execution.
---

<!--
Root published toolkit surface. Maintained directly and declared as linked in toolkit.project.json.
Project: cicd.secure-installer
Review the related _projects/**/_main source when updating.
-->
# Secure CI/CD Installer

Use this skill when a user asks for secure CI/CD setup, GitHub Actions hardening, installer prompt/status templates, or safe rollout planning based on this toolkit's CI/CD project module.

## Source Module

- Project module: [_projects/cicd/secure-installer/](../../../_projects/cicd/secure-installer/)
- Preserved source: [_projects/cicd/secure-installer/_main/](../../../_projects/cicd/secure-installer/_main/)

## Core Rules

- Do not run CI/CD commands by default.
- Do not install packages, mutate deployment settings, rotate credentials, or write secrets unless the user explicitly approves the exact action and target.
- Keep status tracking copy-ready and machine-readable when requested.
- Treat `.env*`, private keys, deployment tokens, and credential files as denied writes.

## Root Surfaces

- Guide: [for_ai/playbooks/cicd/secure-cicd-installer.md](../../../guides/cicd/secure-cicd-installer.md)
- Templates: [for_ai/templates/cicd/](../../../templates/cicd/)
- Pack checklist: [for_ai/packs/secure-cicd/pack.json](../../../packs/secure-cicd/pack.json)
- MCP spec: [for_ai/mcp/projects/secure-cicd-installer.md](../../../mcp/projects/secure-cicd-installer.md)
