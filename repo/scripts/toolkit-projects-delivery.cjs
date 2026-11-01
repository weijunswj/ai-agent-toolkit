'use strict';

// Shared, stateless Projects delivery checks. Each feature owns and persists its own receipts.
// Keep a receipt for the whole message lifetime; refuse capacity instead of evicting live ids.
const crypto = require('node:crypto');
const MAX_DELIVERY_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_DELIVERIES = 4096;
const deliveryHash = id => crypto.createHash('sha256').update(id).digest('hex');

function currentReceipts(receipts, now) {
  return receipts.filter(entry => entry && /^[0-9a-f]{64}$/.test(entry.id)
    && Date.parse(entry.at) >= now.getTime() - MAX_DELIVERY_AGE_MS);
}

// Returns a new receipt, or null. No state is changed until its owner persists it.
function deliveryReceipt(delivery, receipts, now, notBefore = null) {
  const sent = Date.parse(delivery.sentAt);
  if (typeof delivery.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,256}$/.test(delivery.id)
    || !Number.isFinite(sent) || sent < now.getTime() - MAX_DELIVERY_AGE_MS || sent > now.getTime()
    || (notBefore !== null && (!Number.isFinite(notBefore) || sent <= notBefore))) return null;
  const id = deliveryHash(delivery.id);
  if (receipts.some(entry => entry.id === id) || receipts.length >= MAX_DELIVERIES) return null;
  return { id, at: now.toISOString() };
}

module.exports = Object.freeze({ MAX_DELIVERY_AGE_MS, MAX_DELIVERIES, deliveryHash, currentReceipts, deliveryReceipt });
