// Tests for SaltyBoy stats and the $ box helpers. Uses a fake fetch, no network.
const assert = require('assert');
const { fetchMatchStats, fighterStats, parseCurrentMatch } = require('../saltyboy');
const { parseAmount, fmtMoney, fmtShort } = require('../ui/util');

// Shaped like a real /api/current_match_info/ response (fields checked against the live API).
function fighter(id, name, wins, losses, extra = {}) {
  const matches = [];
  for (let i = 0; i < wins; i++) matches.push({ id: 1000 + i, fighter_red: id, fighter_blue: 9999, winner: id, colour: 'Red', tier: 'B', match_format: 'matchmaking' });
  for (let i = 0; i < losses; i++) matches.push({ id: 2000 + i, fighter_red: id, fighter_blue: 9999, winner: 9999, colour: 'Blue', tier: 'B', match_format: 'matchmaking' });
  return { id, name, elo: 1600, tier: 'B', prev_tier: 'B', tier_elo: 1610, best_streak: 7, matches, ...extra };
}
const CURRENT = {
  fighter_red: 'Jack tenrec', fighter_blue: 'Airi',
  fighter_red_info: fighter(2028, 'Jack tenrec', 13, 8),
  fighter_blue_info: fighter(4107, 'Airi', 5, 15, { elo: 1450 }),
  match_format: 'matchmaking', tier: 'B', updated_at: '2026-11-23T20:50:59',
};

function fakeFetch(routes, log = []) {
  return async (url) => {
    log.push(url);
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) {
        const value = typeof body === 'function' ? body(url) : body;
        if (value instanceof Error) throw value;
        return { ok: true, status: 200, json: async () => value };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}
const noSleep = async () => {};

(async () => {
  // fighterStats / parseCurrentMatch
  {
    const s = fighterStats(CURRENT.fighter_red_info);
    assert.deepStrictEqual([s.wins, s.losses, s.total], [13, 8, 21]);
    assert(Math.abs(s.winRate - 13 / 21) < 1e-9);
    assert.strictEqual(s.elo, 1600);
    assert.strictEqual(fighterStats(null), null);
    assert.strictEqual(fighterStats({ id: 1 }), null);
    const z = fighterStats({ id: 1, matches: [] });
    assert.strictEqual(z.total, 0); assert.strictEqual(z.winRate, null);
    const m = parseCurrentMatch(CURRENT);
    assert.strictEqual(m.tier, 'B'); assert.strictEqual(m.format, 'matchmaking');
    assert.strictEqual(m.blue.wins, 5);
    console.log('ok  win rate math (13–8 = 62%, 5–15 = 25%)');
  }

  // names match on the first try: one request only
  {
    const log = [];
    const r = await fetchMatchStats(fakeFetch([['current_match_info', CURRENT]], log), 'Jack tenrec', 'Airi', { sleep: noSleep });
    assert.strictEqual(r.source, 'current');
    assert.strictEqual(Math.round(r.red.winRate * 100), 62);
    assert.strictEqual(log.length, 1);
    console.log('ok  in-sync match: 1 request');
  }

  // SaltyBoy still on the previous match, catches up on the 3rd try
  {
    let n = 0; const log = [];
    const routes = [['current_match_info', () => (++n < 3 ? { ...CURRENT, fighter_red: 'Old guy', fighter_blue: 'Older guy' } : CURRENT)]];
    const r = await fetchMatchStats(fakeFetch(routes, log), 'Jack tenrec', 'Airi', { sleep: noSleep });
    assert.strictEqual(r.source, 'current');
    assert.strictEqual(log.length, 3);
    console.log('ok  lagging SaltyBoy: retried until it caught up (3 requests)');
  }

  // never catches up -> backup lookup by name using match counts
  {
    const log = [];
    const routes = [
      ['current_match_info', { ...CURRENT, fighter_red: 'Someone', fighter_blue: 'Else' }],
      ['fighter/?name=Jack%20tenrec', { page: 0, page_size: 1, count: 1, results: [{ id: 2028, name: 'Jack tenrec', elo: 1562, tier: 'A', best_streak: 9 }] }],
      ['fighter/?name=Airi', { page: 0, page_size: 1, count: 1, results: [{ id: 4107, name: 'Airi', elo: 1614, tier: 'A', best_streak: 7 }] }],
      ['match/?fighter=2028&winner=2028', { count: 70 }],
      ['match/?fighter=2028&page_size', { count: 130 }],
      ['match/?fighter=4107&winner=4107', { count: 66 }],
      ['match/?fighter=4107&page_size', { count: 132 }],
    ];
    const r = await fetchMatchStats(fakeFetch(routes, log), 'Jack tenrec', 'Airi', { sleep: noSleep });
    assert.strictEqual(r.source, 'lookup');
    assert.deepStrictEqual([r.red.wins, r.red.losses], [70, 60]);
    assert.deepStrictEqual([r.blue.wins, r.blue.losses], [66, 66]);
    assert.strictEqual(r.tier, 'A');
    assert.strictEqual(log.filter((u) => u.includes('current_match_info')).length, 4);
    console.log(`ok  backup lookup by name (${log.length} requests total)`);
  }

  // exhibition / unknown fighters -> "No stats", not an error
  {
    const routes = [
      ['current_match_info', { ...CURRENT, fighter_red: 'x', fighter_blue: 'y' }],
      ['fighter/?name=', { page: 0, page_size: 1, count: 0, results: [] }],
    ];
    const r = await fetchMatchStats(fakeFetch(routes), 'Team A', 'Team B', { sleep: noSleep });
    assert.strictEqual(r.source, 'none');
    assert.strictEqual(r.red, null); assert.strictEqual(r.tier, null);
    console.log('ok  unknown fighters -> no stats');
  }

  // SaltyBoy down entirely
  {
    const r = await fetchMatchStats(fakeFetch([['', new Error('offline')]]), 'A', 'B', { sleep: noSleep });
    assert.strictEqual(r.source, 'error');
    console.log('ok  SaltyBoy offline -> handled');
  }

  // a new match starts while we're waiting -> stop, no more requests
  {
    let current = true; const log = [];
    const routes = [['current_match_info', () => { current = false; return { ...CURRENT, fighter_red: 'Old' }; }]];
    const r = await fetchMatchStats(fakeFetch(routes, log), 'Jack tenrec', 'Airi', { sleep: noSleep, isCurrent: () => current });
    assert.strictEqual(r, null);
    assert.strictEqual(log.length, 1);
    console.log('ok  superseded match: stops early');
  }

  // $ box parsing and formatting
  {
    const cases = { '500': 500, '1,000': 1000, '$2k': 2000, '1.5m': 1500000, ' 2.5K ': 2500, '1b': 1e9,
      '0': null, '': null, 'abc': null, '-5': null, '5x': null, '0.4': null, '12.9': 12 };
    for (const [input, want] of Object.entries(cases)) assert.strictEqual(parseAmount(input), want, `parseAmount(${JSON.stringify(input)})`);
    assert.strictEqual(fmtMoney(1234567), '$1,234,567');
    assert.strictEqual(fmtShort(1028701), '$1.03M');
    assert.strictEqual(fmtShort(2676525), '$2.68M');
    assert.strictEqual(fmtShort(45800), '$45.8K');
    assert.strictEqual(fmtShort(250000), '$250K');
    assert.strictEqual(fmtShort(2000000), '$2M');
    assert.strictEqual(fmtShort(1100000), '$1.1M');
    assert.strictEqual(fmtShort(600), '$600');
    assert.strictEqual(fmtShort(1.82e12), '$1.82T');
    console.log('ok  amount parsing (500, 1,000, 2k, 1.5m) and money formatting');
  }

  console.log('all stats tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
