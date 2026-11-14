### Fixed

- **Cloud sweep at the App limit:** a programme sweep pass that stops at GitHub's hourly App limit, or saves nothing, no longer counts as refreshed, so the footer clean-up never runs after it. A stop while reading state documents too large for one GraphQL read now carries the limit that bound it, so the sweep action sees it as an App-limit stop, reports it held and follows up once the limit resets.
