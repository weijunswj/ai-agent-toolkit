### Fixed

- **State commit read-back:** when GitHub's answer for a created state tree does not list a nested file, the check after a state commit now compares Git's own blob id of the written text. It no longer depends on how that answer is shaped. A blob id that does not match is still refused.
