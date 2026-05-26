---
name: n8n-workflow-templates
description: Use when selecting, reviewing, or copying public reusable n8n workflow JSON templates that must be generic, inactive, credential-free, and safe for publication, after applying n8n-agent-rules.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: n8n.workflow-toolkit
Source: _projects/n8n/workflow-toolkit/curated_output_for_ai/skills/n8n-workflow-templates/SKILL.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Workflow Templates

Use this instruction-only skill when the user wants actual reusable n8n workflow JSON templates.

Apply `n8n-agent-rules` first for the full n8n operating contract. A generated local copy is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for portability.

## Use When

- Reviewing public n8n workflow templates.
- Copying a generic inactive workflow template into a consumer repo.
- Checking that a workflow template has no credentials, live IDs, or customer data.
- Explaining required manual configuration for a template.

## Do Not Use When

- The task is only about helper scripts, sanitizer scripts, validation scripts, or repo/live sync helpers.
- The workflow JSON is product-specific, customer-specific, private, active, or credential-bound.
- The request would import, execute, activate, publish, or mutate a live n8n workflow without explicit confirmation.

## Rules

- Templates must be public, generic, inactive, and credential-free.
- Follow `n8n-agent-rules` for workflow JSON, n8n MCP, `n8n_docs`, `n8n_live`, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, and live n8n safety.
- Do not include live workflow IDs, live webhook IDs, credential bindings, credential names that reveal private context, `.env` values, private URLs, customer data, or live import/export payloads.
- Required manual configuration may be documented for non-secret literal placeholders.
- Do not run live n8n actions from this toolkit repo.

## Templates

- `templates/error-handling/global-error-handler.template.json`: generic inactive global error-handler template.
- `templates/chatbot-with-RAG/customer-support-agent.workflow.template.json`: generic inactive RAG customer-support workflow template.
- `templates/chatbot-with-RAG/rag-ingestion.workflow.template.json`: generic inactive RAG knowledge-base ingestion workflow template.

## Output

Report:

- Template selected.
- Safety checks performed.
- Required non-secret manual configuration.
- Any reason the template should not be copied or published.
