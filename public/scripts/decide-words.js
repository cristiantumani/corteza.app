/**
 * Whether typed text reads like a decision (docs/specs/2026-10-decide-and-close.md): decision words
 * in Spanish or English, and not a question. Shared by the browser (window.CortezaDecideWords) and
 * the server (core/agent/decide requires this file), so both agree.
 */
(function(root) {
  'use strict';
  const MAX_TEXT = 500;
  const DECISION_WORDS = [
    /\b(hemos |ya )?(decidimos|decidido|acordamos|acordado|resolvimos|definimos|quedamos en|se decidi[oó]|se acord[oó]|descartamos|cancelamos|aprobamos|elegimos|optamos)\b/i,
    /\b(no )?vamos a (ir|seguir|hacer|lanzar|contratar|usar|avanzar|perseguir|implementar)\b/i,
    /\bno vamos (por|con)\b/i,
    /\b(we|we've|we have|team) (decided|agreed|chose|dropped|cancelled|canceled|approved|settled)\b/i,
    /\bwe('re| are)? not (going|doing|pursuing|moving)\b/i,
    /\bwe (won't|will not|will no longer)\b/i,
    /\bdecided (to|not to|against)\b/i
  ];

  function looksLikeDecision(text) {
    if (typeof text !== 'string') return false;
    const value = text.trim();
    if (value.length < 8 || value.length > MAX_TEXT) return false;
    if (/[?¿]/.test(value)) return false;
    return DECISION_WORDS.some(pattern => pattern.test(value));
  }

  const api = { looksLikeDecision, MAX_TEXT };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CortezaDecideWords = api;
})(globalThis);
