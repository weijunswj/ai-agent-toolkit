Title: shorter command list

### Changed

- **`toolkit cmd` lists only what you would type:** the list drops `toolkit governance enable`, `status`, `check`, `discover`, `catalogue`, `security` and `migrate`. Setup, agents and checks run those; they still work when typed as a whole message. Governance is now three rows: `setup governance` to turn it on, `refresh governance` to see and change its answers, and `toolkit governance disable` to turn it off.
- **`toolkit permissions` is on the list:** a new Permissions group shows it, with `toolkit permissions --apply` as the step you type in your own terminal.
