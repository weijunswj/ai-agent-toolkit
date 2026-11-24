# Host model and effort settings

Model and effort settings for each app. The ladder and the rules are in [SKILL.md](../SKILL.md).

| Host | Small / Mid / Top | Model | Effort |
| --- | --- | --- | --- |
| Claude (Projects threads and tasks, Claude Code, routines) | Haiku / Sonnet / Opus | The thread or session model; a routine's model selector; a subagent file's `model` field | `/effort` or the session effort; a subagent file's `effort` field (levels depend on the model) |
| Codex | the account's small, standard and top models | `model` in config, or the automation's model menu | `model_reasoning_effort` (levels depend on the model) |
| OpenCode and other multi-vendor harnesses | the vendor's small, mid and top models | the agent's `model` (`provider/model`) | the model variant where the vendor offers one (`provider/model#variant`) |

## Closing threads

Host skills, where a host has them, say which pass does the closing. For Claude Projects, that is the `web-controller-projects` skill.
