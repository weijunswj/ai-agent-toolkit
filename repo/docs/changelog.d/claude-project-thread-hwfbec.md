Title: governance App setup command

### Added

- `toolkit governance` shows a Governance App row that recommends Set up whenever governance is on or being turned on. Set up prints one command for the owner to run in their own terminal: it makes the repository's App through GitHub's App manifest flow (the owner only clicks Create), saves its Client ID and private key on the repository without the key ever being printed or written to disk, opens the install page and checks the installation. Keep current means not now: governance works without the App.
