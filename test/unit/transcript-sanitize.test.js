const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTranscriptText } = require('../../src/middleware/ai-validation');
const { spokenText } = require('../../src/core/language/detect');

const RAW = 'Meeting: Revisión\r\nDate: 2026-09-29\n\n\n\nTranscript:\nAna:   hola,   empecemos  \nJosé:\tdale\n\nMeeting notes (Gemini):\nNext steps: send the deck\u0007';

test('speaker turns and sections keep their line breaks', () => {
  assert.equal(sanitizeTranscriptText(RAW),
    'Meeting: Revisión\nDate: 2026-09-29\n\nTranscript:\nAna: hola, empecemos\nJosé: dale\n\nMeeting notes (Gemini):\nNext steps: send the deck');
});

test('language detection still finds the spoken transcript after sanitizing', () => {
  assert.equal(spokenText(sanitizeTranscriptText(RAW)), 'Transcript:\nAna: hola, empecemos\nJosé: dale');
});

test('empty input stays empty', () => {
  assert.equal(sanitizeTranscriptText(''), '');
  assert.equal(sanitizeTranscriptText(null), '');
});
