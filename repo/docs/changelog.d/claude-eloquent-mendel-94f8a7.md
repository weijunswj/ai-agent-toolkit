### Added

- Toolkit's own CI now checks that every hook is harness-specific: each hooks.json command has a scope row naming its harness, the hard rules it enforces and why each event is the moment that matters, no script serves two harnesses, and modules both harnesses load hold no harness tool names, environment names or output fields. The mixing that exists today is listed as known open items that may only shrink.
- The hook design playbook gains "Harness-specific by default": per-harness entries and dialects, hard rules written once in shared policy, and the event test for choosing when a hook runs.
