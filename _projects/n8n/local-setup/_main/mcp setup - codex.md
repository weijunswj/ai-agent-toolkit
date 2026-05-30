# Codex MCP Setup

The primary local setup guide is [1. Local Setup](./_Page%201.%20Local%20Setup.md). This page is a secondary Codex reference, not a required local setup path.

## What This Adds

| Item | Use |
| --- | --- |
| `n8n_docs` | Node search and workflow validation using the community MCP. |
| `n8n_live` | Read or mutate the real n8n instance only after explicit approval. |
| Codex rules | Repo or user instructions for safer agent behavior. |
| Codex MCP config | User-scoped MCP server setup. |

## 1. Before You Start

1. Finish [1. Local Setup](./_Page%201.%20Local%20Setup.md) first if you are using local n8n.
2. You should already have:
   1. Docker Desktop installed if you are running local n8n.
   2. n8n running locally, through a tunnel, or on a hosted domain.
   3. Instance-level MCP enabled in n8n.
   4. The live n8n MCP server URL copied from n8n.
   5. A live n8n MCP token copied from n8n.

## 2. Install Codex

Codex is a platform extension. Ensure you have the Codex extension installed in your IDE.

## 3. Install Toolkit Skills For Codex

1. Copy the whole `skills/<skill-name>/` folder.
   - **Choose any one supported Codex skill-folder location:**

      | Scope | Skill folder location |
      | --- | --- |
      | Repo-local | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
      | User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
      | Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

   - Do not copy only `SKILL.md`. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.

## 4. Agent Rules

1. **If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**
   - Consider the following tools:

      | Need | Use |
      | --- | --- |
      | Generic Codex rules | [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) |
      | Full n8n operating contract | [n8n Agent Rules](../../../../skills/n8n-agent-rules/) |

## 5. Codex MCP Config

1. Use the [Codex MCP config](./templates/codex-mcp-config.md).
   - Add the configuration to your Codex setup.

## 6. Smoke Testing

Use docs-first/live-read-only smoke tests to verify the setup:

* Read workflows and test retrieving data.
* Do not perform live mutations without explicit confirmation.
* Ensure you always keep explicit confirmation enabled before live mutations.

## 7. Safety

* Keep your MCP token safe. Do not commit it to your repository.
* Avoid granting arbitrary shell-execution MCP tools.
