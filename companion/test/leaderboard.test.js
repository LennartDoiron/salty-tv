// Tests for the app side of the guild leaderboard: your numbers, finding WoW,
// and writing the SaltyTV_Data addon. Uses temp folders, no WoW needed.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Records, payout, findSelfInZdata } = require('../records');
const { addOnsDirFrom } = require('../wowpath');
const { writeDataAddon, renderLua, interfaceVersion } = require('../dataaddon');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saltytv-'));
let clock = 1_700_000_000;
const now = () => clock;

// ---- your numbers ----
{
  const file = path.join(tmp, 'records.json');
  const r = new Records(file, now);
  assert.match(r.get().id, /^[0-9a-f]{16}$/);
  assert.strictEqual(r.onBalance(5000, 'tournament'), false, 'tournament funds are not your real balance');
  assert.strictEqual(r.onBalance(5000, 'unknown'), false);
  assert.strictEqual(r.onBalance(5000, 'matchmaking'), true);
  clock += 60;
  assert.strictEqual(r.onBalance(5000, 'matchmaking'), false, 'no change, no new version');
  assert.strictEqual(r.onBalance(9000, 'matchmaking'), true);
  clock += 60;
  assert.strictEqual(r.onBalance(4000, 'matchmaking'), true, 'a drop still updates the current balance');
  let d = r.get();
  assert.deepStrictEqual([d.balance, d.peak], [4000, 9000]);
  assert.strictEqual(r.onWin(1200), true);
  assert.strictEqual(r.onWin(800), false, 'smaller win is not a record');
  assert.strictEqual(r.get().biggestWin, 1200);
  clock += 60;
  assert.strictEqual(r.onBalance(4500, 'exhibition'), true, 'exhibitions use your real balance');
  assert.strictEqual(r.onWin(3000), true, 'a tournament win counts too (it gets added to your real balance)');
  const v1 = r.get().updated;
  assert.strictEqual(r.setSaltyName('lenny', '962878'), true);
  assert(r.get().updated > v1, 'version always moves forward, even within the same second');
  // survives a restart
  const again = new Records(file, now);
  assert.deepStrictEqual(again.get(), r.get());
  d = r.get();
  assert.deepStrictEqual([d.balance, d.peak, d.biggestWin], [4500, 9000, 3000]);
  console.log('ok  balance/peak (matchmaking + exhibition, never tournament funds), biggest win (any mode), persisted');
}

// ---- payout from the pots ----
{
  assert.strictEqual(payout(1000, 1_028_701, 2_676_525), 2601);   // underdog pays well
  assert.strictEqual(payout(1000, 2_676_525, 1_028_701), 384);    // favourite pays little
  assert.strictEqual(payout(0, 10, 10), 0);
  assert.strictEqual(payout(10, 0, 10), 0);
  console.log('ok  payout = your share of the other pot');
}

// ---- learning your SaltyBet name from zdata.json ----
{
  const z = {
    p1name: 'A', p2name: 'B', status: 'locked',
    '962878': { n: 'i3aro', b: '617', p: '1', w: '617', r: '1', g: '0', c: '0' },
    '962893': { n: 'JaCoglione', b: '3562', p: '2', w: '362', r: '0', g: '0', c: '0' },
    '111111': { n: 'lenny', b: '12345', p: '1', w: '2500', r: '3', g: '0', c: '0' },
    '222222': { n: 'twin', b: '9999', p: '1', w: '2500', r: '3', g: '0', c: '0' },
  };
  assert.deepStrictEqual(findSelfInZdata(z, { side: 'player1', wager: 2500, balanceBefore: 12345 }), { key: '111111', name: 'lenny' });
  assert.strictEqual(findSelfInZdata(z, { side: 'player1', wager: 2500, balanceBefore: 0 }), null, 'two people bet 2500: ambiguous');
  assert.strictEqual(findSelfInZdata(z, { side: 'player2', wager: 2500, balanceBefore: 12345 }), null);
  assert.deepStrictEqual(findSelfInZdata(z, { side: 'player2', wager: 362, balanceBefore: 3562 }), { key: '962893', name: 'JaCoglione' });
  console.log('ok  finds you in the bettor list only when exactly one bettor fits');
}

// ---- finding Forever's AddOns folder from whatever was picked ----
{
  const root = path.join(tmp, 'World of Warcraft');
  fs.mkdirSync(path.join(root, '_retail_'), { recursive: true });
  fs.mkdirSync(path.join(root, '_forever_', 'Interface', 'AddOns'), { recursive: true });
  const want = path.join(root, '_forever_', 'Interface', 'AddOns');
  for (const picked of [root, root + path.sep, path.join(root, '_retail_'), path.join(root, '_forever_'),
    path.join(root, '_forever_', 'Interface'), want, path.join(want, 'SaltyTV')]) {
    assert.strictEqual(addOnsDirFrom(picked), want, `picked ${picked}`);
  }
  assert.strictEqual(addOnsDirFrom(path.join(tmp, 'Somewhere else')), null);
  assert.strictEqual(addOnsDirFrom(null), null);
  console.log('ok  AddOns folder found from the WoW root, _retail_, _forever_, Interface or AddOns');
}

// ---- writing SaltyTV_Data ----
{
  const addons = path.join(tmp, 'World of Warcraft', '_forever_', 'Interface', 'AddOns');
  fs.mkdirSync(path.join(addons, 'SaltyTV'), { recursive: true });
  fs.writeFileSync(path.join(addons, 'SaltyTV', 'SaltyTV.toc'), '## Interface: 16001\n## Title: SaltyTV\n');
  assert.strictEqual(interfaceVersion(addons), '16001');

  const rec = { id: 'abc123', saltyName: 'len"ny\\x', balance: 12345.9, peak: 50000, biggestWin: 2601, updated: 1700000123 };
  let res = writeDataAddon(addons, rec);
  assert.strictEqual(res.created, true, 'first write creates the folder (needs a WoW restart)');
  assert.strictEqual(res.changed, true);
  const toc = fs.readFileSync(path.join(addons, 'SaltyTV_Data', 'SaltyTV_Data.toc'), 'utf8');
  assert.match(toc, /^## Interface: 16001$/m);
  assert.match(toc, /^SaltyTV_Data\.lua$/m);
  res = writeDataAddon(addons, rec);
  assert.deepStrictEqual([res.created, res.changed], [false, false], 'unchanged data is not rewritten');
  res = writeDataAddon(addons, { ...rec, balance: 13000, updated: 1700000200 });
  assert.deepStrictEqual([res.created, res.changed], [false, true]);
  assert(!fs.readdirSync(path.join(addons, 'SaltyTV_Data')).some((f) => f.endsWith('.tmp')), 'no temp files left behind');
  const lua = fs.readFileSync(path.join(addons, 'SaltyTV_Data', 'SaltyTV_Data.lua'), 'utf8');
  assert.match(lua, /balance = 13000,/);
  assert.match(lua, /saltyName = "len\\"ny\\\\x",/);
  assert.match(renderLua({ id: 'x', saltyName: null, balance: 1, peak: 1, biggestWin: 0, updated: 1 }), /saltyName = nil,/);
  fs.writeFileSync(path.join(tmp, 'sample-data.lua'), lua); // the Lua simulation loads this
  console.log('ok  SaltyTV_Data written (toc + lua), only when changed, no temp files');
}

fs.writeFileSync(path.join(os.tmpdir(), 'saltytv-last-tmp'), tmp);
console.log('all leaderboard tests passed');
