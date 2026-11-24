// Tests for telling matchmaking, tournaments and exhibitions apart.
const assert = require('assert');
const { detectMode, REAL_BALANCE_MODES } = require('../modes');

const cases = [
  // [remaining text, SaltyBoy format, expected mode, expected next]
  ['14 more matches until the next tournament!', null, 'matchmaking', null], // seen live on SaltyBet
  ['6 characters are left in the bracket!', null, 'tournament', null],       // seen live during a tournament
  ['Tournament mode will be activated after the next match!', null, 'matchmaking', 'tournament'],
  ['FINAL ROUND! Stay tuned for exhibitions after the tournament!', null, 'tournament', null],
  ['25 exhibition matches left!', null, 'exhibition', null],
  ['Matchmaking mode will be activated after the next exhibition match!', null, 'exhibition', null],
  ['', 'tournament', 'tournament', null],
  ['', 'matchmaking', 'matchmaking', null],
  ['', null, 'unknown', null],
  [undefined, undefined, 'unknown', null],
  ['Something new SaltyBet says', null, 'unknown', null],
  // if anything says tournament, it's a tournament (never record tournament funds as a real balance)
  ['14 more matches until the next tournament!', 'tournament', 'tournament', null],
  ['6 characters are left in the bracket!', 'matchmaking', 'tournament', null],
];
for (const [text, fmt, mode, next] of cases) {
  const got = detectMode(text, fmt);
  assert.deepStrictEqual(got, { mode, next }, `detectMode(${JSON.stringify(text)}, ${fmt}) -> ${JSON.stringify(got)}`);
}
console.log(`ok  ${cases.length} mode cases (matchmaking, tournament, exhibition, tournament next, unknown)`);

assert(REAL_BALANCE_MODES.has('matchmaking') && REAL_BALANCE_MODES.has('exhibition'));
assert(!REAL_BALANCE_MODES.has('tournament') && !REAL_BALANCE_MODES.has('unknown'));
console.log('ok  only matchmaking and exhibition balances count as your real balance');
console.log('all mode tests passed');
