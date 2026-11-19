### Added

- **Close what you spawn:** the controller design principles now tell every controller to close each thread or session it started (gate, gatekeeper, lane) once it is fully done: its output is recorded, its PRs are merged or closed, its final message was read in full and every item acted on, its result was relayed and no owner test, card, question or decision is still owed. A host with no close action records the session retired. Never a scheduled task's home thread, and idleness alone never counts. Without timers, the controller re-checks open ones at session start and each owner turn. A new section 10 of the host contract gives each host's close action.

### Changed

- **Work runs where the controller runs:** the principle that sent every controller's work to the cloud and barred computer scheduled tasks now runs work on the controller's own side (a cloud controller in the cloud, a local one on its computer) unless a step needs the other side. Scheduled tasks prefer the cloud and are no longer barred from the computer. The Projects skill keeps its own cloud-first rule, so Projects behaves as before.
- **Host-neutral principles:** the design principles page names no harness; a test keeps it that way, and per-host mechanics live in the host contract.
