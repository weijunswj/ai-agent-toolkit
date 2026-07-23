# Codex And Claude Host Adapters

Codex and Claude consume the same logical provider target profile. Host-specific configuration is derived from that profile and must not change project-owned requirements or copy secrets into a repository.

## Shared Profile

The shared profile pins provider, target alias, environment, sanitized fingerprint, credential reference, audited interfaces, per-operation route, and schema/version digests. It contains no credential value or raw private origin.

## Codex

Use only current supported Codex configuration. MCP tool allowlists, denylists, default/per-tool approval modes, sandbox rules, and administrative requirements are technical controls. They do not authorise the owner task.

Provide only the exact MCP server/tool or connector configuration required by the audited route. Keep credential values in an approved credential store or process injection. Do not treat OAuth completion, an MCP tool annotation, a sandbox prompt, or an approval popup as the task-authorisation envelope.

## Claude Code

Use the narrowest supported scope that fits the owner decision: local, project, or user. Project MCP configuration is shared and therefore needs particular care; local/user state remains host-owned. Workspace trust and MCP approval are technical trust gates, not owner operational approval.

Do not use `headersHelper`, shell helpers, or project MCP configuration to smuggle secrets or unreviewed commands. Switching to Claude must retain the same logical target and operation audits without deleting Codex configuration.

For Toolkit-direct Claude n8n work, the native plugin adapter uses `UserPromptSubmit` to establish the bounded task, `PostToolUse:Skill` to record successful official Skill evidence, `PreToolUse` to deny governed workflow mutations while capabilities are missing, and `TaskCompleted`/`Stop` to deny a false completion claim. Technical permission prompts do not override that denial.

The adapter credits only a namespaced `n8n-skills:<skill>` invocation whose installed `n8n-skills@n8n-io` package is uniquely bound to version `1.0.2`, exact Claude manifest blob `f8075e42c536cce8c8495e2a1a6310273e186119`, and the pinned Skill blob. It accepts only the reviewed `1.0.2` package source at #244's compatibility baseline `2c26822deb522ea2862d864b0c808b767a13aa9a` or implementation-time current source `eb18fc3ab3e2820c748c2d84386fb5496efc1516`; the n8n Skill-content blobs are identical across those two exact commits. #244 still owns the separate Windows hook-repair compatibility remediation. Unqualified, missing, failed, stale, malformed, or ambiguous invocations do not satisfy the ledger.

Direct slash expansion is observable before completion and therefore does not by itself prove successful Skill loading. Use the actual `Skill` tool so a successful post-tool event can be attested.

## Codex n8n enforcement truth

Codex must follow the same logical n8n task ledger and fail-closed policy. This Toolkit version does not claim a Codex equivalent to Claude's governed-mutation `PreToolUse` hook. Report that limitation explicitly; do not convert a Codex permission prompt, generic test, or instruction cue into fake enforcement evidence.

## Capability Reporting

For each host/interface, report only operations proven by the capability audit. Installed, enabled, authenticated, trusted, or reachable does not mean sufficient.

Switching hosts must not require provider rediscovery, browser-history discovery, project configuration changes, secret copying, or removal of the other host's working configuration.
