// Writes your leaderboard numbers into a tiny addon, SaltyTV_Data, next to SaltyTV.
// WoW reads it when you log in or /reload (the same trick WeakAuras Companion
// uses). It lives in its own folder so updating SaltyTV from CurseForge never
// wipes it. The first time it appears, WoW needs one full restart to notice it.

const fs = require('fs');
const path = require('path');

const NAME = 'SaltyTV_Data';

/** Use the same ## Interface number as the installed SaltyTV addon. */
function interfaceVersion(addOnsDir) {
  try {
    const toc = fs.readFileSync(path.join(addOnsDir, 'SaltyTV', 'SaltyTV.toc'), 'utf8');
    const m = /^##\s*Interface:\s*([\d,\s]+)$/m.exec(toc);
    if (m) return m[1].trim();
  } catch { /* SaltyTV not installed yet */ }
  return '16001';
}

function luaString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n') + '"';
}

const int = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0);

function renderLua(r) {
  return [
    '-- Written by the SaltyTV app. WoW reads this when you log in or /reload.',
    '-- Do not edit: the app overwrites it.',
    'SaltyTV_AppData = {',
    '  version = 1,',
    `  id = ${luaString(r.id)},`,
    `  saltyName = ${r.saltyName ? luaString(r.saltyName) : 'nil'},`,
    `  balance = ${int(r.balance)},`,
    `  peak = ${int(r.peak)},`,
    `  biggestWin = ${int(r.biggestWin)},`,
    `  updated = ${int(r.updated)},`,
    '}',
    '',
  ].join('\n');
}

function renderToc(iface) {
  return [
    `## Interface: ${iface}`,
    '## Title: SaltyTV Data',
    '## Notes: Your SaltyBet numbers for the SaltyTV guild leaderboard. Written by the SaltyTV app.',
    '## Author: SaltyTV',
    '',
    `${NAME}.lua`,
    '',
  ].join('\n');
}

function writeIfChanged(file, text) {
  try { if (fs.readFileSync(file, 'utf8') === text) return false; } catch { /* new file */ }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return true;
}

/**
 * @returns {{ dir: string, created: boolean, changed: boolean }}
 *   created = the folder is new, so WoW needs a full restart once
 */
function writeDataAddon(addOnsDir, record) {
  const dir = path.join(addOnsDir, NAME);
  const created = !fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  const tocChanged = writeIfChanged(path.join(dir, `${NAME}.toc`), renderToc(interfaceVersion(addOnsDir)));
  const luaChanged = writeIfChanged(path.join(dir, `${NAME}.lua`), renderLua(record));
  return { dir, created, changed: tocChanged || luaChanged };
}

module.exports = { writeDataAddon, renderLua, renderToc, interfaceVersion, NAME };
