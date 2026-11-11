Title: Mixed stack removed, device-offline alert
### Removed

- The stack registry ships two stacks only, `owner-gpt` and `owner-claude`. The mixed stack `claude-projects-stack` (older name `owner-mixed`) and its `GATEKEEPER` route are gone from the registry, its schemas and the role list, so a decision or a captured registry that names one is refused.

### Changed

- A gatekeeper is no registry role. It is a launcher session on the mid tier at medium effort, stated in the controller rules and on the cost-control ladder, never the small tier, and a raise needs its written reason.
- Installed Codex helper files that name a removed mixed stack are refreshed from `owner-gpt`, which has the same helper model and effort. Setup says so in one line. Any other unknown stack name is still held.

### Added

- The Projects coordinator alerts the owner when a device with unfinished lanes goes offline: one notifying ask per outage that names the device, links each affected thread and gives the one step, kept under the waiting list until the device is back. The hourly nudge lists such lanes under its owner steps and starts its report with `DEVICE OFFLINE: <n> | `. A failed status read is reported as not checked, never as offline.
