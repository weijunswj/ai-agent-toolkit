# Secure UI/UX Frontend Design

This skill helps an AI agent create, review, and improve frontend web interfaces with a design-system-first workflow and security-first guardrails.

It is useful for landing pages, SaaS apps, dashboards, settings pages, admin interfaces, forms, charts, workflow builders, AI control surfaces, and n8n-like automation screens.

## What this skill does

1. Turns a product brief into a practical design system.
2. Produces page-level overrides for goals, hierarchy, sections, states, and mobile behavior.
3. Creates implementation-ready component plans.
4. Reviews finished UI for visual polish, accessibility, responsiveness, performance, privacy, security, and safety.
5. Keeps risky surfaces such as auth, forms, dashboards, file uploads, analytics, AI controls, and automation controls under stricter review.

## What this skill intentionally does not include

1. No Python scripts, shell scripts, Node scripts, package manifests, installers, CLI tools, or executable helpers.
2. No vendored upstream code, generated upstream outputs, data files, assets, or templates.
3. No credentials, tokens, private URLs, private exports, or environment-specific values.
4. No third-party tracking, analytics, remote fonts, embeds, pixels, or external network calls.
5. No permission grants or tool allowlists.

## Why this is safer than importing upstream executable scripts

The public UI/UX Pro Max project popularized a useful workflow idea: product brief to design system to page plan to implementation review. This repository keeps only that high-level instruction pattern and rewrites it as a portable, instruction-only skill.

Because this skill contains no executable code, packages, data files, installers, or vendored assets, agents can use it as design guidance without running unfamiliar code or importing unreviewed dependencies.

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
