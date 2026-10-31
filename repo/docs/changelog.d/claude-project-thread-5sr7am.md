### Changed

- `toolkit env edit` now names its private edit file `env-edit-<id>.env` and still opens it in Notepad by its full path, never through the app Windows links to `.env` files. A leftover `.txt` edit file from an earlier version is wiped, never applied; after an update in the middle of an edit, the saves the earlier version already applied are still reported by name.
