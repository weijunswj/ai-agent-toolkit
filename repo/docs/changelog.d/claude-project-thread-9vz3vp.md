### Fixed

- **Source-watch reports keep old trackers as history:** a test now pins that both report builders (third-party source updates and advisory targets) show a review cursor's tracker only under the "Tracker at last review (history; find the current owner at triage)" label, so a later edit cannot quietly present a closed task as the current owner.
- The host-change review template now routes each finding to the smallest open task that owns that area now and cites closed or retired tasks only as history, and the source-watch README says a new or advanced cursor names the open task that owns the follow-up.
