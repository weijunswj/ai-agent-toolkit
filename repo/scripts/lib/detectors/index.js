'use strict';

const detectGOV001 = require('./det-gov001');
const detectGOV002 = require('./det-gov002');
const detectGOV003 = require('./det-gov003');
const detectGOV004 = require('./det-gov004');
const detectGOV005 = require('./det-gov005');
const detectGOV006 = require('./det-gov006');
const detectGOV007 = require('./det-gov007');
const detectGOV008 = require('./det-gov008');
const detectGOV009 = require('./det-gov009');
const detectGOV010 = require('./det-gov010');
const detectGOV011 = require('./det-gov011');
const detectGOV012 = require('./det-gov012');
const detectGOV013 = require('./det-gov013');
const detectGOV014 = require('./det-gov014');
const detectGOV015 = require('./det-gov015');
const detectGOV016 = require('./det-gov016');
const detectGOV017 = require('./det-gov017');
const detectGOV018 = require('./det-gov018');
const detectGOV019 = require('./det-gov019');
const detectGOV020 = require('./det-gov020');
const detectGOV021 = require('./det-gov021');
const detectGOV022 = require('./det-gov022');
const detectGOV023 = require('./det-gov023');
const detectGOV024 = require('./det-gov024');
const detectGOV025 = require('./det-gov025');
const detectGOV026 = require('./det-gov026');
const detectGOV027 = require('./det-gov027');

const DETECTOR_REGISTRY = Object.freeze({
  GOV001: detectGOV001,
  GOV002: detectGOV002,
  GOV003: detectGOV003,
  GOV004: detectGOV004,
  GOV005: detectGOV005,
  GOV006: detectGOV006,
  GOV007: detectGOV007,
  GOV008: detectGOV008,
  GOV009: detectGOV009,
  GOV010: detectGOV010,
  GOV011: detectGOV011,
  GOV012: detectGOV012,
  GOV013: detectGOV013,
  GOV014: detectGOV014,
  GOV015: detectGOV015,
  GOV016: detectGOV016,
  GOV017: detectGOV017,
  GOV018: detectGOV018,
  GOV019: detectGOV019,
  GOV020: detectGOV020,
  GOV021: detectGOV021,
  GOV022: detectGOV022,
  GOV023: detectGOV023,
  GOV024: detectGOV024,
  GOV025: detectGOV025,
  GOV026: detectGOV026,
  GOV027: detectGOV027
});

module.exports = Object.freeze({ DETECTOR_REGISTRY });
