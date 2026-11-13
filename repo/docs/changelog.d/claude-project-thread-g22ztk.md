### Changed

- An acknowledged programme finding is now a promise: `ack` needs `--next <step>` and sets a due time (24 hours ahead unless `--due` gives one, at most 72). Past due the finding is new again, counts as waiting on the owner at once, and `attention` prints it as OVERDUE with the promised step. Acknowledgements made before this change fall due 24 hours after their last change.
- A holder order's dry run now runs every write against an in-memory copy with the same checks as the real run, and reports each write as `WOULD_RUN` or `REFUSED` with its code. An order whose `ack` step or `dispose` reason is over 200 characters is refused whole.
- Every reported finding prints its next step; findings that printed "undefined" now print their code's next action.
- The board's "Sweep stuck" warning is also a `SWEEP_STUCK` finding, so it reaches the Attention line. Only a sweep pass resolves it.
- Session-start lines for programme attention, a failing hourly sweep and a failed checkpoint now end with who acts and when.
- The Projects daily check-in reads device task-health files from the evidence store and adds their flags to `TASK FAILING`.
- A merge record names the G2 report's evidence-store path and PASS head, and the report is archived before the record. A cloud session that cannot write the state store hands holder orders to a computer session with the order's expiry as the deadline.
