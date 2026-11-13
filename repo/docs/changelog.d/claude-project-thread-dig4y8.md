### Fixed

- **Governance App check test:** the check that a missing governance App never changes the conformance exit code now runs the App reader for both a found and a missing App, and compares the drift findings as well as the exit code. Before, it ran offline, so the reader never ran and the check proved nothing.
- **Code comment:** the evidence-store exemption comment in the governance state script sits above the function it describes again.
