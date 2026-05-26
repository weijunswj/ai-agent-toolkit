<!--
Curated AI-facing source.
Project: n8n.workflow-toolkit
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# n8n Workflow Templates

This skill contains reviewed public n8n workflow JSON templates.

Templates here are intended to be copied into consumer repos only after review.

This skill depends on `n8n-agent-rules`. Apply that skill before editing, validating, importing, activating, executing, or syncing any n8n workflow JSON.

## Included Templates

- [Global Error Handler](templates/error-handling/global-error-handler.template.json)
- [RAG Customer Support Agent](templates/chatbot-with-RAG/customer-support-agent.workflow.template.json)
- [RAG Knowledge Base Ingestion](templates/chatbot-with-RAG/rag-ingestion.workflow.template.json)

## Safety Rules

- Keep templates inactive.
- Do not add credentials or credential bindings.
- Do not add live workflow IDs or webhook IDs.
- Do not add product, customer, or private environment data.
- Use placeholders for non-secret manual configuration.

Use the helper-script skill when you need sanitizer, validation, import/export, compare, prepare, or sync helpers.

A generated cross-skill reference is available at [references/n8n-agent-rules.md](references/n8n-agent-rules.md) for copy-paste portability. It is generated from the canonical `development.ai-coding-agent-rules` source and must not be edited directly.
