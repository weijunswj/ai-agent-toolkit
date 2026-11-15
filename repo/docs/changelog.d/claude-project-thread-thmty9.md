### Changed

- **Review rounds have limits:** a High or Medium finding blocks only with proof, a failing test or a supported-path trace with the reason. An unproven Medium becomes a Low follow-up, and an unproven High goes to the owner's card instead of blocking on its own.
- **Rechecks after a FAIL are scope-locked:** they review the fix commits, the earlier findings and what the fixes reach. A new finding on code no fix touched blocks only if it is High and proved; anything else joins the PR's follow-up record.
- **Round cap:** after two FAIL verdicts on one PR, no further review round starts until the owner answers a card: ship with the open items as follow-ups (when none breaks the shipping floor), one more round, or split the PR. The controller counts the PR's FAIL verdict comments before each recheck, and the Projects coordinator's recheck briefs carry the scope lock and the FAIL count.
- **Gate rules budget:** the gate rules' byte cap rises from 14,400 to 15,150 to hold these rules.
