### Changed

- **Takeover finds the controller handoff snapshot:** the controller bootstrap skill and the takeover playbook now read the evidence store's `evidence/handoff/controller/` when it exists, first of all when no project memory is reachable, so a successor on another account still gets the outgoing controller's owner rules, queue, promises and in-flight work. The snapshot is evidence, not authority: current state wins where they differ.
