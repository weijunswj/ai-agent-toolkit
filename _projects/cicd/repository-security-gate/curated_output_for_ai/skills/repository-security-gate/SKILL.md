---
name: repository-security-gate
description: Use when classifying a repository for Toolkit security profiles, integrating or running the repository-owned security gate, validating scanner locks or suppressions, inspecting sanitised security evidence, or generating a stable-head security-review packet.
---

# Repository Security Gate

Use this explicit-only skill for the deterministic Toolkit security gate.

1. Read `references/architecture.md` and `config/security-policy.json`.
2. Run `node tools/security-gate.cjs classify --repo <repository>`.
3. Validate the lock before any scanner execution:
   `node tools/security-gate.cjs validate-lock`.
4. Run the applicable `pr`, `full`, `scheduled`, or `release` mode.
5. Treat missing tools, invalid output, checksum/publisher mismatch, stale required
   data, or parser failure as unverified/blocked, never as pass.
6. Use only repository-relative, sanitised JSON and Markdown evidence.
7. Generate `review-packet` only for a stable exact head when deterministic
   evidence is green and risk classification requires independent review.

Do not invoke Codex Security, paid dashboards, SARIF upload, live providers,
production targets, credentials, Docker, browser history, private/customer
data, or active DAST through this skill. Candidate scanner execution belongs
only in the separate quarantined reviewed workflow.
