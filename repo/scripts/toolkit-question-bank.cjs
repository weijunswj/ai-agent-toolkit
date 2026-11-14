'use strict';

// The question bank format shared by `setup toolkit` and `toolkit governance`: one table per section
// with the columns #, Question, Current, Recommended and Other choices; lettered choices with Keep
// current first (the choice that changes nothing folds into it); a bank reference bound to exactly
// what is shown; and one reading of the reply (`all recommended`, or only the changes such as
// `1.2=B`). Callers build their own rows and decide what an answer does; nothing here writes.

const crypto = require('node:crypto');

const BANK_REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BANK_REFERENCE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

function wizardChoice(value, label, consequence) {
  return { value, label, consequence };
}

// currentChoice names the choice that would change nothing in the verified current state. It does the
// same as keep, so the bank shows the two as one Keep current, whatever is recommended, and the other
// choices are only the ones that change something. Usually keep stays and its twin is hidden. With keepAs
// (the twin also re-checks or follows another answer, which keep would skip), the twin stays under the
// Keep current label with keepAs as its effect, and keep is hidden. Either way the hidden choice's
// canonical name (a flag or a typed word) still works and applies as the shown one.
function foldedTwin(definition) {
  const twin = definition.currentChoice;
  const has = (value) => definition.choices?.some((choice) => choice.value === value);
  return twin && twin !== 'keep' && has(twin) && has('keep') ? twin : '';
}

function foldDefinition(definition, twin) {
  const keep = definition.choices.find((choice) => choice.value === 'keep');
  const [hidden, shown] = definition.keepAs ? ['keep', twin] : [twin, 'keep'];
  const choices = definition.choices.filter((choice) => choice.value !== hidden)
    .map((choice) => (definition.keepAs && choice.value === twin ? { ...choice, label: keep.label, consequence: definition.keepAs } : choice));
  const recommendation = definition.recommendation.value !== hidden && !definition.keepAs ? definition.recommendation
    : { ...definition.recommendation, value: shown, outcome: choices.find((choice) => choice.value === shown).consequence };
  return {
    definition: { ...definition, choices, recommendation, selected: definition.selected === hidden ? shown : definition.selected },
    fold: { folded_value: hidden, folded_into: shown },
  };
}

function resolvedQuestion(definition) {
  const twin = foldedTwin(definition);
  let fold = null;
  if (twin) ({ definition, fold } = foldDefinition(definition, twin));
  const recommendation = definition.recommendation;
  if (!definition.id || !definition.key || !definition.title) throw new Error('Setup question metadata is incomplete.');
  if (!definition.whatThisControls || !definition.current || !recommendation?.value
      || !recommendation.outcome || !recommendation.reason) {
    throw new Error(`Setup question ${definition.id} is missing required semantic metadata.`);
  }
  if (!Array.isArray(definition.choices) || !definition.choices.length
      || definition.choices.some((choice) => !choice.value || !choice.label || !choice.consequence)) {
    throw new Error(`Setup question ${definition.id} has a choice without a consequence.`);
  }
  if (!definition.choices.some((choice) => choice.value === recommendation.value)) {
    throw new Error(`Setup question ${definition.id} recommends an unavailable choice.`);
  }
  // Order after folding so Keep current is always A, including keepAs rows.
  const keepValue = fold?.folded_value === 'keep' ? fold.folded_into : 'keep';
  const choices = [
    ...definition.choices.filter((choice) => choice.value === keepValue),
    ...definition.choices.filter((choice) => choice.value !== keepValue),
  ];
  return {
    id: definition.id,
    key: definition.key,
    section: definition.section,
    title: definition.title,
    prompt: definition.prompt,
    whatThisControls: definition.whatThisControls,
    currentState: {
      effectiveBehavior: definition.current,
      verification: definition.currentVerification || 'verified',
      ...(definition.recordDigest ? { record_digest: definition.recordDigest } : {}),
    },
    recommendation: { ...recommendation },
    choices: choices.map((choice) => ({ ...choice })),
    afterApplying: definition.afterApplying || '',
    availability: definition.availability || { status: 'available', condition: 'Available for the detected setup state.' },
    privacySafeFallback: definition.privacySafeFallback || 'The effective state could not be verified safely; setup will not guess or expose private configuration.',
    selected: definition.selected,
    ...(fold || {}),
    // Compatibility aliases for existing consumers. Every alias is derived from
    // the structured semantic fields above rather than maintained separately.
    description: definition.whatThisControls,
    current: definition.current,
    current_short: definition.currentShort || definition.current,
    recommended: recommendation.value,
    recommended_outcome: recommendation.outcome,
    recommendation_reason: recommendation.reason,
  };
}

function choiceValues(spec) {
  return spec.choices.map((choice) => choice.value);
}

function choiceLabel(spec, value) {
  return spec.choices.find((choice) => choice.value === value)?.label || value || '(answer required)';
}

function selectedChoice(spec, value) {
  return spec.choices.find((choice) => choice.value === value) || null;
}

function spreadsheetChoiceReference(index) {
  if (!Number.isSafeInteger(index) || index < 1 || index > 702) {
    throw new Error('Setup question choices exceed the supported A-ZZ presentation range.');
  }
  let value = index;
  let reference = '';
  while (value > 0) {
    value -= 1;
    reference = String.fromCharCode(65 + (value % 26)) + reference;
    value = Math.floor(value / 26);
  }
  return reference;
}

function questionBankApprovalPayload(specs) {
  const sectionMap = new Map();
  for (const spec of specs) {
    const sectionKey = `${spec.presentation.section_index}:${spec.presentation.section_id}`;
    if (!sectionMap.has(sectionKey)) {
      sectionMap.set(sectionKey, {
        section_id: spec.presentation.section_id,
        section_index: spec.presentation.section_index,
        title: spec.section,
        question_count: spec.presentation.question_count
          || answerable(specs).filter((candidate) => candidate.section === spec.section).length,
      });
    }
  }
  return {
    schema: 'ai-agent-toolkit.setup-question-bank-approval.v2',
    host: specs[0]?.presentation?.host || 'unknown',
    total_visible_section_count: specs[0]?.presentation?.total_visible_section_count || sectionMap.size,
    total_visible_question_count: specs[0]?.presentation?.total_visible_question_count || specs.length,
    sections: [...sectionMap.values()],
    questions: specs.map((spec) => {
      // A report-only row takes no answer and setup never changes what it shows (the Codex hook
      // states, which the owner changes in Codex's /hooks), so only its place in the table is bound:
      // turning a hook on while the table is open does not void the answers.
      if (spec.report_only) {
        return { id: spec.id, key: spec.key, section_id: spec.presentation.section_id, section_index: spec.presentation.section_index,
          question_index: spec.presentation.question_index, question_ref: spec.presentation.question_ref, section_title: spec.section,
          title: spec.title, report_only: true, what_this_controls: spec.whatThisControls };
      }
      const recommendedChoice = selectedChoice(spec, spec.recommended);
      const displayedSelection = spec.selected || spec.empty_input || '';
      const displayedChoice = selectedChoice(spec, displayedSelection);
      return {
        id: spec.id,
        key: spec.key,
        section_id: spec.presentation.section_id,
        section_index: spec.presentation.section_index,
        question_index: spec.presentation.question_index,
        question_ref: spec.presentation.question_ref,
        section_title: spec.section,
        title: spec.title,
        ...(spec.report_only ? { report_only: true } : {}),
        what_this_controls: spec.whatThisControls,
        current: {
          effective_behavior: spec.currentState?.effectiveBehavior || spec.current,
          displayed_text: spec.current,
          table_text: spec.current_short || spec.current,
          verification: spec.currentState?.verification || 'unverified',
          ...(spec.currentState?.record_digest ? { record_digest: spec.currentState.record_digest } : {}),
        },
        availability: {
          status: spec.availability?.status || 'available',
          condition: spec.availability?.condition || '',
        },
        recommendation: {
          canonical_value: spec.recommended,
          choice_ref: spec.presentation.recommended_choice_ref,
          label: recommendedChoice?.label || '',
          outcome: spec.recommended_outcome,
          reason: spec.recommendation_reason,
        },
        choices: spec.choices.map((choice) => ({
          presentation_ref: choice.presentation_ref,
          canonical_value: choice.value,
          label: choice.label,
          consequence: choice.consequence,
        })),
        after_applying: spec.afterApplying,
        displayed_selection: {
          canonical_value: displayedSelection,
          choice_ref: displayedChoice?.presentation_ref || '',
          label: displayedChoice?.label || '',
        },
      };
    }),
  };
}

function questionBankSemanticIdentity(specs) {
  return crypto.createHash('sha256').update(JSON.stringify(questionBankApprovalPayload(specs))).digest('hex');
}

function bankReferenceFromIdentity(identity) {
  const bytes = Buffer.from(String(identity || ''), 'hex');
  if (bytes.length !== 32) throw new Error('Setup question bank identity must be a SHA-256 digest.');
  let bits = 0;
  let bitCount = 0;
  let compact = '';
  for (const byte of bytes.subarray(0, 10)) {
    bits = (bits << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      compact += BANK_REFERENCE_ALPHABET[(bits >>> bitCount) & 31];
      bits &= (1 << bitCount) - 1;
    }
  }
  return compact.match(/.{4}/g).join('-');
}

// Accepts any case, optional hyphens and the look-alike letters the alphabet leaves out
// (O for 0, I or L for 1). The result must still equal the displayed reference exactly.
function normalizeBankReference(value) {
  const compact = String(value || '').trim().toUpperCase().replace(/-/g, '')
    .replace(/O/g, '0').replace(/[IL]/g, '1');
  if (compact.length !== 16) return '';
  const normalized = compact.match(/.{4}/g).join('-');
  return BANK_REFERENCE_PATTERN.test(normalized) ? normalized : '';
}

function withPresentationMetadata(specs, host = specs[0]?.presentation?.host || 'unknown') {
  const sections = [];
  const sectionByName = new Map();
  for (const spec of specs) {
    if (!sectionByName.has(spec.section)) {
      const section = {
        id: spec.section.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        index: sections.length + 1,
        title: spec.section,
        question_count: 0,
      };
      sections.push(section);
      sectionByName.set(spec.section, section);
    }
    if (!spec.report_only) sectionByName.get(spec.section).question_count += 1;
  }
  // A report-only row is an unnumbered status line at the end of its section, so the numbered
  // questions stay contiguous and every number has letters.
  specs = [...specs].sort((left, right) => sectionByName.get(left.section).index - sectionByName.get(right.section).index
    || Number(Boolean(left.report_only)) - Number(Boolean(right.report_only)));
  const questionCount = answerable(specs).length;
  const seenBySection = new Map();
  const presented = specs.map((spec) => {
    const section = sectionByName.get(spec.section);
    const questionIndex = spec.report_only ? null : (seenBySection.get(spec.section) || 0) + 1;
    if (questionIndex) seenBySection.set(spec.section, questionIndex);
    const choices = spec.choices.map((choice, index) => ({
      ...choice,
      presentation_ref: spreadsheetChoiceReference(index + 1),
    }));
    const recommendedChoice = choices.find((choice) => choice.value === spec.recommended);
    return {
      ...spec,
      choices,
      presentation: {
        host,
        section_id: section.id,
        section_index: section.index,
        question_index: questionIndex,
        question_ref: questionIndex ? `${section.index}.${questionIndex}` : '',
        // A report-only row has no choices, so no recommended letter.
        recommended_choice_ref: recommendedChoice?.presentation_ref || '',
        total_visible_section_count: sections.length,
        total_visible_question_count: questionCount,
      },
    };
  });
  const bankIdentity = questionBankSemanticIdentity(presented);
  const bankReference = bankReferenceFromIdentity(bankIdentity);
  return presented.map((spec) => ({
    ...spec,
    presentation: { ...spec.presentation, bank_identity: bankIdentity, bank_reference: bankReference },
  }));
}

function ensurePresentationMetadata(specs) {
  // Presentation references are derived from the exact visible array. Always
  // rebuild them so a caller that filters an already-presented bank cannot
  // retain gaps or a stale bank identity.
  return withPresentationMetadata(specs);
}

function choiceByPresentationReference(spec, reference) {
  const normalized = String(reference || '').trim().toUpperCase();
  return spec.choices.find((choice) => choice.presentation_ref === normalized) || null;
}

function choiceReference(spec, value) {
  return selectedChoice(spec, value)?.presentation_ref || '';
}

const answerable = (specs) => specs.filter((spec) => !spec.report_only);
const statusLine = (spec) => `Status (nothing to answer): ${spec.title}: ${spec.current_short || spec.current}. ${spec.recommended_text}.`;

function renderQuestionRows(specs, onlyRef = '') {
  specs = ensurePresentationMetadata(specs);
  const lines = [];
  let section = '';
  for (const spec of specs) {
    if (onlyRef && spec.presentation.question_ref !== onlyRef) continue;
    if (spec.section !== section) {
      if (lines.length) lines.push('');
      section = spec.section;
      lines.push(`## ${spec.presentation.section_index}. ${section}`, '');
    }
    lines.push(spec.report_only ? `### Status (nothing to answer): ${spec.title}` : `### ${spec.presentation.question_ref} ${spec.title}`);
    lines.push('');
    lines.push(`**What this controls:** ${spec.whatThisControls}`);
    lines.push('');
    lines.push(`**Current:** ${spec.current}`);
    lines.push('');
    lines.push(`**Verification:** ${spec.currentState?.verification || 'unverified'}`);
    lines.push('');
    if (spec.report_only) {
      lines.push(`**What to do:** ${spec.recommended_text}`, '', `**Why:** ${spec.recommendation_reason}`, '', '---', '');
      continue;
    }
    lines.push(`**Recommended:** ${spec.presentation.recommended_choice_ref} - ${choiceLabel(spec, spec.recommended)}`);
    lines.push('');
    lines.push(`**Recommended outcome:** ${spec.recommended_outcome}`);
    lines.push('');
    lines.push(`**Why:** ${spec.recommendation_reason}`);
    lines.push('');
    lines.push('**Choices:**', '');
    for (const choice of spec.choices) lines.push(`- **${choice.presentation_ref}. ${choice.label}** - ${choice.consequence}`);
    if (spec.afterApplying) lines.push('', `**After applying:** ${spec.afterApplying}`);
    const selectedValue = spec.selected || spec.empty_input || '';
    lines.push('');
    lines.push(`**Selected:** ${selectedValue
      ? `${choiceReference(spec, selectedValue)} - ${choiceLabel(spec, selectedValue)}`
      : '(answer required)'}`);
    lines.push('', '---', '');
  }
  return lines.join('\n').trimEnd();
}

// Table cells hold one line: backslashes and pipes are escaped and line breaks become spaces.
const tableCell = (text) => String(text || '').replace(/\r?\n/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

// The bank as one compact table: the question, a short current state, the recommended choice and its
// effect, and the other choices. The full text of a question is shown only on request.
function renderCompactQuestionTable(specs, markdown = true) {
  specs = ensurePresentationMetadata(specs);
  // Keeping things as they are needs no outcome: the Current column already says what stays.
  // An outcome that only repeats the label is left out too.
  const keepsCurrent = (spec) => spec.recommended === 'keep' || spec.folded_into === spec.recommended;
  const recommended = (spec) => {
    const label = choiceLabel(spec, spec.recommended);
    const effect = keepsCurrent(spec) || spec.recommended_outcome === label ? '' : `: ${spec.recommended_outcome}`;
    return `${spec.presentation.recommended_choice_ref}. ${label}${effect}`;
  };
  const others = (spec) => spec.choices.filter((choice) => choice.value !== spec.recommended).map((choice) => `${choice.presentation_ref}. ${choice.label}`);
  const selected = (spec) => (spec.selected ? `${choiceReference(spec, spec.selected)}. ${choiceLabel(spec, spec.selected)}` : '');
  const lines = [];
  let section = '';
  let tableOpen = false;
  for (const spec of specs) {
    if (spec.section !== section) {
      section = spec.section;
      tableOpen = false;
      const heading = `${spec.presentation.section_index}. ${section}`;
      lines.push('', ...(markdown ? [`## ${heading}`] : [heading, '='.repeat(heading.length)]));
    }
    // Status lines come after the section's numbered questions (withPresentationMetadata orders them).
    if (spec.report_only) {
      lines.push('', statusLine(spec));
      continue;
    }
    if (markdown && !tableOpen) {
      lines.push('', '| # | Question | Current | Recommended | Other choices |', '|---|---|---|---|---|');
      tableOpen = true;
    }
    if (!markdown) {
      lines.push('', `${spec.presentation.question_ref} ${spec.title}`, `  Current: ${spec.current_short || spec.current}`, `  Recommended: ${recommended(spec)}`);
      const rest = others(spec);
      // One choice per line, so each alternative reads on its own.
      if (rest.length) lines.push('  Other choices:', ...rest.map((choice) => `    ${choice}`));
      if (spec.selected) lines.push(`  Selected: ${selected(spec)}`);
      continue;
    }
    const rest = others(spec).map(tableCell).join('<br>') || '-';
    const chosen = spec.selected ? `<br>Selected: ${tableCell(selected(spec))}` : '';
    lines.push(`| ${spec.presentation.question_ref} | ${tableCell(spec.title)} | ${tableCell(spec.current_short || spec.current)} | ${tableCell(recommended(spec))}${chosen} | ${rest} |`);
  }
  return lines;
}


// The bank's heading and reference; the reference documentation also lists a quick index (the bank's
// own table already shows every question).
function renderQuestionBankHeader(specs, markdown = true, quickIndex = true, title = 'Toolkit setup choices') {
  const questionCount = specs[0]?.presentation.total_visible_question_count || 0;
  const sectionCount = specs[0]?.presentation.total_visible_section_count || 0;
  const heading = `${title} - ${questionCount} questions across ${sectionCount} sections`;
  const bankReference = specs[0]?.presentation.bank_reference || '';
  const lines = [markdown ? `# ${heading}` : heading, '', `Bank reference: ${bankReference}`, ''];
  if (!quickIndex) return lines;
  lines.push('Quick index', '');
  for (const spec of specs) {
    lines.push(spec.report_only ? statusLine(spec)
      : `${spec.presentation.question_ref} ${spec.title} - Recommended: ${spec.presentation.recommended_choice_ref} - ${choiceLabel(spec, spec.recommended)}`);
  }
  lines.push('');
  return lines;
}

// Two changed-only items for the reply guide: the preferred rows first, then the first rows shown.
function changedOnlyExample(specs, preferred = []) {
  const picked = preferred.map((id) => specs.find((spec) => spec.id === id)).filter(Boolean);
  for (const spec of answerable(specs)) {
    if (picked.length >= 2) break;
    if (!picked.includes(spec)) picked.push(spec);
  }
  picked.sort((left, right) => specs.indexOf(left) - specs.indexOf(right));
  return picked.map((spec) => {
    const replacement = spec.choices.find((choice) => choice.value !== spec.recommended) || spec.choices[0];
    return `${spec.presentation.question_ref}=${replacement.presentation_ref}`;
  }).join(', ');
}

// One shared reading of concise answers: "all recommended" in any case, with spaces, hyphens,
// underscores or nothing between the words and one optional final full stop; changed-only items
// separated by commas, semicolons or spaces; and a reference followed by a colon or spaces.
const ALL_RECOMMENDED_ANSWER = /^all[\s_-]*recommended\.?$/i;
const ALL_RECOMMENDED_MENTION = /\ball[\s_-]*recommended/i;
const CHANGED_ONLY_ITEM = /^(\d+\.\d+)=([A-Za-z]{1,2})$/;

function isAllRecommendedAnswer(value) {
  return ALL_RECOMMENDED_ANSWER.test(String(value || '').trim());
}

function startsLikeConciseAnswer(value) {
  const text = String(value || '').trim();
  return /^all[\s_-]*recommended\.?(?:\s*$|\s*[,;])/i.test(text) || /^\d+\.\d+\s*=/.test(text);
}

function splitConciseEnvelope(text) {
  const colon = text.match(/^([^:\s]+)\s*:\s*([\s\S]+)$/);
  if (colon) return { reference: colon[1], payload: colon[2].trim() };
  // A space separator counts only when the first word reads as a complete reference,
  // so "all recommended" and "1.2=B 3.1=D" are never split into a reference.
  const spaced = text.match(/^(\S+)\s+([\s\S]+)$/);
  if (spaced && normalizeBankReference(spaced[1])) return { reference: spaced[1], payload: spaced[2].trim() };
  return null;
}

function changedOnlyItems(value) {
  // Collapse whitespace first so no pattern below can backtrack over a long run of spaces.
  const tokens = String(value || '').trim().replace(/\s+/g, ' ').replace(/ ?= ?/g, '=').split(/ ?[,;] ?| /);
  if (!tokens.length || tokens.some((token) => !CHANGED_ONLY_ITEM.test(token))) return null;
  return tokens.map((token) => token.match(CHANGED_ONLY_ITEM).slice(1));
}

function looksLikeConciseQuestionBankAnswer(value) {
  const text = String(value || '').trim();
  return ALL_RECOMMENDED_MENTION.test(text) || /^\d+\.\d+\s*=/.test(text);
}

function looksLikeConciseSubmission(value) {
  const text = String(value || '').trim();
  if (startsLikeConciseAnswer(text)) return true;
  const envelope = splitConciseEnvelope(text);
  return Boolean(envelope && startsLikeConciseAnswer(envelope.payload));
}

function parseConciseQuestionBankAnswer(input, specs, options = {}) {
  const label = options.label || 'Setup';
  const text = String(input || '').trim();
  if (!text) return null;
  const expectedReference = specs[0]?.presentation.bank_reference || '';
  const requireBankReference = options.requireBankReference !== false;
  let suppliedReference = expectedReference;
  let answerText = text;
  if (requireBankReference) {
    const envelope = splitConciseEnvelope(text);
    if (!envelope) {
      // Only the first line can start a concise answer; later lines of a line-by-line reply,
      // such as a custom path containing "all-recommended", are never read as one.
      if (looksLikeConciseQuestionBankAnswer(text.split(/\r?\n/, 1)[0])) {
        throw new Error(`Concise setup answers require the displayed bank reference. Reply with ${expectedReference}: followed by all recommended or indexed changes.`);
      }
      return null;
    }
    // A drive-letter path or another canonical line-by-line value may contain
    // a colon. Treat it as an approval envelope only when the payload is
    // recognizably one of the bounded concise answer modes.
    if (!looksLikeConciseQuestionBankAnswer(envelope.payload)) return null;
    suppliedReference = normalizeBankReference(envelope.reference);
    if (!suppliedReference) throw new Error(`${label} question bank reference is malformed or truncated; copy the complete displayed reference and retry before any setup write.`);
    if (suppliedReference !== expectedReference) throw new Error(`${label} question bank reference is stale or belongs to a different rendered bank; review the current bank and answer with its displayed reference.`);
    answerText = envelope.payload;
  } else {
    const optionalEnvelope = splitConciseEnvelope(text);
    if (optionalEnvelope) {
      const normalized = normalizeBankReference(optionalEnvelope.reference);
      if (!normalized || normalized !== expectedReference) {
        throw new Error(`${label} question bank reference does not match this live rendered bank.`);
      }
      suppliedReference = normalized;
      answerText = optionalEnvelope.payload;
    }
  }
  const identity = specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs);
  // A report-only row takes no answer, so it has no selection and no changed-only reference.
  specs = answerable(specs);
  if (isAllRecommendedAnswer(answerText)) {
    return {
      mode: 'all-recommended',
      binding_mode: requireBankReference ? 'displayed-reference' : 'same-process',
      bank_reference: suppliedReference,
      bank_identity: identity,
      selections: specs.map((spec) => ({
        question_id: spec.id,
        question_ref: spec.presentation.question_ref,
        choice_ref: spec.presentation.recommended_choice_ref,
        canonical_value: spec.recommended,
      })),
    };
  }
  if (ALL_RECOMMENDED_MENTION.test(answerText)) {
    throw new Error(`${label} question bank answer mixes or malforms the all recommended mode.`);
  }
  const items = changedOnlyItems(answerText);
  if (!items) {
    if (/\d+\.\d+\s*=/.test(answerText)) {
      throw new Error(`${label} question bank changed-only answer has malformed separators or mixed answer modes.`);
    }
    return null;
  }
  const byReference = new Map(specs.map((spec) => [spec.presentation.question_ref, spec]));
  const seen = new Set();
  const overrides = [];
  for (const [questionRef, rawChoiceRef] of items) {
    if (seen.has(questionRef)) throw new Error(`${label} question bank answer repeats question reference ${questionRef}.`);
    seen.add(questionRef);
    const spec = byReference.get(questionRef);
    if (!spec) throw new Error(`${label} question bank answer references unavailable question ${questionRef}.`);
    const choice = choiceByPresentationReference(spec, rawChoiceRef);
    if (!choice) throw new Error(`${label} question bank answer references unavailable choice ${rawChoiceRef.toUpperCase()} for ${questionRef}.`);
    overrides.push({
      question_id: spec.id,
      question_ref: questionRef,
      choice_ref: choice.presentation_ref,
      canonical_value: choice.value,
    });
  }
  const byQuestionId = new Map(overrides.map((selection) => [selection.question_id, selection]));
  return {
    mode: 'recommended-except',
    binding_mode: requireBankReference ? 'displayed-reference' : 'same-process',
    bank_reference: suppliedReference,
    bank_identity: identity,
    selections: specs.map((spec) => byQuestionId.get(spec.id) || ({
      question_id: spec.id,
      question_ref: spec.presentation.question_ref,
      choice_ref: spec.presentation.recommended_choice_ref,
      canonical_value: spec.recommended,
    })),
  };
}

function assertQuestionBankAnswerBinding(parsed, specs, label = 'Setup') {
  const currentIdentity = specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs);
  const currentReference = specs[0]?.presentation.bank_reference || bankReferenceFromIdentity(currentIdentity);
  if (!parsed || parsed.bank_identity !== currentIdentity || parsed.bank_reference !== currentReference) {
    throw new Error(`${label} question bank answer does not match the exact rendered bank.`);
  }
  specs = answerable(specs);
  if (parsed.selections.length !== specs.length) {
    throw new Error(`${label} question bank answer does not cover the exact rendered bank.`);
  }
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const selection = parsed.selections[index];
    const choice = selectedChoice(spec, selection.canonical_value);
    if (selection.question_id !== spec.id
        || selection.question_ref !== spec.presentation.question_ref
        || !choice
        || choice.presentation_ref !== selection.choice_ref) {
      throw new Error(`${label} question bank answer contains stale or inconsistent presentation references.`);
    }
  }
}

module.exports = Object.freeze({
  BANK_REFERENCE_PATTERN,
  wizardChoice,
  resolvedQuestion,
  choiceValues,
  choiceLabel,
  selectedChoice,
  spreadsheetChoiceReference,
  questionBankApprovalPayload,
  questionBankSemanticIdentity,
  bankReferenceFromIdentity,
  normalizeBankReference,
  withPresentationMetadata,
  ensurePresentationMetadata,
  choiceByPresentationReference,
  choiceReference,
  answerable,
  statusLine,
  renderQuestionRows,
  renderCompactQuestionTable,
  renderQuestionBankHeader,
  changedOnlyExample,
  isAllRecommendedAnswer,
  looksLikeConciseQuestionBankAnswer,
  looksLikeConciseSubmission,
  parseConciseQuestionBankAnswer,
  assertQuestionBankAnswerBinding,
});
