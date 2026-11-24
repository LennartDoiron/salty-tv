// Fighter stats from SaltyBoy (https://salty-boy.com), a community project that
// records every SaltyBet match. We ask once per match (a few retries if SaltyBoy
// hasn't caught up yet) and never poll in a loop: it's a small, free server.

const BASE = 'https://salty-boy.com/api';
const RETRY_MS = [0, 3000, 6000, 10000]; // waits before each try of current_match_info

/** Win/loss summary from a fighter object that includes its `matches` list. */
function fighterStats(info) {
  if (!info || !Array.isArray(info.matches)) return null;
  const total = info.matches.length;
  const wins = info.matches.filter((m) => m && m.winner === info.id).length;
  return summary(info, wins, total);
}

function summary(fighter, wins, total) {
  return {
    wins,
    losses: total - wins,
    total,
    winRate: total ? wins / total : null,
    elo: fighter.elo ?? null,
    tier: fighter.tier ?? null,
    bestStreak: fighter.best_streak ?? null,
  };
}

function parseCurrentMatch(data) {
  return {
    red: fighterStats(data.fighter_red_info),
    blue: fighterStats(data.fighter_blue_info),
    tier: data.tier || null,
    format: data.match_format || null,
  };
}

const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

async function getJson(fetchFn, url) {
  const r = await fetchFn(url);
  if (!r.ok) throw new Error(`SaltyBoy ${r.status}`);
  return r.json();
}

/** Backup path: find a fighter by exact name and count their matches and wins. */
async function lookupByName(fetchFn, name) {
  const list = await getJson(fetchFn, `${BASE}/fighter/?name=${encodeURIComponent(name)}&page_size=1`);
  const f = list && Array.isArray(list.results) ? list.results[0] : null;
  if (!f) return null;
  const [all, won] = await Promise.all([
    getJson(fetchFn, `${BASE}/match/?fighter=${f.id}&page_size=1`),
    getJson(fetchFn, `${BASE}/match/?fighter=${f.id}&winner=${f.id}&page_size=1`),
  ]);
  return summary(f, Number(won.count) || 0, Number(all.count) || 0);
}

/**
 * Stats for the match between p1 (red) and p2 (blue).
 * @param fetchFn   fetch-compatible function
 * @param opts.isCurrent  returns false once a newer match has started (stop early)
 * @param opts.sleep      injectable for tests
 * @returns {Promise<{red, blue, tier, format, source}|null>} null if superseded
 */
async function fetchMatchStats(fetchFn, p1, p2, opts = {}) {
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const isCurrent = opts.isCurrent || (() => true);

  for (const wait of RETRY_MS) {
    if (wait) await sleep(wait);
    if (!isCurrent()) return null;
    try {
      const data = await getJson(fetchFn, `${BASE}/current_match_info/`);
      if (same(data.fighter_red, p1) && same(data.fighter_blue, p2)) {
        return { ...parseCurrentMatch(data), source: 'current' };
      }
    } catch {
      // network hiccup or SaltyBoy busy: try again after the next wait
    }
  }

  // SaltyBoy hasn't picked up this match (lagging, or an exhibition it doesn't
  // track): look each fighter up by name instead.
  if (!isCurrent()) return null;
  try {
    const [red, blue] = await Promise.all([lookupByName(fetchFn, p1), lookupByName(fetchFn, p2)]);
    return {
      red, blue,
      tier: (red && red.tier) || (blue && blue.tier) || null,
      format: null,
      source: red || blue ? 'lookup' : 'none',
    };
  } catch {
    return { red: null, blue: null, tier: null, format: null, source: 'error' };
  }
}

module.exports = { fetchMatchStats, fighterStats, parseCurrentMatch, RETRY_MS };
