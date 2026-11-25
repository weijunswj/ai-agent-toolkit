### Added

- **One takeover command:** `programme.cjs takeover` takes over as controller of a governed programme. The dry run, which any session may make, reads and prints the facts, whether the old controller has stopped, every hold and the record it would post. `--apply --controller` posts the record, reads it back, claims and reads the claim back, in seconds however many tasks there are.
- **Stop proof from the old controller's own last write:** its state commits, its comments on the parent and its merges to the default branch, by GitHub's clock. It must be 10 minutes old at the record and still the last one after it. Less takes the owner's own words (`--owner-stop`), quoted in the record. A source that cannot be read, or a takeover from another account than the old controller's, is refused.
- **Safe to run again:** a run that stopped early claims with its own unused record, an answer that never came back is settled by reading, a record number another comment took first moves to the next free one, and a record that can no longer carry a claim is marked `NOT USED:`.

### Changed

- A sweep that writes between the record and the claim no longer voids a takeover. State commits a refresh makes end with ` (refresh)`, so they are told apart from the controller's.
- A replacement controller takes a new name; taking over under the holder's own name is refused and suggests the next one.
- The permission blocks ask before `takeover`, and the takeover playbook's record step runs the command.

### Removed

- `claim --parent`, with `--takeover` on the parent and `--takeover-record`: `takeover` is the only way a parent's epoch moves after it is created. `claim --issue <n> --lane` stays for lane controllers.
