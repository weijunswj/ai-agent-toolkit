'use strict';

// A Toolkit cloud workflow copy as installers wrote them before layouts: every Toolkit checkout pinned
// to one commit and no layout in the header. Governed repositories still carry such copies until their
// refresh pull request lands, so the tests make them from today's render.
const { MARKER, TOOLKIT_REF, bodyHash } = require('../../scripts/toolkit-cloud-workflows-render.cjs');

function pinnedCopy(text, commit) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const marker = MARKER.exec(lines[0]);
  if (!marker) throw new Error('not a rendered copy');
  const body = lines.slice(1).join('\n').split(`ref: ${TOOLKIT_REF}`).join(`ref: ${commit}`)
    .replace(/^# A copy of the Toolkit's own workflow,[^\n]*$/m, "# A copy of the Toolkit's own workflow, pinned to the Toolkit commit above. Do not edit it here: refresh the repository rules to update it.");
  return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${marker[1]} toolkit=${commit} sha256=${bodyHash(body)}\n${body}`;
}

module.exports = { pinnedCopy };
