### Changed

- **State document reads:** a single read of a state document over 1 MB now uses the same blob read as the sweep's snapshot. Tests now pin the failure code for a blob that cannot be read, and cover a write of such a document read back at its own commit.
