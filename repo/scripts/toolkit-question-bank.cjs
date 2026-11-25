'use strict';

// The question bank format shared by `setup toolkit` and `toolkit governance`: one table per section
// with the columns #, Question, Current, Recommended and Other choices; lettered choices with Keep
// current first (the choice that changes nothing folds into it); a bank reference bound to exactly
// what is shown; and one reading of the reply (`all recommended`, or only the changes such as
// `1.2=B`). A bank of strong-default rows (below) asks one approval question instead. Callers build
// their own rows and decide what an answer does; nothing here writes.

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
      // turning a hook on while the table is open does not void the answers. A row whose text says what
      // the answer will do (`bound_text`) binds that text too, so the answer applies only what was shown.
      if (spec.report_only) {
        return { id: spec.id, key: spec.key, section_id: spec.presentation.section_id, section_index: spec.presentation.section_index,
          question_index: spec.presentation.question_index, question_ref: spec.presentation.question_ref, section_title: spec.section,
          title: spec.title, report_only: true, what_this_controls: spec.whatThisControls,
          ...(spec.bound_text ? { shown: spec.bound_text } : {}) };
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
        ...(spec.strong_default ? { strong_default: { state: spec.default_state, applies_default: spec.applies_default } } : {}),
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
  // Questions are numbered without gaps in the order given; a report-only row is always an
  // unnumbered status line at the end of its section, so every number has letters.
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

// `brief` leaves out the verification and selected lines (an explain of one row before any answer).
function renderQuestionRows(specs, onlyRef = '', { brief = false } = {}) {
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
    if (!brief) lines.push(`**Verification:** ${spec.currentState?.verification || 'unverified'}`, '');
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
    if (!brief) {
      lines.push('');
      lines.push(`**Selected:** ${selectedValue
        ? `${choiceReference(spec, selectedValue)} - ${choiceLabel(spec, selectedValue)}`
        : '(answer required)'}`);
    }
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
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const heading = `${title} - ${plural(questionCount, 'question')} across ${plural(sectionCount, 'section')}`;
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
    if (!spec) throw Object.assign(new Error(`${label} question bank answer references unavailable question ${questionRef}.`), { code: 'QUESTION_BANK_UNKNOWN_ROW', question_ref: questionRef });
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
  // A row the reply leaves out takes its recommendation, or with options.leftOut (spec => the value it
  // takes instead, such as Keep current) that choice.
  const leftOut = (spec) => {
    const choice = options.leftOut ? selectedChoice(spec, options.leftOut(spec)) : null;
    if (options.leftOut && !choice) throw new Error(`${label} question bank row ${spec.presentation.question_ref} has no choice to keep.`);
    return {
      question_id: spec.id,
      question_ref: spec.presentation.question_ref,
      choice_ref: choice ? choice.presentation_ref : spec.presentation.recommended_choice_ref,
      canonical_value: choice ? choice.value : spec.recommended,
    };
  };
  return {
    mode: 'recommended-except',
    binding_mode: requireBankReference ? 'displayed-reference' : 'same-process',
    bank_reference: suppliedReference,
    bank_identity: identity,
    selections: specs.map((spec) => byQuestionId.get(spec.id) || leftOut(spec)),
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

// Strong-default rows. Each row keeps its number, choices and full text, but setup asks no question of its own
// for it: the bank asks one approval question, approvalQuestion(). The row's state says what a yes does.
// UNSET takes the row's Toolkit default; every other state keeps what is there: a value Toolkit set
// (TOOLKIT_DEFAULT), the owner's own value (OWNER_VALUE), the owner's earlier off (OWNER_OFF, so a default is
// never put back), a setting setup could not read (UNREADABLE) or one this Claude Code version does not have
// (UNSUPPORTED). Nothing is written for the last two, so setup never asks about them: it only says which they
// are, and never counts them as having a value (unsetNotes). The owner overrides one row
// with its number and a choice letter, value or word (`3.5=off`); a row the reply leaves out keeps its current
// value unless the reply also says yes. No reply, or no, writes nothing.
const STRONG_DEFAULT_STATES = Object.freeze({ UNSET: 'unset', TOOLKIT_DEFAULT: 'toolkit-default', OWNER_VALUE: 'owner-value', OWNER_OFF: 'owner-off', UNREADABLE: 'unreadable', UNSUPPORTED: 'unsupported' });
const KEPT_REASONS = Object.freeze({
  unset: 'Toolkit leaves this as it is by default.',
  'toolkit-default': 'The Toolkit default is already in place.',
  'owner-value': 'This is your own value, so setup keeps it.',
  'owner-off': 'You turned this off, so setup keeps it off.',
  unreadable: 'Setup could not read this setting, so it writes nothing.',
  unsupported: 'This Claude Code version does not have this setting, so setup writes nothing.',
});
// The one approval question, saying how many settings a yes would set. It makes sense on its own on a native question card.
// With none left setup asks no question, so there is none to word. `pending` is the rows a yes would set; one whose
// off may be the owner's own (offNote) is the exception the sentence names, with the reply that keeps it off.
function approvalQuestion(pending) {
  const one = pending.length === 1;
  const unsure = pending.filter((spec) => spec.off_note).map((spec) => `${spec.presentation.question_ref}: ${spec.off_note}, and ${spec.presentation.question_ref}=off keeps it off`);
  return `Apply Toolkit's default${one ? '' : 's'} to the ${pending.length} Claude Code setting${one ? '' : 's'} that ${one ? 'has' : 'have'} no value yet? Your own values and offs stay${unsure.length ? `, except ${unsure.join('; ')}` : ''}.`;
}

// definition: a resolvedQuestion definition plus defaultState, defaultChoice (the value a yes applies while the
// row is UNSET; 'keep' for a row whose default is to leave it), defaultOutcome and defaultReason, and optionally
// keptValue (what keeping means for this row, such as install for a plugin kept current), aliases (extra
// words for choices, such as { on: 'enable', off: 'disable' }), unreadableNote (what setup still does beside a
// setting it could not read) and offNote (why an UNSET row's off may be the owner's own).
function strongDefaultRow(definition) {
  const { defaultState, defaultChoice, defaultOutcome, defaultReason, keptValue = 'keep', aliases = {}, unreadableNote = '', offNote = '' } = definition;
  const stillDone = defaultState === STRONG_DEFAULT_STATES.UNREADABLE ? unreadableNote : '';
  if (!Object.values(STRONG_DEFAULT_STATES).includes(defaultState)) throw new Error(`Setup row ${definition.id} has no strong-default state.`);
  const applies = defaultState === STRONG_DEFAULT_STATES.UNSET && defaultChoice !== 'keep';
  const recommendation = applies
    ? { value: defaultChoice, outcome: defaultOutcome, reason: defaultReason }
    : { value: keptValue, outcome: 'Keep it as it is.', reason: [KEPT_REASONS[defaultState], stillDone].filter(Boolean).join(' ') };
  return {
    ...resolvedQuestion({ ...definition, recommendation }),
    strong_default: true, default_state: defaultState, default_choice: defaultChoice, applies_default: applies, aliases: { ...aliases }, still_done: stillDone, off_note: offNote,
  };
}

// A row a setup flag already answered is not pending: the flag's choice applies.
const pendingDefaults = (specs) => answerable(specs).filter((spec) => spec.applies_default && !spec.selected);
// The rows that hold no value setup could read, one sentence for each kind; none when every row was read.
// `name` says how each row is named: its number where the table is shown, which is all it needs there.
const inState = (specs, state) => answerable(specs).filter((spec) => spec.default_state === state && !spec.selected);
const settingCount = (rows) => `${rows.length} setting${rows.length === 1 ? '' : 's'}`;
function unsetNotes(specs, name = (spec) => spec.presentation.question_ref) {
  const refs = (rows) => rows.map(name).join(', ');
  const unreadable = inState(specs, STRONG_DEFAULT_STATES.UNREADABLE);
  const unsupported = inState(specs, STRONG_DEFAULT_STATES.UNSUPPORTED);
  return [
    ...(unreadable.length ? [[`Setup could not read ${settingCount(unreadable)} (${refs(unreadable)}), so it writes nothing there.`, ...unreadable.map((spec) => spec.still_done).filter(Boolean)].join(' ')] : []),
    ...(unsupported.length ? [`This Claude Code version does not have ${settingCount(unsupported)} (${refs(unsupported)}), so setup writes nothing there.`] : []),
  ];
}
// Why setup asks nothing when no default is left to apply, as a title and a sentence.
function nothingToAsk(specs) {
  const notes = unsetNotes(specs);
  const unreadable = inState(specs, STRONG_DEFAULT_STATES.UNREADABLE);
  return notes.length
    ? { title: `no questions: nothing to approve${unreadable.length ? `, and ${settingCount(unreadable)} could not be read` : ''}`,
      sentence: `No setting needs your approval, so setup asks nothing and keeps them all as they are. ${notes.join(' ')}` }
    : { title: 'no questions: every setting already has a value', sentence: 'Every setting already has a value, so setup asks nothing and keeps them all as they are.' };
}

// The bank of strong-default rows: the one question, then one table per section with every column, then the
// one reply line. The Setup applies column shows what a yes does for each row; a row a setup flag answered
// shows the flag's choice, which the reply cannot change.
function renderStrongDefaultBank(specs, { markdown = true } = {}) {
  specs = ensurePresentationMetadata(specs);
  const applies = (spec) => {
    if (spec.selected) return `${choiceReference(spec, spec.selected)}. ${choiceLabel(spec, spec.selected)} (set by your setup flag)`;
    const label = choiceLabel(spec, spec.recommended);
    const effect = spec.applies_default && spec.recommended_outcome !== label ? `: ${spec.recommended_outcome}` : '';
    return `${spec.presentation.recommended_choice_ref}. ${label}${effect}${spec.applies_default ? ' (Toolkit default)' : ''}`;
  };
  const others = (spec) => (spec.selected ? [] : spec.choices.filter((choice) => choice.value !== spec.recommended).map((choice) => `${choice.presentation_ref}. ${choice.label}`));
  const waiting = pendingDefaults(specs);
  const pending = waiting.length;
  const rows = answerable(specs);
  const flagged = rows.filter((spec) => spec.selected).length;
  const title = flagged === rows.length ? 'no questions: your setup flags answer every setting'
    : pending ? `1 question: ${approvalQuestion(waiting)}` : nothingToAsk(specs).title;
  const summary = flagged === rows.length ? 'Your setup flags answer every setting, so setup asks nothing and applies them as shown.'
    : [...(pending ? [`Setup applies the Toolkit default to ${pending} setting${pending === 1 ? '' : 's'} not set yet and keeps every other setting as it is.`, ...unsetNotes(specs)]
      : [nothingToAsk(specs).sentence, markdown ? NOTHING_PENDING_CHANGE : NOTHING_PENDING_CHANGE_TERMINAL]),
    ...(flagged ? [`${flagged} setting${flagged === 1 ? ' is' : 's are'} set by your setup flags, and the reply cannot change ${flagged === 1 ? 'it' : 'them'}.`] : [])].join(' ');
  const lines = [
    markdown ? `# Toolkit setup - ${title}` : `Toolkit setup - ${title}`,
    '',
    `Bank reference: ${specs[0]?.presentation.bank_reference || ''}`,
    '',
    summary,
  ];
  let section = '';
  for (const spec of specs) {
    if (spec.section !== section) {
      section = spec.section;
      const heading = `${spec.presentation.section_index}. ${section}`;
      lines.push('', ...(markdown ? [`## ${heading}`, '', '| # | Setting | Current | Setup applies | Other choices |', '|---|---|---|---|---|'] : [heading, '='.repeat(heading.length)]));
    }
    if (spec.report_only) { lines.push(markdown ? `| - | ${tableCell(spec.title)} | ${tableCell(spec.current_short || spec.current)} | ${tableCell(spec.recommended_text)} | - |` : `${statusLine(spec)}`); continue; }
    if (markdown) lines.push(`| ${spec.presentation.question_ref} | ${tableCell(spec.title)} | ${tableCell(spec.current_short || spec.current)} | ${tableCell(applies(spec))} | ${others(spec).map(tableCell).join('<br>') || '-'} |`);
    else {
      lines.push('', `${spec.presentation.question_ref} ${spec.title}`, `  Current: ${spec.current_short || spec.current}`, `  Setup applies: ${applies(spec)}`);
      const rest = others(spec);
      if (rest.length) lines.push('  Other choices:', ...rest.map((choice) => `    ${choice}`));
    }
  }
  return lines;
}

// How to change one row when setup asks nothing: a reply in a chat, or a flag in the owner's own terminal,
// where nothing is prompted.
const NOTHING_PENDING_CHANGE = 'To change one, reply with its number and choice, for example 3.5=B (on and off work too).';
const NOTHING_PENDING_CHANGE_TERMINAL = 'To change one, run setup again with its flag (--help lists them), or say setup toolkit in a chat and reply there.';
// The reply line under the bank: the approval question for the same pending settings, then the reply grammar.
const strongDefaultReply = (pending) => `${approvalQuestion(pending)} Reply yes to apply the Setup applies column, or no to change nothing. To change a setting, add its number and choice, for example 3.5=B (on and off work too); a setting you do not list keeps its current value unless you also say yes.`;

const YES_WORDS = new Set(['yes', 'y', 'all-recommended']);
const STRONG_DEFAULT_ITEM = /^(\d+\.\d+)=([A-Za-z][A-Za-z-]{0,23})$/;
const looksLikeStrongDefaultAnswer = (value) => /^(?:yes|no|y|n|all[\s_-]*recommended)\b|^\d+\.\d+\s*=/i.test(String(value || '').trim());

function strongDefaultChoice(spec, word) {
  const lower = word.toLowerCase();
  const byLetter = word.length <= 2 ? choiceByPresentationReference(spec, word) : null;
  const value = byLetter?.value || spec.choices.find((choice) => choice.value.toLowerCase() === lower)?.value
    || (spec.aliases?.[lower] && selectedChoice(spec, spec.aliases[lower]) ? spec.aliases[lower] : '')
    || (spec.folded_value === lower ? spec.folded_into : '');
  return value ? selectedChoice(spec, value) : null;
}

// Reads a reply to the one approval question. Returns null when the text is not such a reply. mode is
// apply-defaults (yes, with any changes), changes-only (changes alone: other rows keep their current value) or
// declined (no: nothing is written).
function parseStrongDefaultAnswer(input, specs, options = {}) {
  const label = options.label || 'Setup';
  const text = String(input || '').trim();
  if (!text) return null;
  const expectedReference = specs[0]?.presentation.bank_reference || '';
  const requireBankReference = options.requireBankReference !== false;
  let suppliedReference = expectedReference;
  let answerText = text;
  const envelope = splitConciseEnvelope(text);
  if (envelope && looksLikeStrongDefaultAnswer(envelope.payload)) {
    suppliedReference = normalizeBankReference(envelope.reference);
    if (!suppliedReference) throw new Error(`${label} question bank reference is malformed or truncated; copy the complete displayed reference and retry before any setup write.`);
    if (suppliedReference !== expectedReference) throw new Error(`${label} question bank reference is stale or belongs to a different rendered bank; review the current bank and answer with its displayed reference.`);
    answerText = envelope.payload;
  } else if (requireBankReference) {
    if (looksLikeStrongDefaultAnswer(text.split(/\r?\n/, 1)[0])) {
      throw new Error(`Setup answers require the displayed bank reference. Reply with ${expectedReference}: followed by yes, no or the changes.`);
    }
    return null;
  } else if (!looksLikeStrongDefaultAnswer(text)) return null;
  const identity = specs[0]?.presentation.bank_identity || questionBankSemanticIdentity(specs);
  specs = answerable(specs);
  const tokens = answerText.replace(/all[\s_-]*recommended/ig, 'all-recommended').replace(/\s+/g, ' ').replace(/ ?= ?/g, '=')
    .replace(/\.$/, '').split(/ ?[,;] ?| /).filter(Boolean);
  const base = { binding_mode: requireBankReference ? 'displayed-reference' : 'same-process', bank_reference: suppliedReference, bank_identity: identity };
  if (tokens.length === 1 && ['no', 'n'].includes(tokens[0].toLowerCase())) return { ...base, mode: 'declined', selections: [], overrides: [] };
  let yes = false;
  const byReference = new Map(specs.map((spec) => [spec.presentation.question_ref, spec]));
  const overrides = new Map();
  for (const token of tokens) {
    if (YES_WORDS.has(token.toLowerCase())) {
      if (yes) throw new Error(`${label} question bank answer says yes twice.`);
      yes = true;
      continue;
    }
    const item = STRONG_DEFAULT_ITEM.exec(token);
    if (!item) throw new Error(`${label} question bank answer has a part it cannot read: ${token}. Reply yes, no, or changes such as 3.5=B.`);
    const [, questionRef, word] = item;
    if (overrides.has(questionRef)) throw new Error(`${label} question bank answer repeats question reference ${questionRef}.`);
    const spec = byReference.get(questionRef);
    if (!spec) throw Object.assign(new Error(`${label} question bank answer references unavailable question ${questionRef}.`), { code: 'QUESTION_BANK_UNKNOWN_ROW', question_ref: questionRef });
    if (options.fixed?.(spec)) throw new Error(`${label} question bank row ${questionRef} is already set by a setup flag; leave it out of the reply.`);
    const choice = strongDefaultChoice(spec, word);
    if (!choice) throw new Error(`${label} question bank answer references unavailable choice ${word} for ${questionRef}.`);
    overrides.set(questionRef, choice);
  }
  // A row left out keeps its current value (its Keep current choice), or with a yes takes what the bank showed.
  // A row with no Keep current choice has nothing to keep, so it takes what the bank showed either way.
  const leftOut = (spec) => (yes || spec.choices[0]?.label !== 'Keep current' ? spec.recommended : spec.choices[0].value);
  const selections = specs.map((spec) => {
    const choice = overrides.get(spec.presentation.question_ref) || selectedChoice(spec, spec.selected || leftOut(spec));
    return { question_id: spec.id, question_ref: spec.presentation.question_ref, choice_ref: choice.presentation_ref, canonical_value: choice.value };
  });
  return { ...base, mode: yes ? 'apply-defaults' : 'changes-only', selections, overrides: [...overrides.keys()] };
}

module.exports = Object.freeze({
  BANK_REFERENCE_PATTERN,
  STRONG_DEFAULT_STATES,
  strongDefaultReply,
  approvalQuestion,
  strongDefaultRow,
  pendingDefaults,
  unsetNotes,
  nothingToAsk,
  renderStrongDefaultBank,
  parseStrongDefaultAnswer,
  looksLikeStrongDefaultAnswer,
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
