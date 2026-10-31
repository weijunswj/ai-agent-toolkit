Title: Codex host contract
### Host contract
- The host contract now has a Codex helper table next to the Claude Code one: hook event, blocking output, failure and timeout, trust step, helper definitions, admission, depth, route proof and known limits.
- The first stored Codex helper result is in `repo/contracts/host-qualification/codex.json`: on Codex Desktop on Windows, the G1 helper served its pinned model and effort, and the hook refused a built-in agent and a model override.

### Codex qualification runner
- The unbound-launch cases now match the helper-launch rule: in governed work with no launcher binding, a named helper with no installed file is refused and one that matches the stack is admitted. They run against a scratch Codex home, so real helper files never decide them.
