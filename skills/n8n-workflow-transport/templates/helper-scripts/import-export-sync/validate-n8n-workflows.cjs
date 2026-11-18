const fs = require('node:fs');
const path = require('node:path');
const { riskyNodeLines, riskyNodes } = require('./n8n-risky-nodes.cjs');

const CANONICAL_WORKFLOW_DIR = 'n8n-workflows';
const DEFAULT_POLICY_FILE = 'n8n-workflow-policy.json';
// Well-known public API hosts (and n8n's own docs) that a workflow may call without a policy
// entry. They carry no owner data. Each also allows its subdomains, so list API hosts only, never
// a domain whose subdomains serve private webhook URLs. Repositories add their own hosts in
// n8n-workflow-policy.json allowedUrlHosts; private or unknown hosts still fail.
const PUBLIC_API_HOSTS = Object.freeze([
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'sheets.googleapis.com',
  'www.googleapis.com',
  'graph.microsoft.com',
  'api.github.com',
  'api.notion.com',
  'api.airtable.com',
  'api.hubapi.com',
  'api.stripe.com',
  'api.twilio.com',
  'api.sendgrid.com',
  'docs.n8n.io',
]);

function parseArgs(argv) {
  let workflowDirArg = null;
  let policyArg = null;
  let allowPreparedDir = false;
  let failOnRiskyNodes = false;
  let mode = 'repo-template';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--allow-prepared-dir') {
      allowPreparedDir = true;
      continue;
    }
    if (arg === '--fail-on-risky-nodes') {
      failOnRiskyNodes = true;
      continue;
    }
    if (arg === '--mode') {
      mode = argv[index + 1] || mode;
      index += 1;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length);
      continue;
    }
    if (arg === '--policy') {
      policyArg = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--policy=')) {
      policyArg = arg.slice('--policy='.length);
      continue;
    }
    if (!arg.startsWith('--') && !workflowDirArg) {
      workflowDirArg = arg;
    }
  }

  if (mode !== 'repo-template' && mode !== 'prepared-import') {
    throw new Error(`Unsupported validation mode: ${mode}. Use repo-template or prepared-import.`);
  }

  return { workflowDirArg, policyArg, allowPreparedDir: allowPreparedDir || mode === 'prepared-import', mode, failOnRiskyNodes };
}

function loadPolicy(root, policyArg) {
  const policyPath = policyArg
    ? path.resolve(policyArg)
    : path.join(root, DEFAULT_POLICY_FILE);

  const defaults = {
    allowedPlaceholders: [
      '^[A-Z0-9_]+_(ID|URL|EMAIL|NAME|TOKEN|TOKEN_PLACEHOLDER|PLACEHOLDER|KEY|HOST|DOMAIN|PATH|USER|USER_ID|PROJECT_ID|WEBHOOK)$',
      '^[A-Z0-9_]+_PLACEHOLDER$',
    ],
    allowedEmailDomains: ['example.com'],
    allowedUrlHosts: ['example.com', 'n8n.example.com', ...PUBLIC_API_HOSTS],
    allowedLiteralValues: [],
    warnOnGoogleIds: true,
    failOnWarnings: false,
  };

  if (!fs.existsSync(policyPath)) {
    if (policyArg) {
      throw new Error(`Policy file does not exist: ${policyPath}`);
    }
    return {
      ...defaults,
      policyPath: null,
    };
  }

  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8').replace(/^\uFEFF/, ''));
  return {
    ...defaults,
    ...policy,
    allowedPlaceholders: [
      ...defaults.allowedPlaceholders,
      ...(Array.isArray(policy.allowedPlaceholders) ? policy.allowedPlaceholders : []),
    ],
    // Owner entries add to the defaults, so allowing one host never drops example.com.
    allowedEmailDomains: [
      ...defaults.allowedEmailDomains,
      ...(Array.isArray(policy.allowedEmailDomains) ? policy.allowedEmailDomains : []),
    ],
    allowedUrlHosts: [
      ...defaults.allowedUrlHosts,
      ...(Array.isArray(policy.allowedUrlHosts) ? policy.allowedUrlHosts : []),
    ],
    allowedLiteralValues: Array.isArray(policy.allowedLiteralValues) ? policy.allowedLiteralValues : defaults.allowedLiteralValues,
    warnOnGoogleIds: policy.warnOnGoogleIds !== undefined ? Boolean(policy.warnOnGoogleIds) : defaults.warnOnGoogleIds,
    failOnWarnings: policy.failOnWarnings !== undefined ? Boolean(policy.failOnWarnings) : defaults.failOnWarnings,
    policyPath,
  };
}

function workflowFilesIn(dir, options = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => options.preparedImportMode ? file.endsWith('.live-import.json') : file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dir, file));
}

function resolveWorkflowDir(root, workflowDirArg, options = {}) {
  if (workflowDirArg) {
    const workflowDir = path.resolve(workflowDirArg);
    if (!options.allowPreparedDir && path.basename(workflowDir) !== CANONICAL_WORKFLOW_DIR) {
      throw new Error('Only n8n-workflows is supported. Validate n8n-workflows/ or a fixture directory named n8n-workflows.');
    }
    return {
      workflowDir,
      workflowDirName: path.relative(root, workflowDir) || path.basename(workflowDir),
      explicit: true,
    };
  }

  const canonicalDir = path.join(root, CANONICAL_WORKFLOW_DIR);
  return {
    workflowDir: canonicalDir,
    workflowDirName: CANONICAL_WORKFLOW_DIR,
    explicit: false,
  };
}

const secretPatterns = [
  { label: 'sk-prefixed API key', regex: /sk-[A-Za-z0-9_-]{20,}/g },
  { label: 'Google API key', regex: /AIza[0-9A-Za-z_-]{20,}/g },
  { label: 'Pinecone-looking API key', regex: /pcsk_[A-Za-z0-9_-]{20,}/gi },
  { label: 'Stripe-looking secret key', regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { label: 'Bearer token', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/gi },
  { label: 'JWT-looking token', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

// Letters, digits and marks of any script, so a look-alike or internationalised domain is checked too.
const emailRegex = /(?<![\p{L}\p{M}\p{N}._%+-])[\p{L}\p{M}\p{N}._%+-]+@[\p{L}\p{M}\p{N}.-]+\.[\p{L}\p{M}]{2,}(?![\p{L}\p{M}\p{N}])/giu;
const urlRegex = /https?:\/\/[^\s"'<>)]+/gi;
const googleIdRegex = /\b[0-9A-Za-z_-]{33,}\b/g;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function compilePlaceholderPatterns(policy) {
  return policy.allowedPlaceholders.map((pattern) => new RegExp(pattern));
}

function walk(value, visitor, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, trail.concat(index)));
    return;
  }

  if (value && typeof value === 'object') {
    visitor(value, trail);
    for (const [key, child] of Object.entries(value)) {
      walk(child, visitor, trail.concat(key));
    }
  }
}

// Text inside every {{ ... }} expression body that can hold a URL literal: quoted strings ('...',
// "..." or `...`), plus comments and regex literals read in one pass, so an apostrophe inside a
// regex literal or a comment does not hide a later string. The plain quote match is kept as well, so
// this never checks less than it did before.
function expressionLiterals(value) {
  const literals = [];
  for (const body of value.match(/\{\{[\s\S]*?\}\}/g) || []) {
    for (const literal of body.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || []) {
      literals.push(literal.slice(1, -1));
    }
    literals.push(...scriptTextParts(body.slice(2, -2)));
  }
  return literals;
}

// After one of these words a / starts a regex literal; after any other word or number it divides.
const regexAfterWords = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

// The strings, comments and regex literals of a JavaScript expression, in source order.
function scriptTextParts(source) {
  const parts = [];
  let regexAllowed = true;
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (char === "'" || char === '"' || char === '`') {
      let end = at + 1;
      while (end < source.length && source[end] !== char) end += source[end] === '\\' ? 2 : 1;
      if (end >= source.length) {
        at += 1;
        continue;
      }
      parts.push(source.slice(at + 1, end));
      at = end + 1;
      regexAllowed = false;
    } else if (source.startsWith('//', at) || source.startsWith('/*', at)) {
      const block = source[at + 1] === '*';
      const close = source.indexOf(block ? '*/' : '\n', at + 2);
      const end = close === -1 ? source.length : close;
      parts.push(source.slice(at + 2, end));
      at = end + (block ? 2 : 0);
    } else if (char === '/' && regexAllowed) {
      let end = at + 1;
      let inClass = false;
      while (end < source.length && source[end] !== '\n' && (inClass || source[end] !== '/')) {
        if (source[end] === '\\') end += 1;
        else if (source[end] === '[') inClass = true;
        else if (source[end] === ']') inClass = false;
        end += 1;
      }
      parts.push(source.slice(at + 1, end));
      at = end + 1;
      regexAllowed = false;
    } else if (/[\w$]/.test(char)) {
      let end = at;
      while (end < source.length && /[\w$]/.test(source[end])) end += 1;
      regexAllowed = regexAfterWords.has(source.slice(at, end));
      at = end;
    } else {
      if (!/\s/.test(char)) regexAllowed = !/[)\]}]/.test(char);
      at += 1;
    }
  }
  return parts;
}

// Distinct unsafe values and the places they appear, without the values themselves.
function findUnsafeStringPlaces(workflow, regex, isAllowed, options = {}) {
  const values = new Set();
  const places = [];
  const visit = (value, trail) => {
    if (typeof value === 'string') {
      // For URLs, collapse each {{ ... }} expression to one token first, so a space inside an
      // expression does not end the match before a real host (https://{{ $env.U }}@host/...).
      // Emails are matched as written, so one quoted inside an expression is still found.
      // A URL written as a quoted literal inside an expression ({{ 'https://host/x' }}) is checked on
      // its own as well, because collapsing would hide it. Each template literal ${ ... } is collapsed
      // the same way, in both, so a space, call or quote inside it does not end the match early; what
      // was inside it is checked on its own too. A part is also read as each text it can give, from
      // its quoted and template literals (${'host'}, {{ $env.HOST || 'host' }}, {{ 'https://' + $json.t
      // + '.host' }}), in place of the part. Each match is checked with the text just after it, which
      // an email needs.
      const matchesIn = (text) => [...text.matchAll(regex)].map((found) => ({ match: found[0], after: text.slice(found.index + found[0].length, found.index + found[0].length + 256) }));
      const candidates = options.collapseExpressions
        ? [...scanForms(value, expressionParts(value), '{{expr}}'), ...expressionLiterals(value)].flatMap(templateTexts).flatMap(matchesIn)
        : matchesIn(value);
      const unsafe = candidates.filter(({ match, after }) => !isAllowed(match, after)).map(({ match }) => match);
      if (unsafe.length > 0) {
        // A literal read in place of its part can repeat a URL already found, with only run-time tokens
        // after it; that is the same URL, so it is counted once.
        unsafe
          .filter((match) => { const bare = match.replace(/(?:\{\{expr\}\}|\$\{expr\})+$/, ''); return bare === match || !unsafe.includes(bare); })
          .forEach((match) => values.add(match));
        places.push(trail.join('.') || '(root)');
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, trail.concat(index)));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, trail.concat(key));
  };
  visit(workflow, []);
  const shown = places.slice(0, 5).join(', ') + (places.length > 5 ? ` and ${places.length - 5} more` : '');
  return { count: values.size, places: shown };
}

// The text with each balanced ${ ... } as one token, and with each text one can give in its place,
// then the texts inside each one, the same way. One left open stays as written.
function templateTexts(text) {
  const parts = templateParts(text);
  return [...scanForms(text, parts, '${expr}'), ...parts.flatMap((part) => templateTexts(part.body))];
}

// Each balanced ${ ... } in the text, in order. Reading stops at one left open.
function templateParts(text) {
  const parts = [];
  let at = 0;
  while (at < text.length) {
    const start = text.indexOf('${', at);
    if (start === -1) break;
    let depth = 1;
    let end = start + 2;
    while (end < text.length && depth > 0) {
      if (text[end] === '{') depth += 1;
      else if (text[end] === '}') depth -= 1;
      end += 1;
    }
    if (depth > 0) break;
    parts.push({ start, end, body: text.slice(start + 2, end - 1) });
    at = end;
  }
  return parts;
}

// Each {{ ... }} expression in the text, in order.
function expressionParts(text) {
  return [...text.matchAll(/\{\{[\s\S]*?\}\}/g)].map((found) => ({ start: found.index, end: found.index + found[0].length, body: found[0].slice(2, -2) }));
}

// How far around a part the URL scan reads a text the part can give. A host sits well inside this.
const formWindow = 1024;
// Characters that end a URL match, so a match never crosses them.
const urlStop = /[\s"'<>)]/;

// The text with every part as one token, then, for each text a part can give, only the stretch of
// that text a URL match through the part can reach, with the part replaced by it. Reading only that
// stretch keeps a large value with many parts as cheap as reading it once.
function scanForms(text, parts, token) {
  let base = '';
  let at = 0;
  const places = parts.map((part) => {
    base += text.slice(at, part.start);
    const place = base.length;
    base += token;
    at = part.end;
    return place;
  });
  base += text.slice(at);
  const forms = [base];
  parts.forEach((part, index) => {
    const values = partValues(part.body, token);
    if (values.length === 0) return;
    const tokenStart = places[index];
    const tokenEnd = tokenStart + token.length;
    let from = tokenStart;
    while (from > 0 && tokenStart - from < formWindow && !urlStop.test(base[from - 1])) from -= 1;
    let to = tokenEnd;
    while (to < base.length && to - tokenEnd < formWindow && !urlStop.test(base[to])) to += 1;
    for (const value of values) forms.push(base.slice(from, tokenStart) + value + base.slice(tokenEnd, to));
  });
  return forms;
}

// The whole text once with every part as one token and once for each text a part can give.
function wholeForms(text, parts, token) {
  const join = (write) => {
    let out = '';
    let at = 0;
    parts.forEach((part, index) => {
      out += text.slice(at, part.start) + write(index);
      at = part.end;
    });
    return out + text.slice(at);
  };
  const forms = [join(() => token)];
  parts.forEach((part, index) => {
    for (const value of partValues(part.body, token)) forms.push(join((which) => (which === index ? value : token)));
  });
  return forms;
}

// The texts a part can give that hold something beyond run time: a text that is only the token adds
// nothing, and one with no letter or digit left once the tokens are dropped (${host || ''}) is no host.
function partValues(body, token) {
  return expressionTexts(body, token).filter((value) => value !== token && /[\p{L}\p{N}]/u.test(value.split('{{expr}}').join('').split('${expr}').join('')));
}

// The texts a JavaScript expression can give, with each run-time piece as the token; the first is the
// one to use when it is joined to others. The expression is read as its alternatives (split at
// || ?? && ? : , ;) and each alternative as a + chain. A quoted literal gives its text, a template
// literal gives its text with its own ${ ... } parts read the same way, and a grouping parenthesis is
// read inside. Names, member access, calls, index keys, object and array literals and regex literals
// are run time; an alternative with any other operator (a comparison, -, !) is one run-time piece.
function expressionTexts(source, token, depth = 0) {
  if (depth > 8) return [token];
  const alternatives = [];
  let terms = [];
  let term = null;
  let broken = false;
  const endTerm = () => {
    if (term) terms.push(term.runTime ? [token] : term.texts);
    term = null;
  };
  const endAlternative = () => {
    endTerm();
    alternatives.push(broken || terms.length === 0 ? [token] : chainTexts(terms, token));
    terms = [];
    broken = false;
  };
  const runTime = () => {
    term = { runTime: true };
  };
  let operandNext = false;
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    const next = source[at + 1];
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    if (char === '/' && (next === '/' || next === '*')) {
      const close = source.indexOf(next === '*' ? '*/' : '\n', at + 2);
      at = close === -1 ? source.length : close + (next === '*' ? 2 : 1);
      continue;
    }
    // An operand is due at the start of a piece, or after an operator that binds tighter than +.
    const expectOperand = !term || operandNext;
    operandNext = false;
    if (char === "'" || char === '"') {
      const close = closingQuote(source, at);
      if (close === -1) {
        broken = true;
        break;
      }
      if (term) runTime();
      else term = { texts: [source.slice(at + 1, close).replace(/\\([\s\S])/g, '$1')] };
      at = close + 1;
    } else if (char === '`') {
      const close = closingBacktick(source, at);
      if (close === -1) {
        broken = true;
        break;
      }
      if (term) runTime();
      else term = { texts: templateLiteralTexts(source.slice(at + 1, close), depth + 1) };
      at = close + 1;
    } else if (char === '(') {
      const close = closingBracket(source, at);
      if (term) runTime();
      else term = { texts: expressionTexts(source.slice(at + 1, close - 1), token, depth + 1) };
      at = close;
    } else if (char === '[' || char === '{') {
      at = closingBracket(source, at);
      runTime();
    } else if (char === '?' && next === '.' && !/\d/.test(source[at + 2] || '')) {
      runTime();
      at += 2;
    } else if ((char === '|' && next === '|') || (char === '?' && next === '?') || (char === '&' && next === '&')) {
      endAlternative();
      at += 2;
    } else if (char === '?' || char === ':' || char === ',' || char === ';') {
      endAlternative();
      at += 1;
    } else if (char === '+' && next !== '+' && next !== '=') {
      endTerm();
      at += 1;
    } else if (char === '/' && !term) {
      let end = at + 1;
      let inClass = false;
      while (end < source.length && source[end] !== '\n' && (inClass || source[end] !== '/')) {
        if (source[end] === '\\') end += 1;
        else if (source[end] === '[') inClass = true;
        else if (source[end] === ']') inClass = false;
        end += 1;
      }
      at = end + 1;
      runTime();
    } else if (/[\p{L}\p{N}_$.\\]/u.test(char)) {
      runTime();
      at += 1;
    } else if (/[*/%]/.test(char) && term && next !== '=') {
      // *, / and % (and **) bind tighter than +, so they make only this piece a run-time number.
      runTime();
      operandNext = true;
      at += char === '*' && next === '*' ? 2 : 1;
    } else if (/[!~+-]/.test(char) && expectOperand && next !== '=' && !(/[+-]/.test(char) && next === char)) {
      // A unary !, ~, + or - starts a run-time piece: a boolean or a number.
      runTime();
      operandNext = true;
      at += 1;
    } else {
      broken = true;
      at += 1;
    }
  }
  endAlternative();
  const texts = [...new Set(alternatives.flat())];
  return alternatives.length === 1 ? texts : [token, ...texts.filter((text) => text !== token)];
}

// The texts of a + chain: every piece as its first text, then each other text of one piece in turn.
function chainTexts(terms, token) {
  const firsts = terms.map((texts) => texts[0]);
  const texts = [firsts.join('')];
  terms.forEach((options, index) => {
    for (const option of options.slice(1)) texts.push(firsts.map((first, at) => (at === index ? option : first)).join(''));
  });
  return texts;
}

// The texts of a template literal's content: every ${ ... } as one token first, then each text one
// part can give in turn. Its run-time pieces are written as ${expr}, the way the template is read
// on its own, so the same URL is not found twice under two tokens.
function templateLiteralTexts(content, depth) {
  const token = '${expr}';
  const parts = [];
  let at = 0;
  while (at < content.length) {
    if (content[at] === '\\') at += 2;
    else if (content.startsWith('${', at)) {
      const close = closingBracket(content, at + 1);
      parts.push({ start: at, end: close, body: content.slice(at + 2, close - 1) });
      at = close;
    } else at += 1;
  }
  const join = (write) => {
    let out = '';
    let from = 0;
    parts.forEach((part, index) => {
      out += content.slice(from, part.start).replace(/\\([\s\S])/g, '$1') + write(index);
      from = part.end;
    });
    return out + content.slice(from).replace(/\\([\s\S])/g, '$1');
  };
  const texts = [join(() => token)];
  parts.forEach((part, index) => {
    for (const text of expressionTexts(part.body, token, depth)) {
      if (text !== token) texts.push(join((which) => (which === index ? text : token)));
    }
  });
  return [...new Set(texts)];
}

// The index of the quote that closes the string opened at the given index, or -1.
function closingQuote(source, open) {
  let at = open + 1;
  while (at < source.length && source[at] !== source[open]) at += source[at] === '\\' ? 2 : 1;
  return at < source.length ? at : -1;
}

// The index of the backtick that closes the template literal opened at the given index, or -1.
function closingBacktick(source, open) {
  let at = open + 1;
  while (at < source.length) {
    if (source[at] === '\\') at += 2;
    else if (source[at] === '`') return at;
    else if (source.startsWith('${', at)) at = closingBracket(source, at + 1);
    else at += 1;
  }
  return -1;
}

// The index just after the bracket that closes the one at the given index (strings, template literals
// and comments skipped), or the end of the source when it is left open.
function closingBracket(source, open) {
  let depth = 0;
  let at = open;
  while (at < source.length) {
    const char = source[at];
    if (char === "'" || char === '"') {
      const close = closingQuote(source, at);
      if (close === -1) return source.length;
      at = close + 1;
    } else if (char === '`') {
      const close = closingBacktick(source, at);
      if (close === -1) return source.length;
      at = close + 1;
    } else if (char === '/' && (source[at + 1] === '/' || source[at + 1] === '*')) {
      const close = source.indexOf(source[at + 1] === '*' ? '*/' : '\n', at + 2);
      at = close === -1 ? source.length : close + 1;
    } else {
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') {
        depth -= 1;
        if (depth === 0) return at + 1;
      }
      at += 1;
    }
  }
  return source.length;
}

function trailString(trail) {
  return trail.join('.');
}

// A host with every run-time part dropped: each {{ ... }} and each ${ ... } (braces inside counted).
// One left open, because the URL pattern cut it short, runs to the end of the host.
function literalHostPart(host) {
  let literal = '';
  let at = 0;
  while (at < host.length) {
    if (host.startsWith('{{', at)) {
      const end = host.indexOf('}}', at + 2);
      at = end === -1 ? host.length : end + 2;
    } else if (host.startsWith('${', at)) {
      let depth = 1;
      at += 2;
      while (at < host.length && depth > 0) {
        if (host[at] === '{') depth += 1;
        else if (host[at] === '}') depth -= 1;
        at += 1;
      }
    } else {
      literal += host[at];
      at += 1;
    }
  }
  return literal;
}

function hostMatches(host, allowedHost) {
  const lowerHost = host.toLowerCase();
  const lowerAllowed = allowedHost.toLowerCase();
  return lowerHost === lowerAllowed || lowerHost.endsWith(`.${lowerAllowed}`);
}

function createPolicyHelpers(policy) {
  const placeholderPatterns = compilePlaceholderPatterns(policy);
  // An allowed literal is also kept as the URL scan sees it: each ${ ... } as one token, or as a text
  // it can give.
  const allowedLiteralValues = new Set(policy.allowedLiteralValues.flatMap((value) => [String(value), ...wholeForms(String(value), templateParts(String(value)), '${expr}')]));

  const isAllowedPlaceholder = (value) =>
    typeof value === 'string' && placeholderPatterns.some((pattern) => pattern.test(value));

  const isAllowedLiteral = (value) =>
    typeof value === 'string' && allowedLiteralValues.has(value);

  const allowedEmail = (email, after = '') => {
    if (isAllowedPlaceholder(email) || isAllowedLiteral(email)) return true;
    // Compare normalised forms, so a look-alike letter from another script never equals an allowed domain.
    const normalise = (domain) => String(domain).normalize('NFKC').toLowerCase();
    const domain = normalise(email.split('@').pop());
    // An address followed straight by letters of another script (user@example.com then Japanese
    // text) ends where the script changes, so the domain cut there is compared too. Not when the
    // cut-off text, and the text after the match, run on through local-part characters into an @
    // (or a fullwidth one): then the cut-off text is the start of another address.
    const scriptCut = domain.match(/^(.*\.\p{sc=Latin}{2,})(?=(?!\p{sc=Latin})\p{L})/u);
    const joined = scriptCut && /^[\p{L}\p{M}\p{N}._%+-]*[@＠]/u.test(domain.slice(scriptCut[1].length) + normalise(after));
    const domains = scriptCut && !joined ? [domain, scriptCut[1]] : [domain];
    return policy.allowedEmailDomains.some((allowedDomain) => domains.includes(normalise(allowedDomain)));
  };

  const allowedUrl = (url) => {
    if (isAllowedPlaceholder(url) || isAllowedLiteral(url)) return true;
    // Read the host the way a URL parser does: cut at / ? or #, drop user info and a port (literal
    // or expression) and trailing prose punctuation. Only a host built wholly at run time holds no
    // real host and is skipped; anything else is checked, parseable or not.
    const authority = url.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
    // An allowed host clears only the host. Literal user info, or a literal value for a
    // credential-named query parameter, is a finding on any host: it is how keys get pasted.
    const at = authority.lastIndexOf('@');
    if (at > 0 && !/^\{\{expr\}\}$/.test(authority.slice(0, at))) return false;
    const query = url.split('?')[1] || '';
    if (/(?:^|[&;])(?:key|api_?key|apikey|hapikey|access_token|token|secret|password|client_secret|sig|signature)=(?!\{\{)[^&#]+/i.test(query)) return false;
    const host = authority.slice(at + 1)
      .replace(/:[^:\]]*$/, '')
      .replace(/[\]`.,;]+$/, '')
      .toLowerCase();
    // A host built partly at run time ({{ ... }} or a template literal's ${...}) is checked on what is
    // left once every run-time part is dropped, so a private domain before or after a run-time part
    // (https://${tenant}.private-host/, https://private-host{{ $json.path }}) is still found. A host
    // with no letter or digit left is wholly run time and holds no real host.
    if (host.includes('{{') || host.includes('${')) {
      const literal = literalHostPart(host).replace(/^[.-]+|[.-]+$/g, '');
      if (!/[\p{L}\p{N}]/u.test(literal)) return true;
      return policy.allowedUrlHosts.some((allowedHost) => hostMatches(literal, allowedHost));
    }
    return policy.allowedUrlHosts.some((allowedHost) => hostMatches(host, allowedHost));
  };

  return {
    isAllowedPlaceholder,
    isAllowedLiteral,
    allowedEmail,
    allowedUrl,
  };
}

function hasConnection(workflow, sourceName, outputIndex, targetName) {
  const output = workflow.connections?.[sourceName]?.main?.[outputIndex];
  return Array.isArray(output) && output.some((connection) => connection.node === targetName);
}

function findWorkflowNode(workflow, nodeName) {
  return (workflow.nodes || []).find((node) => node.name === nodeName);
}

// Generic validator extension point:
// keep this file project-agnostic. If a target repo needs custom workflow
// validators, add one of these rule files in that repo instead of hardcoding
// workflow names, node names, or sheet-specific checks here. The rule file may
// export a function directly or export validateWorkflow(context).
const DEFAULT_VALIDATION_RULE_FILES = [
  'scripts/n8n-workflow-validation-rules.cjs',
  'scripts/n8n-workflow-validation-rules.js',
  '.n8n-local/n8n-workflow-validation-rules.cjs',
  '.n8n-local/n8n-workflow-validation-rules.js',
  '.n8n-workflow-validation-rules.cjs',
  '.n8n-workflow-validation-rules.js',
];

function validationRulePathCandidates(root) {
  const configured = String(process.env.N8N_WORKFLOW_VALIDATION_RULES || '')
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (path.isAbsolute(value) ? value : path.join(root, value)));

  const defaultsEnabled = /^(?:1|true|yes|on)$/i.test(String(process.env.N8N_WORKFLOW_VALIDATION_RULES_AUTOLOAD || ''))
    ? DEFAULT_VALIDATION_RULE_FILES.map((file) => path.join(root, file))
    : [];
  const candidates = [];
  const seen = new Map();
  function addCandidate(filePath, required) {
    const resolved = path.resolve(filePath);
    const existing = seen.get(resolved);
    if (existing) {
      existing.required = existing.required || required;
      return;
    }

    const candidate = { filePath: resolved, required };
    seen.set(resolved, candidate);
    candidates.push(candidate);
  }

  for (const filePath of configured) addCandidate(filePath, true);
  for (const filePath of defaultsEnabled) addCandidate(filePath, false);
  return candidates;
}

function ruleFunctionFromModule(moduleExports, rulePath) {
  if (typeof moduleExports === 'function') {
    return moduleExports;
  }

  if (moduleExports && typeof moduleExports.validateWorkflow === 'function') {
    return moduleExports.validateWorkflow;
  }

  throw new Error(`${path.relative(process.cwd(), rulePath) || rulePath} must export a function or validateWorkflow(context).`);
}

function loadProjectValidationRules(root) {
  const rules = [];

  for (const { filePath: rulePath, required } of validationRulePathCandidates(root)) {
    if (!fs.existsSync(rulePath)) {
      if (required) {
        fail(`Configured n8n workflow validation rule not found: ${path.relative(root, rulePath) || rulePath}.`);
      }
      continue;
    }

    try {
      const moduleExports = require(rulePath);
      rules.push({
        filePath: rulePath,
        validateWorkflow: ruleFunctionFromModule(moduleExports, rulePath),
      });
    } catch (error) {
      fail(`Could not load n8n workflow validation rule ${path.relative(root, rulePath) || rulePath}: ${error.message}`);
    }
  }

  return rules;
}

function runProjectValidationRules(rules, context) {
  const utils = {
    walk,
    trailString,
    hasConnection,
    findWorkflowNode,
  };

  for (const rule of rules) {
    try {
      rule.validateWorkflow({
        ...context,
        fail,
        warn,
        utils,
      });
    } catch (error) {
      const ruleName = path.relative(context.root, rule.filePath) || rule.filePath;
      fail(`${context.relative} failed n8n workflow validation rule ${ruleName}: ${error.message}`);
    }
  }
}

const root = process.cwd();
const messages = [];
let errors = 0;
let warnings = 0;

function fail(message) {
  errors += 1;
  console.error(`FAIL: ${message}`);
}

function warn(message) {
  warnings += 1;
  console.warn(`WARN: ${message}`);
}

let parsedArgs;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message);
  parsedArgs = { workflowDirArg: null, policyArg: null, allowPreparedDir: false, mode: 'repo-template', failOnRiskyNodes: false };
}

let policy;
try {
  policy = loadPolicy(root, parsedArgs.policyArg);
} catch (error) {
  fail(error.message);
  policy = loadPolicy(root, null);
}

const helpers = createPolicyHelpers(policy);
const projectValidationRules = loadProjectValidationRules(root);
let resolvedWorkflowDir;
try {
  resolvedWorkflowDir = resolveWorkflowDir(root, parsedArgs.workflowDirArg, {
    allowPreparedDir: parsedArgs.allowPreparedDir,
  });
} catch (error) {
  fail(error.message);
  resolvedWorkflowDir = {
    workflowDir: path.join(root, CANONICAL_WORKFLOW_DIR),
    workflowDirName: CANONICAL_WORKFLOW_DIR,
  };
}
const { workflowDir, workflowDirName } = resolvedWorkflowDir;
const preparedImportMode = parsedArgs.mode === 'prepared-import';

if (policy.policyPath) {
  messages.push(`Using policy ${path.relative(root, policy.policyPath) || policy.policyPath}.`);
}

for (const rule of projectValidationRules) {
  messages.push(`Using validation rule ${path.relative(root, rule.filePath) || rule.filePath}.`);
}

if (!fs.existsSync(workflowDir)) {
  fail(`Workflow directory not found: n8n-workflows. Create n8n-workflows/ or run AllLive export to bootstrap from live n8n.`);
}

if (preparedImportMode) {
  messages.push('Using prepared-import validation mode.');
}

const files = workflowFilesIn(workflowDir, { preparedImportMode });

if (fs.existsSync(workflowDir) && files.length === 0) {
  fail(preparedImportMode
    ? `No prepared live import workflow JSON files found in ${workflowDirName}/. Expected *.live-import.json.`
    : `No workflow JSON files found in ${workflowDirName}/.`);
}

for (const filePath of files) {
  const relative = path.relative(root, filePath);
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  let workflow;

  try {
    workflow = JSON.parse(text);
  } catch (error) {
    fail(`${relative} is not valid JSON: ${error.message}`);
    continue;
  }

  const required = [
    ['name', typeof workflow.name === 'string' && workflow.name.trim()],
    ['nodes array', Array.isArray(workflow.nodes)],
    ['connections object', workflow.connections && typeof workflow.connections === 'object' && !Array.isArray(workflow.connections)],
    ['settings object', workflow.settings && typeof workflow.settings === 'object' && !Array.isArray(workflow.settings)],
  ];

  for (const [label, ok] of required) {
    if (!ok) {
      fail(`${relative} is missing required ${label}.`);
    }
  }

  if (workflow.active !== false) {
    fail(`${relative} must have active: false. Workflow templates must be unpublished (inactive).`);
  }

  if (workflow.activeVersionId !== undefined && workflow.activeVersionId !== null) {
    fail(`${relative} carries a published version (activeVersionId). Workflow files must be unpublished.`);
  }

  const settings = workflow.settings && typeof workflow.settings === 'object' && !Array.isArray(workflow.settings) ? workflow.settings : {};
  for (const key of ['errorWorkflow', 'availableInMCP']) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    const reason = key === 'errorWorkflow'
      ? 'holds a workflow id from one n8n instance'
      : 'is the live instance\'s MCP exposure decision';
    if (preparedImportMode) {
      // This validator never sees the target; preparation checked the value against it.
      messages.push(`${relative} carries settings.${key}; preparation checked it against the target.`);
    } else {
      warn(`${relative} sets settings.${key}, which ${reason}. Re-export to drop it from Git.`);
    }
  }

  const nodeNames = new Set((workflow.nodes || []).map((node) => node.name));
  for (const [sourceName, outputs] of Object.entries(workflow.connections || {})) {
    if (!nodeNames.has(sourceName)) {
      fail(`${relative} has connection source "${sourceName}" that does not match any node name.`);
    }

    for (const outputGroups of Object.values(outputs || {})) {
      for (const branch of outputGroups || []) {
        for (const connection of branch || []) {
          if (!nodeNames.has(connection.node)) {
            fail(`${relative} has connection target "${connection.node}" that does not match any node name.`);
          }
        }
      }
    }
  }

  walk(workflow, (node, trail) => {
    if (node.credentials && typeof node.credentials === 'object') {
      for (const [credentialName, credentialValue] of Object.entries(node.credentials)) {
        const credentialTrail = trail.concat(['credentials', credentialName]);
        if (!credentialValue || typeof credentialValue !== 'object' || Array.isArray(credentialValue)) {
          fail(`${relative} contains an invalid credential reference at ${trailString(credentialTrail)}.`);
          continue;
        }
        const keys = Object.keys(credentialValue);
        if (typeof credentialValue.name !== 'string' || !credentialValue.name.trim()) {
          fail(`${relative} contains a credential reference without a logical name at ${trailString(credentialTrail)}.`);
        }
        if (!preparedImportMode) {
          if ('id' in credentialValue) {
            fail(`${relative} contains credentials.id at ${trailString(credentialTrail.concat(['id']))}.`);
          }
          if (keys.some((key) => key !== 'name')) {
            fail(`${relative} contains unsupported canonical credential metadata at ${trailString(credentialTrail)}.`);
          }
        } else {
          if (
            !Object.prototype.hasOwnProperty.call(credentialValue, 'id') ||
            (credentialValue.id !== null && (typeof credentialValue.id !== 'string' || !credentialValue.id))
          ) {
            fail(`${relative} prepared credential reference requires an exact resolved string ID or unresolved null at ${trailString(credentialTrail.concat(['id']))}.`);
          }
          if (keys.some((key) => !['id', 'name'].includes(key))) {
            fail(`${relative} contains unsupported prepared credential metadata at ${trailString(credentialTrail)}.`);
          }
        }
      }
    }

    if (node.meta && typeof node.meta === 'object' && 'instanceId' in node.meta) {
      fail(`${relative} contains private meta.instanceId at ${trailString(trail.concat(['meta', 'instanceId']))}.`);
    }

    if (
      !preparedImportMode &&
      'webhookId' in node &&
      node.webhookId &&
      !helpers.isAllowedPlaceholder(node.webhookId) &&
      !helpers.isAllowedLiteral(node.webhookId)
    ) {
      fail(`${relative} contains real-looking webhookId at ${trailString(trail.concat(['webhookId']))}.`);
    }
  });

  for (const pattern of secretPatterns) {
    const matches = text.match(pattern.regex) || [];
    if (matches.length > 0) {
      fail(`${relative} contains possible secret: ${pattern.label}.`);
    }
  }

  // A real email or production URL in a committed template is personal or environment data, so it
  // fails by default; a prepared import holds locally bound values, so there it stays a warning.
  // Either way the log names the place, never the value, so the finding does not leak it again.
  const personalDataFinding = preparedImportMode ? warn : fail;
  const unsafeEmailPlaces = findUnsafeStringPlaces(workflow, emailRegex, helpers.allowedEmail);
  if (unsafeEmailPlaces.count > 0) {
    personalDataFinding(`${relative} contains ${unsafeEmailPlaces.count} non-placeholder email(s) at ${unsafeEmailPlaces.places}. Replace with a placeholder, or allow the domain in ${DEFAULT_POLICY_FILE} allowedEmailDomains.`);
  }

  const unsafeUrlPlaces = findUnsafeStringPlaces(workflow, urlRegex, helpers.allowedUrl, { collapseExpressions: true });
  if (unsafeUrlPlaces.count > 0) {
    personalDataFinding(`${relative} contains ${unsafeUrlPlaces.count} production-looking URL(s) at ${unsafeUrlPlaces.places}. Replace with a placeholder, or allow the host in ${DEFAULT_POLICY_FILE} allowedUrlHosts.`);
  }

  if (policy.warnOnGoogleIds) {
    walk(workflow, (node, trail) => {
      for (const [key, value] of Object.entries(node)) {
        if (
          typeof value !== 'string' ||
          helpers.isAllowedPlaceholder(value) ||
          helpers.isAllowedLiteral(value) ||
          uuidRegex.test(value)
        ) {
          continue;
        }

        const matches = value.match(googleIdRegex) || [];
        if (matches.length === 0) {
          continue;
        }

        const keyPath = trailString(trail.concat(key));
        const looksLikeGoogleIdField = /(?:documentId|folderToWatch|folderId|fileId|spreadsheetId|driveId|sheetId|value)$/i.test(key);
        if (looksLikeGoogleIdField) {
          warn(`${relative} contains possible Google Drive/Sheets ID at ${keyPath}. Review before committing.`);
        }
      }
    });
  }

  runProjectValidationRules(projectValidationRules, {
    workflow,
    relative,
    text,
    root,
    workflowDir,
    workflowDirName,
    policy,
    helpers,
  });

  const risky = riskyNodes(workflow);
  for (const line of riskyNodeLines(relative, risky)) console.log(line);
  if (risky.length > 0 && parsedArgs.failOnRiskyNodes) {
    fail(`${relative} has ${risky.length} node(s) to inspect and --fail-on-risky-nodes is set.`);
  }

  console.log(`Checked ${relative}: ${workflow.nodes?.length ?? 0} node(s).`);
}

for (const message of messages) {
  console.log(message);
}

if (policy.failOnWarnings && warnings > 0) {
  errors += 1;
  console.error('FAIL: Policy failOnWarnings is true and warnings were found.');
}

const result = errors > 0 ? 'FAIL' : 'PASS';
const summary = `Summary: workflows checked ${files.length}, errors ${errors}, warnings ${warnings}, result ${result}.`;

if (errors > 0) {
  console.error(`\n${summary}`);
  process.exit(1);
}

console.log(`\n${summary}`);
