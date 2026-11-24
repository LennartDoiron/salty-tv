// Finds WoW Forever's AddOns folder: ...\World of Warcraft\_forever_\Interface\AddOns
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const FOREVER = '_forever_';

/** Where Battle.net installed WoW, from the registry (Windows only). */
function registryInstallPath() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    execFile('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\World of Warcraft', '/v', 'InstallPath'],
      { windowsHide: true }, (err, stdout) => {
        if (err) return resolve(null);
        const m = /InstallPath\s+REG_SZ\s+(.+)/i.exec(stdout || '');
        resolve(m ? m[1].trim() : null);
      });
  });
}

/**
 * Turn whatever folder someone picked (WoW root, _forever_, Interface, AddOns,
 * or the _retail_ path from the registry) into Forever's AddOns folder.
 * Returns null if there's no _forever_ folder to be found.
 */
function addOnsDirFrom(picked) {
  if (!picked) return null;
  let p = path.resolve(String(picked).replace(/[\\/]+$/, ''));
  // inside _forever_ already? cut back to it
  const parts = p.split(path.sep);
  const i = parts.lastIndexOf(FOREVER);
  if (i >= 0) {
    p = parts.slice(0, i + 1).join(path.sep) || path.sep;
  } else {
    // _retail_ / _classic_ etc. -> go up to the WoW root
    if (/^_.+_$/.test(path.basename(p))) p = path.dirname(p);
    p = path.join(p, FOREVER);
  }
  if (!isDir(p)) return null;
  return path.join(p, 'Interface', 'AddOns');
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function defaultRoots() {
  if (process.platform !== 'win32') return [];
  const roots = [];
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    for (const base of ['Program Files (x86)', 'Program Files', 'Games', 'Battle.net', '']) {
      roots.push(path.join(drive + '\\', base, 'World of Warcraft'));
    }
  }
  return roots;
}

/** Best guess for the AddOns folder, or null. `saved` = a folder picked earlier. */
async function findAddOnsDir(saved) {
  const candidates = [saved, await registryInstallPath(), ...defaultRoots()].filter(Boolean);
  for (const c of candidates) {
    const dir = addOnsDirFrom(c);
    if (dir) return dir;
  }
  return null;
}

/** Make sure Interface\AddOns exists (a fresh Forever install may not have it yet). */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { findAddOnsDir, addOnsDirFrom, ensureDir };
