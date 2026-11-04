### Fixed
- The Projects setup relay now covers a brief that only asks to read or report on the Controller, and coordinator workers as well as threads. It also carries the missing-folder steps a coordinator needs to start setup, and the relaying session stops and waits after reporting.
- A setup step's own brief can now carry out that step, including the takeover record in a takeover from an existing controller, so the relay's write ban no longer stalls setup there.
- Restored rule wording shortened in the earlier relay change.

### Changed
- Raised the Controller size budget from 18,000 to 18,500 bytes so rule wording is not cut.
