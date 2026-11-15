# Recovery Identity

When an approved operation creates or picks an outside resource that later work depends on, the exact identity of that resource is kept where a later session can find it. Chat memory, a broad provider listing or a guess from a name never count as recovery state.

## Where an identity lives

Use the smallest store that matches the identity's lifetime. Public pages, issues and pull requests carry only the key name or the store's location.

| Lifetime | Store |
|---|---|
| Temporary resource needed across sessions on one computer (scratch branch, preview app, restore database) | `scripts/recovery-identity.cjs`, which keeps one file per key in `~/.ai-agent-toolkit/recovery-identities` and deletes it when the resource is removed |
| Temporary resource needed by a later session on another computer or container | The same script with `--state-dir` set to a folder that later session can read, such as a project's shared folder |
| Reusable owner credential | `toolkit env`, by key name only |
| Long-lived or shared resource | The platform's own configuration, such as deployment platform variables or CI variables and secrets |

No new vault or custody service is added.

## The rules

1. **Claim before creating.** `claim` records the exact name, scope, provider, environment and kind before the resource exists, with a cleanup owner and an end date. A key that already has a record is refused, so a second session can never create a duplicate. Two sessions claiming at once: only one wins.
2. **Record from the provider.** After creating, read the resource back from the provider by its exact name and run `record` with that read-back. It keeps the provider's exact handle only when every field matches the claim.
3. **Resolve, then check.** A later session runs `resolve`, reads back that exact handle in that scope, and runs `check` before using it. Never list the provider to find it.
4. **Stop on anything unclear.** No record, a damaged record, a claim never recorded (the create may have run), a read-back that differs or a resource the provider says is gone all hold the work. Never guess, create a replacement, or rename, delete or move a live resource to fit; the owner decides.
5. **Dispose from the provider.** After removing the resource, read back its absence by the exact handle and run `dispose`; only then is the record deleted. A claim whose create never ran is disposed the same way, by its exact name.

## States

| State | `claim` | `record` | `resolve` | `check` | `dispose` |
|---|---|---|---|---|---|
| No record | Claimed | Hold: missing | Hold: missing | Hold: missing | Hold: missing |
| Claimed | Hold: exists | Recorded when the read-back matches and exists | Hold: unclear | Hold: unclear | Deleted when the read-back says gone |
| Recorded | Hold: exists | Hold: exists | Handle and scope | OK when the read-back matches by handle | Deleted when the read-back says gone, by handle |
| Damaged | Hold: unreadable | Hold: unreadable | Hold: unreadable | Hold: unreadable | Hold: unreadable |

A hold never changes the record. Inputs carry names and handles only: a secret value refuses the input.

## Reasons

| Reason | What to do |
|---|---|
| `RECOVERY_IDENTITY_MISSING` | No record: never guess, search the provider or create a replacement. Ask the owner. |
| `RECOVERY_IDENTITY_EXISTS` | Use the record it shows; never create a second resource. |
| `RECOVERY_IDENTITY_UNCLEAR` | A claim was never recorded. Read back the exact name, then `record` it if it exists or `dispose` the claim if it does not. |
| `RECOVERY_IDENTITY_UNREADABLE` | The record is damaged. Stop and ask the owner; never rebuild it from a listing. |
| `RECOVERY_IDENTITY_MISMATCH` | The provider differs from the record. Never rename, delete or move anything to fit; the owner decides. |
| `RECOVERY_RESOURCE_GONE` | The provider says the resource is gone. A replacement needs the owner's approval. |
| `RECOVERY_RESOURCE_STILL_PRESENT` | Remove the resource first, then dispose with a read-back that says it is gone. |
| `INPUT_INVALID`, `SECRET_IN_INPUT` | Fix the input; replace any value with its key name and treat a pasted value as exposed. |
