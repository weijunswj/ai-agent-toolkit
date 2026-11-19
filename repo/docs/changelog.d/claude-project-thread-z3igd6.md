Title: governance bank reply fixes

### Changed

- **Rows left out stay as they are:** a governance bank reply that names only some rows now keeps every row it leaves out at its current value, so `1.4=A` changes the parallel CI shards answer and nothing else. `all recommended` still applies every recommendation.
- **Status rows sit below the table:** rows with nothing to answer, such as the evidence store, the parent issue and the required checks, no longer take a number in the table. They are listed under it as "Already set, nothing to answer here", each with how to change or stop it. Questions are numbered without gaps. When a number moves between showing the bank and the reply (a question became a status row, for example), the reply is not used and Toolkit asks the owner to see the new bank.
- **Shorter explain and plain errors:** `explain 1.4` gives the row's text without the verification and selected lines, and a reply naming a missing row says "This bank has no row 1.9." and asks again.
- **`toolkit permissions` puts the one command first:** the owner's one-paste `--apply` command now opens the print as well as closing it, and each guard is said once for all the lines it covers instead of once per line, which halves the print.
- **Commands in Toolkit's own code block:** the permissions command and the Governance App setup command are printed inside a code block from Toolkit, so the app showing them keeps their quotes straight.

### Fixed

- **One parallel CI shards pull request at a time:** while an answer pull request for parallel CI shards is open, row 1.4 shows it with how to merge or close it, and answering again prepares no second one.
