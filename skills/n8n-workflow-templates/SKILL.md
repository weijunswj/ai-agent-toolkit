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
- Follow `n8n-agent-rules` for [official n8n Skills](https://github.com/n8n-io/skills), their entry-point meta-skill currently named `using-n8n-skills-official`, workflow JSON, official n8n MCP, `n8n_live`, import/export, validation, credentials, webhook IDs, activation, execution, repo/live sync, and live n8n safety.
- Do not include live workflow IDs, live webhook IDs, credential bindings, credential names that reveal private context, `.env` values, private URLs, customer data, or live import/export payloads.
- Required manual configuration may be documented for non-secret literal placeholders.
- Do not run live n8n actions from this toolkit repo.
- Do not copy `.env`, private keys, `.tmp`, `.n8n-local`, generated package artifacts, live exports, live imports, credential files, or unrelated workflow files.
- Do not weaken validators, tests, security gates, approval gates, or CI failure reporting to make a template pass.
- Do not introduce arbitrary shell-execution MCP or tooling risks while selecting, validating, copying, or publishing templates.

## Template Selection And Copy Procedure

1. Read the template index at [templates/README.md](templates/README.md) before selecting a template.
2. Select only the template or templates that directly match the user's request. Do not bulk-copy the template folder or unrelated workflow JSON.
3. Inspect each selected JSON template before copying it. Check the full workflow object, including nodes, credentials, settings, pinned data, static data, trigger/webhook fields, HTTP headers, expressions, sticky notes, and example payloads.
4. Verify each selected template is:
   - Generic and safe for publication.
   - Inactive and safe by default.
   - Credential-free, with no credential bindings or sensitive credential names.
   - Free of secret values, tokens, passwords, private keys, API keys, cookies, bearer headers, `.env` values, and private URLs.
   - Free of live workflow IDs, live webhook IDs, live endpoint payloads, pinned production data, customer data, and product-specific runtime state.
5. Validate the selected template before copy or publication. Prefer an available local validator, for example from this toolkit repo root:

   ```sh
   node skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs <template-directory-or-file>
   ```

   If the consumer repo has its own validator or schema check, run the smallest relevant local validation there too.
6. Copy only the selected safe template files to the requested local target path after validation passes. Preserve clear template filenames and do not copy live import/export files.
7. If the request would import, export, execute, activate, publish, mutate, or otherwise touch a live n8n workflow or external system, pause first. Explain the risk, name the exact target and action, and ask for explicit current-turn approval before proceeding.

## Templates

- `templates/error-handling/global-error-handler.template.json`: generic inactive global error-handler template.
- `templates/chatbot-with-RAG/customer-support-agent.workflow.template.json`: generic inactive RAG customer-support workflow template.
- `templates/chatbot-with-RAG/rag-ingestion.workflow.template.json`: generic inactive RAG knowledge-base ingestion workflow template.

## Output

Report:

- Template selected.
- Copied path, if a template was copied.
- Safety checks performed.
- Validation command and result.
- Required non-secret manual configuration.
- Any reason the template should not be copied or published.
