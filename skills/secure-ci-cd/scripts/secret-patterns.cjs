'use strict';

// Secret patterns: one list of high-confidence credential formats, shared by the local security
// scan and any other Toolkit secret check (for example one before a push). Zero dependencies.
//
// Each pattern is a provider's published token shape: a fixed prefix, an exact length (or the
// documented range) and a fixed character set, bounded so it cannot match inside a longer word.
// There is no entropy guessing and no "random-looking string" rule, so ordinary hashes, IDs and
// prose never match. A match is skipped when it is plainly a placeholder (EXAMPLE, xxxx, <...>,
// ${VAR}, a long run of one character), and a line can carry a reviewed exception:
//
//   secret-scan: allow <reason>
//
// on the same line (a marker without a reason does not count). Results name the rule, line and
// column only: no function here returns any part of a match.
//
// Interface (stable): PATTERNS, scanText(text), scanLines(lines), isPlaceholder(value),
// ALLOW_MARKER.

// Characters that may sit next to a token without being part of it.
const LEFT = '(?<![A-Za-z0-9_\\-+/.])';
const RIGHT = '(?![A-Za-z0-9_\\-+/=])';

function rule(id, label, body, { bounded = true, next = null } = {}) {
  return Object.freeze({ id, label, regex: new RegExp(bounded ? `${LEFT}(?:${body})${RIGHT}` : body, 'g'), next });
}

const PATTERNS = Object.freeze([
  // GitHub: prefixes from GitHub's token format announcement; 36 letters or digits after the prefix today.
  rule('github-token', 'GitHub token', '(?:ghp|gho|ghu|ghr)_[A-Za-z0-9]{36}'),
  // GitHub App installation tokens are now a ghs_-prefixed JWT of about 520 characters; this is the
  // pattern GitHub's changelog gives for them (bounded here), which also covers the older 36-character form.
  rule('github-installation-token', 'GitHub App installation token', 'ghs_[A-Za-z0-9._\\-]{36,2048}'),
  rule('github-fine-grained-token', 'GitHub fine-grained token', 'github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}'),
  rule('gitlab-token', 'GitLab personal access token', 'glpat-[A-Za-z0-9_\\-]{20}'),
  rule('slack-token', 'Slack bot or user token', 'xox[bpae]-[0-9]{10,13}-[0-9]{10,13}(?:-[0-9]{10,13})?-[A-Za-z0-9]{24,32}'),
  rule('slack-app-token', 'Slack app-level token', 'xapp-[0-9]-[A-Z0-9]{9,11}-[0-9]{10,13}-[a-f0-9]{64}'),
  rule('slack-webhook', 'Slack incoming webhook URL', 'https://hooks\\.slack\\.com/services/T[A-Z0-9]{8,11}/B[A-Z0-9]{8,11}/[A-Za-z0-9]{24}'),
  rule('aws-access-key-id', 'AWS access key ID', '(?:AKIA|ASIA)[A-Z2-7]{16}'),
  rule('stripe-secret-key', 'Stripe live secret or restricted key', '(?:sk|rk)_live_[A-Za-z0-9]{24,99}'),
  rule('google-api-key', 'Google API key', 'AIza[A-Za-z0-9_\\-]{35}'),
  rule('google-oauth-client-secret', 'Google OAuth client secret', 'GOCSPX-[A-Za-z0-9_\\-]{28}'),
  rule('openai-key', 'OpenAI API key', 'sk-(?:proj|svcacct|admin)-[A-Za-z0-9_\\-]{40,200}|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}'),
  rule('anthropic-key', 'Anthropic API key', 'sk-ant-(?:api03|admin01)-[A-Za-z0-9_\\-]{93}AA'),
  rule('npm-token', 'npm access token', 'npm_[A-Za-z0-9]{36}'),
  // PyPI documents pypi- plus at least 85 base64 characters; its macaroons start with the encoded "pypi.org".
  rule('pypi-token', 'PyPI API token', 'pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_\\-]{70,}'),
  rule('huggingface-token', 'Hugging Face access token', 'hf_[A-Za-z]{34}'),
  rule('digitalocean-token', 'DigitalOcean token', 'do[opr]_v1_[a-f0-9]{64}'),
  rule('shopify-token', 'Shopify access token or shared secret', 'shp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}'),
  rule('sendgrid-key', 'SendGrid API key', 'SG\\.[A-Za-z0-9_\\-]{22}\\.[A-Za-z0-9_\\-]{43}'),
  rule('twilio-api-key', 'Twilio API key', 'SK[0-9a-f]{32}'),
  rule('square-token', 'Square access token or OAuth secret', 'sq0atp-[A-Za-z0-9_\\-]{22}|sq0csp-[A-Za-z0-9_\\-]{43}'),
  rule('mapbox-secret-token', 'Mapbox secret token', 'sk\\.eyJ[A-Za-z0-9_\\-]{50,}\\.[A-Za-z0-9_\\-]{20,}'),
  rule('linear-api-key', 'Linear API key', 'lin_api_[A-Za-z0-9]{40}'),
  rule('postman-api-key', 'Postman API key', 'PMAK-[a-f0-9]{24}-[a-f0-9]{34}'),
  rule('discord-webhook', 'Discord webhook URL', 'https://(?:ptb\\.|canary\\.)?discord(?:app)?\\.com/api/webhooks/[0-9]{17,20}/[A-Za-z0-9_\\-]{60,70}'),
  rule('telegram-bot-token', 'Telegram bot token', '[0-9]{8,10}:AA[A-Za-z0-9_\\-]{33}'),
  rule('azure-storage-key', 'Azure storage account key', 'AccountKey=[A-Za-z0-9+/]{86}==', { bounded: false }),
  rule('age-secret-key', 'age secret key', 'AGE-SECRET-KEY-1[QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7L]{58}'),
  // A private key block counts only when key material follows the header (on the next line, or
  // after a literal \n inside a JSON string), so a mention of the header in prose never matches.
  rule('private-key', 'private key', '-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----', { bounded: false, next: /^(?:\\n)?[A-Za-z0-9+/]{40,}={0,2}/ }),
]);

const ALLOW_MARKER = /secret-scan:\s*allow\b\s*(.*)$/i;

// Obvious placeholders and documentation samples.
function isPlaceholder(value) {
  const text = String(value);
  if (/example|xxxx|placeholder|dummy|sample|redacted|your[_-]|changeme|<|>|\$\{|\{\{|\*\*\*/i.test(text)) return true;
  return /(.)\1{7,}/.test(text);
}

// The reason must hold at least three letters or digits, so comment closers (`*/`, `-->`) and
// punctuation alone never count as one.
function allowed(line) {
  const match = ALLOW_MARKER.exec(line);
  return Boolean(match && match[1].replace(/[^A-Za-z0-9]/g, '').length >= 3);
}

// Findings for numbered lines ([{ line, text }], as a diff's added lines): [{ rule, label, line, column }].
function scanLines(lines) {
  const findings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const { line, text } = lines[index];
    if (typeof text !== 'string' || text.length === 0 || allowed(text)) continue;
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        const value = match[0];
        if (pattern.next) {
          const rest = text.slice(match.index + value.length);
          const following = rest.trim().length ? rest.trim() : (lines[index + 1] && typeof lines[index + 1].text === 'string' ? lines[index + 1].text.trim() : '');
          if (!pattern.next.test(following)) continue;
        }
        if (isPlaceholder(value)) continue;
        findings.push({ rule: pattern.id, label: pattern.label, line, column: match.index + 1 });
      }
    }
  }
  return findings;
}

// Findings for a whole text (a file).
function scanText(text) {
  return scanLines(String(text).replace(/\r\n/g, '\n').split('\n').map((value, index) => ({ line: index + 1, text: value })));
}

module.exports = Object.freeze({ PATTERNS, ALLOW_MARKER, isPlaceholder, scanLines, scanText });
