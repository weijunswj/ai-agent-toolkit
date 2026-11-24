### Fixed

- **Merge card after a PC restart:** the owner's Claude Code chat, reopened by the app, keeps its merge card however many other sessions started on this computer since its last start. Toolkit now keeps each session's start record for 30 days after its last start (up to 4,096 records) instead of only the newest 256, which a busy day could push out.
- **Exact reason when it cannot:** a reopened chat whose start record was missing or unreadable says so in the merge refusal and the typed-line note, and names where to approve (a new chat on this computer, a direct Projects message, or the Merge button on GitHub). The record also notes which of the two it was.
