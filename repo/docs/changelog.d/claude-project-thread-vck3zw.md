### Fixed

- **Programme file reading:** the cloud sweep gate and `toolkit permissions` now read the programme file the same way the sweep does. A hand-edited version 1 file that also carries a version 2 key, such as `governance: "disabled"`, no longer counts as governance on: the gate skips with a warning that the file is not valid, and `toolkit permissions` offers no repo block.
- **Remove Toolkit test:** the setup skill test now fails if the line allowing an app's own uninstall tool moves in front of the user's yes.
