Title: governance GitHub App setup and removal guidance

### Added

- **Governance GitHub App guidance:** publishing a pull request that turns governance on now shows the owner the one-time App setup: a pre-filled "New GitHub App" link with the right permissions, the install on the repository and its evidence store, and the `gh` lines that save the client ID variable and the private key secret. Publishing one that turns governance off suggests the removal: deleting the variable and the secret, removing the repository from the installation, and deleting the App when nothing else uses it. Toolkit never creates or deletes any of these itself.
- **`toolkit governance check` reports the App:** a missing App while governance is on, and a left-over variable or secret once it is off. It reads only the names, never changes the exit code, and reports anything it cannot read as unverified.
