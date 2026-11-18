### Changed

- **Two review rounds per pull request:** the gate rules' round cap now gives each pull request two G2 rounds (every `Toolkit-G2:` verdict counts, deltas included) instead of holding the next round for an owner card after two FAIL verdicts. From round 2 only a proved High finding blocks: the verdict passes, open Mediums go to a follow-up child in Now and Lows to one in Later, and the controller sends the pull request to the merge train. A further round only rechecks the fix for a High that is still open. Proof rules, the scope lock and the root-cause reassessment after two failed rechecks of one family are unchanged.
- **Lows-only children wait in Later:** a follow-up child that holds only Low findings now sits in Later, and the three-day start applies to Now children only.
