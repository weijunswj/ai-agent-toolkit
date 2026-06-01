# Secure UI/UX Frontend Design

This skill helps an AI agent create, review, and improve frontend web interfaces with a design-system-first workflow and security-first guardrails.

It is useful for landing pages, SaaS apps, dashboards, settings pages, admin interfaces, forms, charts, workflow builders, AI control surfaces, and n8n-like automation screens.

The skill is instruction-first. It also includes an optional local-only design-system generator under [tools/design-system-generator/](tools/design-system-generator/) for explicitly requested design-system generation, stack or component pattern exploration, and local CSV-backed recommendations. The generator is never required for normal design or review tasks and must not run by default.

## What this skill does

1. Turns a product brief into a practical design system.
2. Produces page-level overrides for goals, hierarchy, sections, states, and mobile behavior.
3. Creates implementation-ready component plans.
4. Reviews finished UI for visual polish, accessibility, responsiveness, performance, privacy, security, and safety.
5. Keeps risky surfaces such as auth, forms, dashboards, file uploads, analytics, AI controls, and automation controls under stricter review.
6. Optionally uses bundled local CSV data to generate design-system recommendations when the user explicitly asks for generator-backed output.

## Generator routing

For normal frontend design or review, start with `SKILL.md` and the relevant files under [references/](references/).

For generator tasks, read [tools/design-system-generator/README.md](tools/design-system-generator/README.md) before running anything.

Use the generator only when the user asks for:

1. Design-system generation.
2. Stack or component pattern exploration.
3. Local CSV-backed recommendations.

## What this skill intentionally does not include

1. No package manifests, installers, global CLI tools, dependency setup, or executable helpers outside the documented local-only generator.
2. No upstream package wrapper, generated upstream outputs, remote assets, browser automation, or templates.
3. No credentials, tokens, private URLs, private exports, or environment-specific values.
4. No third-party tracking, analytics, remote fonts, embeds, pixels, or external network calls.
5. No permission grants or tool allowlists.

## Generator safety boundary

1. Local-only CSV reads from the bundled skill folder.
2. No network downloads.
3. No package installs.
4. No shell expansion beyond the documented local Python command.
5. No writes outside the generator output folder documented by [tools/design-system-generator/README.md](tools/design-system-generator/README.md).
6. Explicit current-turn approval is required before running the generator or writing generated output.

## Why this is safer than importing upstream executable tooling

The public UI/UX Pro Max project popularized a useful workflow idea: product brief to design system to page plan to implementation review. This repository keeps that instruction-first pattern, adds security-first guardrails, and packages only a reviewed local-only generator subset for optional use.

Agents can use the design guidance without running anything. If generator-backed recommendations are requested, the bundled tool is constrained to local CSV data and the safety boundary above.

## Supported platforms

| Platform | Support notes |
|---|---|
| ChatGPT web | Works if custom Skills are available in the account or workspace. |
| Codex | Copy the folder into `.agents/skills/ui-ux-secure-frontend-design/`. |
| Claude web | Works if Skills are available in the account or workspace. |
| Claude Code | Copy the folder into `.claude/skills/` or `~/.claude/skills/`. |

## Install notes

This folder is a template/source copy. Install the whole `ui-ux-secure-frontend-design/` folder into the runtime location required by the target agent.

See [INSTALL.md](INSTALL.md) for platform-specific paths.

## Safety posture

| Area | Default posture |
|---|---|
| Secrets and credentials | Never request, store, display, or mock secret values. |
| User data and PII | Minimize display, redact where practical, and prefer least privilege. |
| Third-party scripts | Do not add without explicit approval and risk disclosure. |
| Auth and access control | Never weaken auth, session, cookie, CSRF, CSP, CORS, or RBAC for visual convenience. |
| Forms and uploads | Treat as high-risk and preserve validation, limits, and clear consent. |
| Analytics and tracking | Prefer privacy-preserving defaults and explicit consent. |
| Dark patterns | Ban fake urgency, deceptive opt-ins, hidden fees, and confusing unsubscribe flows. |
| n8n and automation UI | Treat workflow triggers, credentials, executions, and destructive actions as high-risk controls. |
| Optional generator | Do not run by default; require explicit approval and keep any writes inside the documented output folder. |
