### Added

- Each app asks its own task auto-merge question during setup, with On recommended and an accurate Current choice. Answers are stored separately on this computer, validated strictly and written atomically with read-back and recovery.

### Changed

- The app-local answer is the only task auto-merge switch. Repository bindings no longer carry task permission, and governance reports the effective app setting without asking another question.
- Hooks, setup, governance, bindings, preference readers and writers, and merge or approval rules always wait for an owner-typed merge, alongside CI workflows and major releases. Rule-refresh pull requests retain their typed-merge requirement.
