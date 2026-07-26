# Repository Security Gate Pack

Review and copy the entire `skills/repository-security-gate/` folder. Pin pack
version `1.2.1` in the consumer repository. The pack contains no scanner binary
or third-party rule pack; the installer accepts only official assets declared
in the checked-in lock and verifies SHA-256 before extraction.

The protected workflow must execute the wrapper from an exact trusted commit
and scan the separately checked-out candidate only as data. Active
suppressions and their compensating harness closure are protected pack
authority; candidate suppression metadata is proposal-only.
