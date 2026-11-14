Title: cloud sweep runs queued holder orders

### Added

- The cloud Programme Sweep now runs holder orders the controller queues in the private evidence store (`orders/pending/<order_id>.json`, or `.dry-run.json` for a rehearsal). Each runs at the start of the pass, inside the sweep lease, with `run-order`'s own rules, and is filed under `orders/done/` or `orders/refused/` with its result, so a controller with no shell no longer needs a session on a computer for its board writes. The run summary shows only counts and warns when an order was refused.
