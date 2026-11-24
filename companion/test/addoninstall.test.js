// The addon comes from CurseForge; the app only installs it when it's missing and
// only updates copies it installed itself (or when you ask it to).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installAddon, tocVersion, compareVersions } = require('../addoninstall');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saltytv-addon-'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const addon = (dir, version, files = ['SaltyTV.lua']) => {
  fs.rmSync(dir, { recursive: true, force: true });
  write(path.join(dir, 'SaltyTV.toc'), `## Interface: 16001\n## Title: SaltyTV\n## Version: ${version}\n\n${files.join('\n')}\n`);
  for (const f of files) write(path.join(dir, f), `-- ${f} ${version}`);
};

assert(compareVersions('0.10.0', '0.9.9') > 0 && compareVersions('0.5', '0.5.0') === 0 && compareVersions('1.0.0', '1.0.1') < 0);

const app = path.join(tmp, 'app', 'SaltyTV');
addon(app, '0.5.0', ['SaltyTV.lua', 'Sync.lua', 'Board.lua']);
const addOns = path.join(tmp, 'World of Warcraft', '_forever_', 'Interface', 'AddOns'); // doesn't exist yet
const mine = path.join(addOns, 'SaltyTV');
const marked = () => fs.existsSync(path.join(mine, '.installed-by-saltytv-app'));

// 1. no addon yet (came to the app first): the app installs it, and will keep it updated
let r = installAddon(app, addOns);
assert.strictEqual(r.status, 'installed');
assert.strictEqual(tocVersion(mine), '0.5.0');
assert(fs.existsSync(path.join(mine, 'Board.lua')) && marked());
console.log('ok  missing addon: installed by the app (creates Interface\\AddOns if needed)');

assert.strictEqual(installAddon(app, addOns).status, 'current');
console.log('ok  already up to date: left alone');

// 2. the app's own older copy: updated cleanly; other addons untouched; no temp folders
addon(mine, '0.4.0', ['SaltyTV.lua', 'Old.lua']);
write(path.join(mine, '.installed-by-saltytv-app'), 'x');
write(path.join(addOns, 'Details', 'Details.toc'), '## Title: Details');
r = installAddon(app, addOns);
assert.strictEqual(r.status, 'updated');
assert.strictEqual(r.previous, '0.4.0');
assert(!fs.existsSync(path.join(mine, 'Old.lua')) && fs.existsSync(path.join(mine, 'Sync.lua')) && marked());
assert.deepStrictEqual(fs.readdirSync(addOns).sort(), ['Details', 'SaltyTV'], 'no temp folders left behind');
console.log("ok  the app's own older copy is updated (stale files gone, other addons untouched)");

// 3. an older CurseForge copy (no mark): left alone, you're told to update it there
addon(mine, '0.4.1');
r = installAddon(app, addOns);
assert.deepStrictEqual(r, { status: 'outdated', version: '0.4.1', latest: '0.5.0', compatible: true });
assert.strictEqual(tocVersion(mine), '0.4.1', 'CurseForge copy untouched');
console.log("ok  an older CurseForge copy is left to CurseForge (status 'outdated', still compatible)");

// ... unless you click "Update it for me"
r = installAddon(app, addOns, { force: true });
assert.strictEqual(r.status, 'updated');
assert(tocVersion(mine) === '0.5.0' && marked());
console.log('ok  "Update it for me" updates it (and the app keeps it updated from then on)');

// 4. too old to work with this app
addon(mine, '0.3.2');
r = installAddon(app, addOns);
assert(r.status === 'outdated' && r.compatible === false);
console.log('ok  an addon from before 0.4 is flagged as too old for this app');

// 5. newer from CurseForge: kept
addon(mine, '0.6.0');
assert.strictEqual(installAddon(app, addOns).status, 'newer');
assert.strictEqual(tocVersion(mine), '0.6.0');
console.log('ok  a newer addon from CurseForge is kept');

// 6. broken folder (no .toc): replaced
fs.rmSync(mine, { recursive: true });
write(path.join(mine, 'junk.txt'), 'x');
assert.strictEqual(installAddon(app, addOns).status, 'installed');
assert(!fs.existsSync(path.join(mine, 'junk.txt')));
console.log('ok  a broken SaltyTV folder is replaced');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('all addon install tests passed');
