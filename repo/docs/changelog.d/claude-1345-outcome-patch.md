Title: one-task catalogue patches

### Added

- `update-parent` takes a one-task catalogue patch: `{"outcome": {"issue": n, ...}}` sets `name`, `description`, `order`, `last`, `priority`, `size` or `after` on that task (`null` removes an optional field), and `{"move": {"issue": n, "after": m}}` slots task n right after m in the hand order, renumbering only the tasks after the slot. Every other task stays byte-identical, so a holder order no longer resends the whole catalogue.

### Changed

- A parent patch changes the catalogue with exactly one of `outcomes`, `outcome` or `move`; an unknown task (`OUTCOME_UNKNOWN`), an unknown field or a move after itself is refused and writes nothing. The reconciler skill says to write holder orders as compact JSON.
