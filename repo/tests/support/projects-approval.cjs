'use strict';

// The two direct Projects delivery shapes observed on the host. All identities are test fixtures.
const encode = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll("'", '&#39;').replaceAll('"', '&quot;');
function wake(text, { id = `cmsg_${require('node:crypto').randomUUID()}`, now = () => new Date(), at = now().toISOString(), thread = true, note = '', encoded = true } = {}) {
  const message = `<message trigger="true" from="human" trust="principal" author-id="user_example" id="${id}" sent-at="${at}" mention="true">${encoded ? encode(text) : text}</message>`;
  return `<wake reason="mention" current-time="${at}"><project id="chan_example" type="project">${thread ? `<thread ts="cmsg_thread">${message}</thread>` : message}</project>${note}</wake>`;
}
const slug = 'weijunswj/tk-uat-missing-pr-20261101';
const numbers = [9, 10, 11, 13, 14, 12];
const lines = numbers.map(pr => `merge ${slug}#${pr}`).join('\n');
module.exports = { wake, slug, numbers, lines };
