### Fixed

- The plain-text check's starting baseline leaves out findings in file names it cannot store (`:`, `\` or control characters) and says how many, so the next run fails on those findings instead of failing to read the baseline.
- `--migrate-baseline` runs even while the check is switched off, says so, and reminds you that git history still holds the old text, so a real token stored there needs revoking. Running it on a baseline that already uses fingerprints says nothing changed.
- The old baseline format notice says "old format" instead of "v1", and the installer prints it when it keeps such a baseline, not only on `--check`.
- Success lines say "1 entry", not "1 entries", and the Toolkit's own plain-text check names a bad option or missing value instead of a vague error.
- In a Toolkit checkout, the personal-data guard installer warns about a leftover plain-text check copy under `.github/scripts/` and `--check` reports it as drift, as it already did for a leftover guard copy.
