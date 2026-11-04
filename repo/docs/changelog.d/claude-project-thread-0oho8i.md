### Fixed

- Keep standing task auto-merge for a user-started session reconnecting with the same session ID when the resume has no inherited host-session variable. A resume carrying that variable revokes standing for that session ID, including after later resumes without it. Forks, unknown origins and automated sessions still need typed approval.
- Refuse explicit commands that feed a session-start event to Toolkit's hook scripts.
- Name the failed standing merge check in refusals and provide a read-only merge check through the session's hook context without consuming approval.
