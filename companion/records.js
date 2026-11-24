// Your own numbers for the guild leaderboard: current balance, peak balance and
// biggest win. Saved in the app's data folder so they survive restarts.
//
// Tournaments use separate tournament funds, so balances are only recorded in
// matchmaking and exhibition matches. Wins count in every mode: tournament
// winnings get added to your real balance once the tournament ends.

const fs = require('fs');
const crypto = require('crypto');
const { REAL_BALANCE_MODES } = require('./modes');

const DEFAULTS = {
  id: null,          // random ID for this install, so your alts show up once
  saltyName: null,   // your SaltyBet name, learned after your first bet from the bar
  saltyKey: null,    // your SaltyBet user ID (from zdata.json)
  balance: 0,
  peak: 0,
  biggestWin: 0,
  updated: 0,        // unix seconds of the last change (the addon's "newest wins" version)
};

/** Winnings for a winning bet in a pool: your share of the other side's pot. */
function payout(wager, ownPot, otherPot) {
  if (!(wager > 0) || !(ownPot > 0) || !(otherPot >= 0)) return 0;
  return Math.floor((wager * otherPot) / ownPot);
}

class Records {
  constructor(file, now = () => Math.floor(Date.now() / 1000)) {
    this.file = file;
    this.now = now;
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
    this.d = { ...DEFAULTS, ...saved };
    if (!this.d.id) { this.d.id = crypto.randomUUID().replace(/-/g, '').slice(0, 16); this.save(); }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.d, null, 2));
    fs.renameSync(tmp, this.file);
  }

  touch() {
    this.d.updated = Math.max(this.now(), this.d.updated + 1);
    this.save();
    return true;
  }

  /** A balance reading. Returns true if anything changed. */
  onBalance(balance, mode) {
    if (!REAL_BALANCE_MODES.has(mode) || !(balance > 0)) return false;
    if (balance === this.d.balance && balance <= this.d.peak) return false;
    this.d.balance = balance;
    this.d.peak = Math.max(this.d.peak, balance);
    return this.touch();
  }

  /** A bet you won (any mode). Returns true if it's a new biggest win. */
  onWin(amount) {
    if (!(amount > this.d.biggestWin)) return false;
    this.d.biggestWin = Math.floor(amount);
    return this.touch();
  }

  setSaltyName(name, key) {
    if (!name || (name === this.d.saltyName && key === this.d.saltyKey)) return false;
    this.d.saltyName = String(name);
    this.d.saltyKey = key ? String(key) : this.d.saltyKey;
    return this.touch();
  }

  get() {
    return { ...this.d };
  }
}

/**
 * Find your own entry in SaltyBet's zdata.json after a bet from the bar:
 * same side, same wager, and a balance matching yours before the bet.
 * Returns { key, name } only if exactly one bettor fits.
 */
function findSelfInZdata(zdata, { side, wager, balanceBefore }) {
  const p = side === 'player1' ? '1' : '2';
  const num = (v) => parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10);
  const hits = [];
  for (const [key, e] of Object.entries(zdata || {})) {
    if (!e || typeof e !== 'object' || !e.n) continue;
    if (String(e.p) !== p || num(e.w) !== wager) continue;
    const b = num(e.b);
    if (balanceBefore && b !== balanceBefore && b !== balanceBefore - wager) continue;
    hits.push({ key, name: String(e.n) });
  }
  return hits.length === 1 ? hits[0] : null;
}

module.exports = { Records, payout, findSelfInZdata };
