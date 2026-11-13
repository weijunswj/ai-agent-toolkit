### Fixed

- Governance App setup no longer lets a second person overwrite an existing App by accident. When the repository already has the App variable or secret, setup says to reuse that App instead of offering a new one, and every printed save command asks for a typed `replace` before overwriting either fixed name; any other answer, or no answer, changes nothing.
