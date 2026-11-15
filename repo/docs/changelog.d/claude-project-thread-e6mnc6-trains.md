Title: side-by-side merge trains

### Merge trains

- **A held train no longer blocks the next:** two or more trains can now run side by side, each built on main on its own branch. When one lands, `catchup` on another that already carries its bump reverts that bump, merges main and bumps again from main's new version, on the same branch with no rebuild or force-push. The bump and its revert are recorded under `replaced_bumps` in the manifest, and `verify` accepts that revert only when it is recorded and identical to Git's own. A clash with main leaves the train exactly as it was. The train's last bump must still count from today's main, so `verify` refuses a train whose main moved until it catches up.
- **A member that landed elsewhere is never reverted:** when main already holds a member (it merged alone, or rode another train), `eject` refuses it, and `verify` (so `land` too) refuses a train that still reverts the boarding of a member main holds, whether the eject came before or after it landed, since landing the train would undo it on main. `land` names the safe step: rebuild the train on main from the other members.
- **Clearer land answer:** when main has moved, `land` now says to run `catchup` instead of rebuilding, and `catchup` refuses a train main already holds.
