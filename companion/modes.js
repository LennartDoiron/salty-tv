// Which SaltyBet mode a match is in. SaltyBet says it in state.json's
// "remaining" message, for example:
//   matchmaking: "14 more matches until the next tournament!"
//   tournament:  "6 characters are left in the bracket!"
// SaltyBoy also reports "matchmaking" or "tournament" for matches it tracks.
//
// Tournaments use separate tournament funds, so the leaderboard never records a
// balance unless the mode is clearly matchmaking or exhibition.

/**
 * @param {string} remaining   state.json "remaining" text
 * @param {string|null} boyFormat  SaltyBoy match_format for this match, if known
 * @returns {{ mode: 'matchmaking'|'tournament'|'exhibition'|'unknown', next: 'tournament'|null }}
 */
function detectMode(remaining, boyFormat) {
  const r = String(remaining || '').toLowerCase();
  const f = String(boyFormat || '').toLowerCase();
  const next = /tournament mode will be activated/.test(r) ? 'tournament' : null;

  if (f === 'tournament' || /in the bracket|final round/.test(r)) return { mode: 'tournament', next: null };
  if (f === 'matchmaking' || /until the next tournament/.test(r) || next) return { mode: 'matchmaking', next };
  if (/exhibition matches? left|matchmaking mode will be activated/.test(r)) return { mode: 'exhibition', next: null };
  return { mode: 'unknown', next: null };
}

/** Modes where your SaltyBet balance is your real balance. */
const REAL_BALANCE_MODES = new Set(['matchmaking', 'exhibition']);

module.exports = { detectMode, REAL_BALANCE_MODES };
