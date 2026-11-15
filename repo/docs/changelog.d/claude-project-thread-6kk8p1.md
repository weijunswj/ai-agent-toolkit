### Fixed

- The `controller-bootstrap` skill description no longer contains angle brackets, so claude.ai syncs the marketplace without warnings for it; the takeover phrase now reads "you are taking over as controller for [repo]" there.
- Toolkit validation now fails any skill whose description contains `<` or `>`, since claude.ai rejects XML tags in skill descriptions and strips the angle brackets.
