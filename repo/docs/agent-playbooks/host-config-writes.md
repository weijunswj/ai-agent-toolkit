# Host configuration writes

Applies to any Toolkit code that writes a host configuration, including Codex,
Claude Code and future OpenCode support, including native CLI commands that change those files. Read before changing a writer or its tests.

1. Derive value limits from the host's source or documentation. Cite that source
   beside the code and derive tests from it. Never assert that a value is valid
   without a source; record any missing source explicitly.
2. Back up the exact previous bytes before writing. After writing, verify that the
   host loads the effective configuration. On failure, automatically restore the
   backup, read it back and plainly report the failure, restoration and backup path.
   Keep concurrent edits safe. An unavailable host is **not verified**, never success.
   Claude Code settings currently get exact read-back and JSON parsing; this proves
   file integrity only. Do not start a paid Claude session for an automated check.
3. G1 UAT must exercise every configuration-writing path with a real host restart
   and one successful turn. Include setup with **all recommended** in Codex Desktop,
   fully restart Codex, then complete one successful turn. Do the same in Claude
   Code. Test opt-outs, custom values, repair and removal paths when changed.
4. The G2 brief must explicitly check source-backed limits, post-write load checks
   and automatic rollback, plus the actual restart/turn UAT evidence in step 3.

Codex helper semantics: [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
and [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), read
2026-10-23. Codex CLI 0.164.0 additionally rejects a helper cap below 1 and accepts
only `chatgpt`, `codex`, `atlas` in a skill's product enum. These V1 sources do not
establish V2 thread-count semantics; keep that formula unchanged pending evidence.
