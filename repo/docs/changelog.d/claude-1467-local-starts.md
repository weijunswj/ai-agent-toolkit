### Changed

- **Work starts on the owner's computer:** every controller, cloud or local, now starts its sessions, lanes, gate runs and threads on the owner's computer. A cloud start needs the owner to start it or agree to it in chat. When the computer is busy or away, the work waits and the controller says so in one line; nothing falls back to the cloud. Scheduled tasks that already run in the cloud are unchanged.
- **Projects runs local first:** the Projects skill's "Cloud first" rule is now "Local first", new projects get `remote_control` as their gate placement, and the managed project instructions say the same. Steps only a cloud thread can do (the guidebook copy into the project library, its after-merge fast refresh) ask the user first; the hourly nudge still refreshes the copy on its own.
- **Device evidence:** a local Remote Control thread archives its evidence to the transport store itself, and uses the shared folder only when it cannot reach the store.
