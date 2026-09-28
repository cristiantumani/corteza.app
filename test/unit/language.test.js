const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectLanguage, spokenText } = require('../../src/core/language/detect');
const { outputLanguage, buildDecisionExtractionPrompt } = require('../../src/services/claude');

const SPANISH = 'Cristian: bueno entonces lo que vamos a hacer es presentar al directorio tres escenarios, porque tenemos que mostrar que hay un plan. Pao: sí, y también hay que revisar las ventas de septiembre con Jess para ver como cerramos el mes.';
const ENGLISH = 'Summary: the team agreed to present three scenarios to the board, and they will review the September sales with Jess to see how the month closes. Next steps are to prepare the deck and share it with the board before the meeting.';

test('the language of a meeting is guessed from common words', () => {
  assert.equal(detectLanguage(SPANISH), 'es');
  assert.equal(detectLanguage(ENGLISH), 'en');
  assert.equal(detectLanguage('hola equipo'), null, 'too little text');
});

test('short outcomes can be checked too', () => {
  assert.equal(detectLanguage('Se decide presentar tres escenarios al directorio', { short: true }), 'es');
  assert.equal(detectLanguage('Pancho Viga will be invited to participate in board meetings', { short: true }), 'en');
});

test('the spoken transcript decides, not Gemini notes written in another language', () => {
  const text = `Meeting: Weekly Ops\n\nTranscript:\n${SPANISH}\n\nMeeting notes (Gemini):\n${ENGLISH} ${ENGLISH} ${ENGLISH}`;
  assert.equal(detectLanguage(spokenText(text)), 'es');
  assert.equal(outputLanguage(text, 'auto'), 'es');
  assert.equal(outputLanguage(text, 'en'), 'en', 'a language chosen in settings wins');
  assert.equal(outputLanguage(`Meeting notes (Gemini):\n${ENGLISH}`, null), 'en', 'notes only: their language');
});

test('the extraction prompt names the output language', () => {
  assert.match(buildDecisionExtractionPrompt('...', [], [], 'es'), /OUTPUT LANGUAGE: Spanish\nTRANSCRIPT:/);
  assert.doesNotMatch(buildDecisionExtractionPrompt('...', [], [], null), /OUTPUT LANGUAGE/);
});
