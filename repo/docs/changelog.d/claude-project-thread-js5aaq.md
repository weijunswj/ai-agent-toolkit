### Fixed

- Controller takeover relay packs now record dependent heads and final reads so stale results are refused.
- Evidence-store pushes refused by the hook use a fixed records branch with read-back and a pull request where applicable, keeping merge approval requirements.
- Relay pack times come from observed timestamps, with an explicit unknown value when no time is available.
- Capability checks distinguish denied read probes from native write denials, preserve prepared files and offer only routes with their own permission.
