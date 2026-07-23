<!--
Generated from toolkit project source. Do not edit directly.
Project: cicd.repository-security-gate
Source: _projects/cicd/repository-security-gate/_main/docs/tool-adjudication.md
Update the project source and run sync.
-->
# Security Tool Licence and Provenance Adjudication

Verified 2026-07-23 from official upstream repositories and releases. Licence
digests are SHA-256 of the licence file at the exact tagged commit. Commercial
use means running the unmodified CLI in personal or commercial repositories;
redistribution decisions describe Toolkit's plan. Toolkit redistributes no
scanner binary.

| Candidate | Decision | Exact upstream evidence | Licence/use/redistribution decision | Initial role or gap |
| --- | --- | --- | --- | --- |
| Semgrep Community Edition engine | `DEFER` | [`semgrep/semgrep` v1.171.0](https://github.com/semgrep/semgrep/releases/tag/v1.171.0), commit `6e47ff626670a8bded8b527f61d709e2e332ec4b`, LGPL-2.1 licence SHA-256 `20c17d8b8c48a600800dfd14f95d5cb9ff47066a9641ddeab48dc54aec96e331` | LGPL-2.1 permits personal/commercial execution and conditional redistribution. The official GitHub release publishes no binary/checksum assets, so the gate cannot yet prove an immutable executable. Restricted Semgrep-maintained rules are not vendored. | Toolkit-owned static rules cover the initial focused source-pattern layer; semantic engine integration remains unverified. |
| Trivy | `ADOPT` | [`aquasecurity/trivy` v0.72.0](https://github.com/aquasecurity/trivy/releases/tag/v0.72.0), commit `8a32853686209a428179bb3a1688802b25691564`, Apache-2.0 licence SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`; official checksums and Sigstore bundles | Apache-2.0 permits personal/commercial use and redistribution with notices. Toolkit downloads, verifies, and runs the official CLI without redistributing it. | Filesystem dependency, secret-supporting, Docker/IaC, and misconfiguration coverage. Database/network failure is unverified. |
| OSV-Scanner | `ADOPT` | [`google/osv-scanner` v2.4.0](https://github.com/google/osv-scanner/releases/tag/v2.4.0), commit `b56b5191101d5f27d4787d5583d8d01e9518a7af`, Apache-2.0 licence SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`; official SHA256SUMS and SLSA provenance asset | Apache-2.0 permits personal/commercial use and redistribution with notices. Toolkit downloads the official binary and verifies SHA-256; it does not redistribute it. | Dependency/lockfile advisory cross-check and differential/full modes. |
| zizmor | `ADOPT` | [`zizmorcore/zizmor` v1.28.0](https://github.com/zizmorcore/zizmor/releases/tag/v1.28.0), commit `4381cc6339bb76a1004a99da929fe8f8f1143d94`, MIT licence SHA-256 `a6fd1bd18da7cec8284639d5b0d351b90934317be1b9f9ea94a077621c6f35af` | MIT permits personal/commercial use and redistribution with notice. Toolkit downloads and verifies the official CLI without redistribution. The publisher moved from `woodruffw` to `zizmorcore`; the current owner is locked. | GitHub Actions attack-surface analysis. |
| actionlint | `ADOPT` | [`rhysd/actionlint` v1.7.12](https://github.com/rhysd/actionlint/releases/tag/v1.7.12), commit `914e7df21a07ef503a81201c76d2b11c789d3fca`, MIT licence SHA-256 `03a26b06d224380a02bf100e05fff3b2dfc71b14d4e2fa685ec9963a87563c22`; official checksums asset | MIT permits personal/commercial use and redistribution with notice. Toolkit downloads and verifies the official CLI without redistribution. | Workflow syntax and expression checks. |
| OWASP ZAP | `DEFER` | [`zaproxy/zaproxy` v2.17.0](https://github.com/zaproxy/zaproxy/releases/tag/v2.17.0), commit `8a1bff313f4d183dba5aa154ecbe89ad751c9153`, Apache-2.0 licence SHA-256 `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1` | Apache-2.0 permits personal/commercial use and redistribution with notices. Suitability is not the blocker; this phase has no authorised isolated web target. | Architecture only. Preview/staging DAST belongs to later web/API consumers and can never default to production. |
| ShellCheck | `ADOPT` | [`koalaman/shellcheck` v0.11.0](https://github.com/koalaman/shellcheck/releases/tag/v0.11.0), commit `aac0823e6b58f8a499e856e93738082691cbf212`, GPL-3.0 licence SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` | GPL-3.0 permits personal/commercial execution. Redistribution would require GPL compliance; Toolkit therefore downloads the official binary and does not redistribute it. | Shell correctness and injection-supporting checks when shell files exist. |
| PSScriptAnalyzer | `ADOPT` | [`PowerShell/PSScriptAnalyzer` 1.25.0](https://github.com/PowerShell/PSScriptAnalyzer/releases/tag/1.25.0), commit `f05704df81b2aca17dc027ee39b3fce106d418fc`, MIT licence SHA-256 `646f8936b8ddcd14e13e578ff6857e368780b0d1a4f6066bee89211923a373e2` | MIT permits personal/commercial use and redistribution with notice. Toolkit downloads the official NuGet package, verifies SHA-256, and does not redistribute it. | PowerShell correctness/security checks when PowerShell files exist. |
| Gitleaks CLI | `ADOPT` | [`gitleaks/gitleaks` v8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1), commit `83d9cd684c87d95d656c1458ef04895a7f1cbd8e`, MIT licence SHA-256 `e3884b252b3bfc045e55be43a34d1e80da070bc6f804ac95bf4660e97d62ebc6`; official checksums asset | MIT permits personal/commercial use and redistribution with notice. Toolkit downloads and verifies the CLI directly and does not redistribute it. | Supporting secret-leakage layer with redacted output. |
| Gitleaks Action wrapper | `REJECT` | [`gitleaks/gitleaks-action`](https://github.com/gitleaks/gitleaks-action) has no repository licence assertion; the official Gitleaks README says `GITLEAKS_LICENSE` is required for organisations | Wrapper terms differ from the MIT CLI and are unsuitable as a free portable organisation gate. | Replaced with the pinned Gitleaks CLI. |

## Platform and output notes

- The initial immutable assets cover Ubuntu x86-64, the hosted Toolkit pilot.
  Upstream release assets also cover the platforms listed in `tool-lock.json`.
- Trivy, OSV-Scanner, zizmor, PSScriptAnalyzer, and Gitleaks expose JSON output.
  actionlint emits one JSON object per diagnostic through its documented format
  template. ShellCheck uses `--format=json`.
- GitHub Action wrappers are not used for scanners. Existing first-party
  workflow dependencies are pinned to immutable full commits and watched as
  separate action records.
- Official asset SHA-256 values are locked from GitHub release asset digests.
  Trivy Sigstore and OSV provenance identities are recorded where published.
