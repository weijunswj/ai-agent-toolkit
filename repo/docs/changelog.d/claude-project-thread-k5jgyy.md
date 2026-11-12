### Fixed

- The cloud programme sweep no longer refuses its evidence store as "not writable". A GitHub App installation token's repository read carries no permissions list, so the cloud sweep now relies on the Contents write its workflow minted for that one store. A computer's pass still needs its signed-in account to have push access, and a write the token lacks still fails.
