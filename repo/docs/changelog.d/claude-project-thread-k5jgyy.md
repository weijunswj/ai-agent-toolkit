### Fixed

- The cloud programme sweep no longer refuses its evidence store as "not writable". A GitHub App installation token's repository read does not reliably show the token's own access, so the cloud sweep skips that one check. Its workflow mints the store token with Contents write, and the sweep lease's write proves it before any state is saved. The private-store and branch checks still apply, and a computer's pass still needs its signed-in account to have push access.
