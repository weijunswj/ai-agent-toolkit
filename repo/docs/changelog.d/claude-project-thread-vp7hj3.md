### Fixed

- **Holder orders stop at their expiry:** `run-order` reads the order's expiry again before every write, not only at the start. A run, including one the cloud sweep takes from the queue, that reaches the expiry makes no further write, keeps the log entries for the writes before it, reports `STOPPED` with `ORDER_EXPIRED` and files the queued order under `orders/refused/` with those results, so a later run never repeats or finishes it.
