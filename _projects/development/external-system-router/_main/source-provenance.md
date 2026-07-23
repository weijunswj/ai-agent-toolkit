# External System Router Source Provenance

This is first-party Toolkit source authored for TK-022. Current official Codex, Claude Code, Coolify, and n8n documentation informed factual host/provider contracts; no vendor text, code, schemas, credentials, private account material, provider output, or live state was copied into the module.

Authoritative implementation work was rebased before publication onto Toolkit `main` commit `97ce5306fc9c6bc438173bcb6cbca6e684077de5` on 2026-07-23.

The mandatory n8n admission contract reuses #244's exact official package identity and reviewed `1.0.2` compatibility baseline at `n8n-io/skills@2c26822deb522ea2862d864b0c808b767a13aa9a`. At implementation time, official `main` was `eb18fc3ab3e2820c748c2d84386fb5496efc1516`: the reviewed `1.0.2` Skill blobs and Claude plugin manifest blob `f8075e42c536cce8c8495e2a1a6310273e186119` were unchanged. Admission supports only those two exact package source commits and records which one was invoked. #244 continues to own the unresolved Windows hook-repair compatibility for `1.0.2`; this module does not absorb or claim that repair.
