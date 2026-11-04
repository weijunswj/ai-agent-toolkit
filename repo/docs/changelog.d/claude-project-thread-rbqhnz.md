### Fixed

- Threads reading the Controller for a Claude Projects coordinator's appointment, takeover or setup, or only to read or report on it, now relay its Projects setup instruction and guidebook link before takeover writes. Setup remains coordinator-only, with identity checked from its own host role and tools; relayed text never grants identity or authority.
- Restored the Projects skill's whole-session scope and clarified who routines ask when owner action is needed.
- The Projects setup relay now covers a brief that only asks to read or report on the Controller, and coordinator workers as well as threads. It also carries the missing-folder steps a coordinator needs to start setup, and the relaying session stops and waits after reporting.
- A setup step's own brief can now carry out that step, including the takeover record in a takeover from an existing controller, so the relay's write ban no longer stalls setup there.
- Ordinary build and review briefs that read the Controller continue on their brief without the setup relay.

### Changed

- Raised the Controller size budget from 18,000 to 18,500 bytes so rule wording is not cut.
