# Backup And Recovery Contract

The provider-neutral rules for backing up a live service and proving it can be restored. Platform skills (for example a Coolify or Hostinger skill) apply this contract with their own steps; they do not restate or loosen it.

## What to back up

- Back up production only by default. Alpha, test, preview and staging environments are left out unless the owner asks for them.
- Cover each part on its own, because one backup rarely covers them all:
  - databases;
  - persistent app files (volumes, uploads, mounted folders);
  - the platform's own control plane (its settings, projects and deployment history) and the encryption key it needs to read restored secrets.
- A platform's own instance backup usually covers its control plane only, not the apps' data. Check what the platform says it covers; never assume.

## Where it goes

- One consistently named off-host bucket per project for production, for example `<project>-production-backups`, and a separate destination for the control plane.
- Write the destination's name, provider and environment into the operation plan, read back from the provider, and run the preflight check before creating or changing it.
- The encryption key and any restore credentials live in the owner's credential store or the server's private env file, never in the bucket listing, chat, git or a report.

## How many to keep

- Keep seven local copies.
- Leave an existing remote retention policy as it is. Where none exists, ask the owner for one; never invent it.
- Read retention values with the provider's meaning: on some platforms, including Coolify, a value of `0` means unlimited, not none kept.

## Four kinds of evidence

Each claim needs its own evidence. Never report a higher level than the evidence held.

| Evidence held | Allowed claim |
|---|---|
| a schedule is set | "configured", not "backed up" |
| a run reports success | "local copy made" |
| a run reports success with an off-host upload warning | "local copy only; off-host upload failed" |
| the object appears in the off-host listing | "uploaded", not "recoverable" |
| the bytes were retrieved from off-host and the checksum matched | "retrievable" |
| restored into a temporary isolated target and checked | "database recoverable" (or "files recoverable", for the scope restored) |
| plus the encryption key is held and an isolated app check passed | "fully recoverable" |

A database-only restore proves database recovery only. Full recovery also needs the encryption key and an app check on an isolated copy.

## Restore drills

- Use clearly temporary resources: a temporary name, a data rule, a cleanup owner, an end date and a provider read-back when they are removed. The preflight check holds a plan that lacks any of these.
- Never silently use production data in a drill. If the drill needs it, the owner's approval names that data and where it may go.
- A drill is a live change: the owner approves the exact targets and the cleanup first.
