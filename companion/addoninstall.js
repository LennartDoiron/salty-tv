// The SaltyTV addon normally comes from CurseForge. The app also carries a copy:
// it installs that only if the addon is missing, and only updates copies it put
// there itself (marked with a small file), so it never fights the CurseForge app
// over a copy CurseForge manages. Your addon settings live in WoW's WTF folder
// and are never touched.
const fs = require('fs');
const path = require('path');

const NAME = 'SaltyTV';
const MARK = '.installed-by-saltytv-app'; // "this copy is the app's to update"
const MIN_COMPATIBLE = '0.4.0';           // the corner markers changed in 0.4

/** "## Version: 0.5.0" from an addon's .toc, or null. */
function tocVersion(dir) {
  try {
    const toc = fs.readFileSync(path.join(dir, `${NAME}.toc`), 'utf8');
    const m = /^##\s*Version:\s*([\w.-]+)/mi.exec(toc);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Compares "0.10.2" and "0.9" numerically: <0, 0 or >0. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function copyIn(srcDir, addOnsDir) {
  fs.mkdirSync(addOnsDir, { recursive: true });
  const dest = path.join(addOnsDir, NAME);
  // copy next to it first, then swap, so WoW never sees a half-copied addon
  const fresh = path.join(addOnsDir, `${NAME}.saltytv-new`);
  const old = path.join(addOnsDir, `${NAME}.saltytv-old`);
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.rmSync(old, { recursive: true, force: true });
  fs.cpSync(srcDir, fresh, { recursive: true });
  fs.writeFileSync(path.join(fresh, MARK), 'Installed by the SaltyTV app, which keeps this copy up to date.\n');
  if (fs.existsSync(dest)) fs.renameSync(dest, old);
  fs.renameSync(fresh, dest);
  fs.rmSync(old, { recursive: true, force: true });
}

/**
 * Check the addon and install or update it when that's the app's job.
 * force = you clicked "Update it for me" (also takes over a CurseForge/manual copy).
 * @returns {{ status, version, latest, compatible }}
 *   status: 'installed' | 'updated' | 'current' | 'newer' (installed is newer than the app's copy)
 *           | 'outdated' (older, but from CurseForge or copied by hand: update it there)
 */
function installAddon(srcDir, addOnsDir, { force = false } = {}) {
  const latest = tocVersion(srcDir);
  if (!latest) throw new Error('the app is missing its copy of the addon');
  const dest = path.join(addOnsDir, NAME);
  const have = tocVersion(dest);
  const result = (status, version) => ({ status, version, latest,
    compatible: compareVersions(version, MIN_COMPATIBLE) >= 0 });

  if (!have) {
    copyIn(srcDir, addOnsDir);
    return result('installed', latest);
  }
  const cmp = compareVersions(have, latest);
  if (cmp > 0) return result('newer', have);
  if (cmp === 0) return result('current', have);
  if (force || fs.existsSync(path.join(dest, MARK))) {
    copyIn(srcDir, addOnsDir);
    return { ...result('updated', latest), previous: have };
  }
  return result('outdated', have);
}

module.exports = { installAddon, tocVersion, compareVersions, MIN_COMPATIBLE };
