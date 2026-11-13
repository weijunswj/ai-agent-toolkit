### Changed

- **Governance App setup:** The steps to save the App's Client ID and private key now lead with GitHub's website (Settings, Secrets and variables, Actions: the variable on the Variables tab, the whole `.pem` text on the Secrets tab), each step stopping if the name is already there, then say to delete the `.pem` file. The guarded `gh` commands stay as the other way. Removal leads with the same page.
