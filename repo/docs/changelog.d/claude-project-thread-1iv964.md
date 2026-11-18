### Fixed

- **Same-role gate after an accepted one:** The Projects **Gate assignments** step and the programme reconciler's **Gates** rule now say that a second G0, a delta G2 after a PASS or a G2 recheck with no G1 round between is opened with `reopen --issue <n> --assignment <id> --reason`, since both `assign` forms are refused (`GATE_STATE`) once that role's gate is accepted. A holder-order test runs all three cases and pins both texts.
