# Secure UI/UX Frontend Design

This skill helps an AI agent create, review, and improve frontend web interfaces with a design-system-first workflow and security-first guardrails.

It is useful for landing pages, SaaS apps, dashboards, settings pages, admin interfaces, forms, charts, workflow builders, AI control surfaces, and n8n-like automation screens.

The skill is instruction-first. It also includes a local-only design-system generator under [tools/design-system-generator/](tools/design-system-generator/) for design-system generation, stack or component pattern exploration, and local CSV-backed recommendations. Agents may use the generator as a normal design aid when creating or revising designs; users do not need to ask for it by name. Pack installers must not run it during installation.

## What this skill does

1. Turns a product brief into a practical design system.
2. Produces page-level overrides for goals, hierarchy, sections, states, and mobile behavior.
3. Creates implementation-ready component plans.
4. Reviews finished UI for visual polish, accessibility, responsiveness, performance, privacy, security, and safety.
5. Keeps risky surfaces such as auth, forms, dashboards, file uploads, analytics, AI controls, and automation controls under stricter review.
6. Uses bundled local CSV data to generate design-system recommendations for design creation or revision when helpful.
7. Reads existing `DESIGN.md` / `design.md` files before frontend visual changes and may propose a durable design contract when drift is likely.

## DESIGN.md compatibility

If a target app has `DESIGN.md` or `design.md`, agents should read it before changing frontend visuals. Use it alongside [references/design-md-contract.md](references/design-md-contract.md), the normal design-system workflow, local app tokens, CSS/theme files, component code, and the local generator when useful.

If no design contract exists and repeated UI changes are likely to drift, agents may propose or create a `DESIGN.md` only when it is useful and within the user's requested scope. Existing app tokens, CSS variables, theme files, component libraries, and brand docs remain source of truth unless the user explicitly asks to convert or reconcile them.

This compatibility path is documentation-only by default. Do not run `npx @google/design.md`, install `@google/design.md`, add package scripts, fetch remote assets, call external validators, or use upstream executable tooling unless the user explicitly approves that exact action and the target repo policy allows it.

## Generator routing

For frontend design creation or revision, start with `SKILL.md` and the relevant files under [references/](references/), then use the generator when local CSV-backed recommendations would improve the design direction.

Read [tools/design-system-generator/README.md](tools/design-system-generator/README.md) before running the generator.

Use the generator when creating or revising:

1. Design systems or product visual direction.
2. Landing pages, dashboards, SaaS screens, forms, component plans, or page overrides.
3. Stack, style, typography, color, chart, icon, or component patterns.
4. Local CSV-backed recommendations.

The user does not need to ask for the generator by name. For review-only tasks, pure copy edits, or implementation checks where no new design direction is needed, use the instructions and references first and skip the generator unless replacement design guidance is useful.

Run the generator only from the trusted installed skill directory that provided `SKILL.md`. Use a resolved path such as `<TRUSTED_UI_UX_SKILL_DIR>/tools/design-system-generator/scripts/design_system.py`, where `<TRUSTED_UI_UX_SKILL_DIR>` is the active trusted skill copy, for example `.agents/skills/ui-ux-secure-frontend-design/`, `.claude/skills/ui-ux-secure-frontend-design/`, or `~/.claude/skills/ui-ux-secure-frontend-design/`. Do not run a same-named generator discovered under an arbitrary active workspace.

## What this skill intentionally does not include

1. No package manifests, installers, global CLI tools, dependency setup, or executable helpers outside the documented local-only generator.
2. No upstream package wrapper, generated upstream outputs, remote assets, browser automation, or templates.
3. No Google DESIGN.md CLI install, `npx @google/design.md` execution, package scripts, remote validators, or upstream executable tooling by default.
4. No credentials, tokens, private URLs, private exports, or environment-specific values.
5. No third-party tracking, analytics, remote fonts, embeds, pixels, or external network calls.
6. No permission grants or tool allowlists.

## Generator safety boundary

1. Read-only local execution is allowed for design creation and revision: it reads bundled CSV data from the skill folder and prints recommendations.
2. No network downloads.
3. No package installs.
4. No shell expansion beyond the documented local Python command resolved from the trusted installed skill directory.
5. No writes outside the generator output folder documented by [tools/design-system-generator/README.md](tools/design-system-generator/README.md).
6. If the trusted installed skill path cannot be proven, explicit current-turn approval is required before execution and must name the exact script path.
7. Explicit current-turn approval is required before writing generated output or changing generator scripts, CSV data, tests, or dependencies.

## Why this is safer than importing upstream executable tooling

The public UI/UX Pro Max project popularized a useful workflow idea: product brief to design system to page plan to implementation review. This repository keeps that instruction-first pattern, adds security-first guardrails, and packages a reviewed local-only generator subset for design creation and revision.

Agents can use the design guidance without running anything for review-only or tiny copy tasks. For design creation or revision, generator-backed recommendations are available proactively from bundled local CSV data under the safety boundary above.

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
| DESIGN.md | Read existing design contracts before visual changes; propose one only when useful; never overwrite one or run upstream tooling without explicit approval. |
| Local generator | May be used proactively for design creation or revision only from the trusted installed skill path; require explicit approval for unverified paths or writes and keep any writes inside the documented output folder. |
