// SaltyTV companion: finds the SaltyTV addon's frame on screen, lays the
// SaltyBet stream and a betting bar over it, and talks to saltybet.com using
// your logged-in session.
//
// Two overlay windows:
//   video - the Twitch stream. Fully click-through, so WoW gets every click.
//   bar   - the betting bar under it. Always clickable, never takes focus.
// Keeping them separate means we never need Electron's mouse-forwarding mode,
// which installs a system-wide mouse hook (that was the cause of mouse jitter).

const { app, BrowserWindow, desktopCapturer, screen, ipcMain, session, net, dialog, Tray, Menu, nativeImage } = require('electron');
const { Worker } = require('worker_threads');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { findMarkerNear, rectFromMarkers, stillInPlace } = require('./detector');
const { fetchMatchStats } = require('./saltyboy');
const native = require('./native');
const { findAddOnsDir, addOnsDirFrom, ensureDir } = require('./wowpath');
const { Records, findSelfInZdata } = require('./records');
const { betResult, detectDeduction, availableToBet } = require('./bets');
const { writeDataAddon } = require('./dataaddon');
const { detectMode } = require('./modes');
const { installAddon, compareVersions } = require('./addoninstall');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* running from source without it */ }

const SALTY = 'https://www.saltybet.com';
const SCAN_FOUND_MS = 500;   // while the TV is on screen
const SCAN_IDLE_MS = 1500;   // while it isn't (WoW closed, TV hidden)
const STATE_MS = 2000;       // how often to poll the match state
const HIDE_AFTER_MISSES = 3;
const BAR_H = 60;            // betting bar height (DIPs)
const CLICK_STREAM_MS = 20000; // how long "clickable stream" mode lasts

// Twitch embeds must be served from a real host; localhost is accepted as "parent".
app.commandLine.appendSwitch('host-resolver-rules', 'MAP localhost 127.0.0.1');

// One SaltyTV at a time: starting it again just opens the window of the one running.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
app.on('second-instance', () => showControl());
// Started with Windows: only the tray icon until you open it.
const startHidden = process.argv.includes('--hidden');
let quitting = false;
app.on('before-quit', () => { quitting = true; });

let videoWin, barWin, control, port;
let lastRect = null, misses = 0, demo = false;
let match = {}, balance = null, myBet = null;
let stats = null, statsKey = '';       // SaltyBoy fighter stats for the current match
let trackedBet = null;                 // your bet this match (from the bar, or spotted on SaltyBet)
let lockedPots = null, resultHandled = false;
let startBalance = null;               // your balance when this match opened, before betting
let deducted = null;                   // does SaltyBet's balance leave out your current bet? (learned from a bet)
let result = null;                     // what your bet did this match: { id, won, amount, side, wager }
let records = null, settings = {}, addOnsDir = null;   // guild leaderboard

const salty = () => session.fromPartition('persist:saltybet');

// ---------- tiny static server for the UI ----------
function startServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const name = path.basename(new URL(req.url, 'http://x').pathname) || 'control.html';
      const file = path.join(__dirname, 'ui', name);
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'text/plain' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
  });
}

// ---------- windows ----------
function createWindows() {
  const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true };
  const overlayOpts = {
    width: 480, height: 270, show: false, frame: false, resizable: false, movable: false,
    skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    // Windows: no drop shadow (it fell on the TV's corner markers), no rounded
    // corners and no fade when shown or hidden, so it looks painted into WoW
    thickFrame: false, roundedCorners: false,
    focusable: false,           // clicks work without stealing focus from WoW
    webPreferences,
  };

  // nodeIntegrationInSubFrames lets preload.js run in the Twitch player frame too (for ad skipping)
  videoWin = new BrowserWindow({
    ...overlayOpts, backgroundColor: '#000000',
    webPreferences: { ...webPreferences, nodeIntegrationInSubFrames: true },
  });
  videoWin.setIgnoreMouseEvents(true); // no { forward: true } -> no global mouse hook
  videoWin.setAlwaysOnTop(true, 'screen-saver');
  videoWin.loadURL(`http://localhost:${port}/video.html`);
  // after a (re)load, tell the page whether the TV is on screen
  videoWin.webContents.on('did-finish-load', () => {
    send(videoWin, 'player', streamActive ? 'show' : 'hide');
  });

  barWin = new BrowserWindow({ ...overlayOpts, height: BAR_H, backgroundColor: '#0c0c10' });
  barWin.setAlwaysOnTop(true, 'screen-saver');
  barWin.loadURL(`http://localhost:${port}/bar.html`);
  barWin.webContents.on('did-finish-load', () => {
    if (lastPlayerState) send(barWin, 'player-state', lastPlayerState);
  });

  control = new BrowserWindow({
    width: 460, height: 760, title: 'SaltyTV', autoHideMenuBar: true, show: !startHidden, webPreferences,
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });
  control.loadURL(`http://localhost:${port}/control.html`);
  control.webContents.on('did-finish-load', () => { pushLeaderboard(); pushSettings(); pushUpdate(); });
  // Closing the window keeps SaltyTV running in the tray (Quit is in the tray menu).
  control.on('close', (e) => {
    if (quitting || !tray) return;
    e.preventDefault();
    control.hide();
    if (!settings.trayHintShown && process.platform === 'win32') {
      settings.trayHintShown = true;
      saveSettings();
      tray.displayBalloon({ title: 'SaltyTV is still running',
        content: 'The stream keeps working in WoW. Right-click this icon to quit.', iconType: 'info' });
    }
  });
  control.on('closed', () => app.quit());

  startTracker(webPreferences);
}

function send(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// Compared with what we asked for last time, not getBounds(): with Windows display
// scaling (125%, 150%) getBounds() can come back a pixel off, which used to make
// the overlay get re-placed for nothing.
const placedBounds = new WeakMap();
function setBoundsIfChanged(win, b) {
  const c = placedBounds.get(win);
  if (c && c.x === b.x && c.y === b.y && c.width === b.width && c.height === b.height) return;
  placedBounds.set(win, { ...b });
  win.setBounds(b);
}

// ---------- placing the overlay ----------
// streamActive = we told the player to play because the TV is on screen. A short
// "hide" (dragging the TV, map open) only hides the windows and keeps the sound.
let streamActive = false;

function placeOverlay(b) {
  const bar = Math.min(BAR_H, Math.floor(b.height / 3));
  setBoundsIfChanged(videoWin, { x: b.x, y: b.y, width: b.width, height: b.height - bar });
  setBoundsIfChanged(barWin, { x: b.x, y: b.y + b.height - bar, width: b.width, height: bar });
  const wasHidden = !videoWin.isVisible();
  if (!videoWin.isVisible()) videoWin.showInactive();
  if (!barWin.isVisible()) barWin.showInactive();
  if (wasHidden) {
    streamActive = true;
    send(videoWin, 'player', 'show'); // start (or keep) the stream playing
  }
}

function hideOverlay({ pause = true } = {}) {
  setClickStream(false);
  if (videoWin.isVisible()) videoWin.hide();
  if (barWin.isVisible()) barWin.hide();
  if (pause && streamActive) {
    streamActive = false;
    send(videoWin, 'player', 'hide'); // the TV is gone: pause until it comes back
  }
}

// "Clickable stream" mode: briefly let clicks reach the Twitch player itself
// (for its own buttons, like a content warning), then go back to click-through.
let clickMode = false, clickTimer = null;
function setClickStream(on) {
  if (on === clickMode) return;
  clickMode = on;
  clearTimeout(clickTimer);
  videoWin.setIgnoreMouseEvents(!on);
  send(videoWin, 'click-stream', on);
  send(barWin, 'click-stream', on);
  if (on) clickTimer = setTimeout(() => setClickStream(false), CLICK_STREAM_MS);
}

// ---------- staying with WoW in the window stack (Windows) ----------
// Instead of floating above every app, the overlay sits right above WoW: when
// WoW becomes the active window we put the overlay back on top of it, and when
// you switch to another app that app simply covers both. (Windows' "owned
// window" link would do this too, but it ties the two programs' input together,
// so a hiccup in one could freeze the other.)
let overlayLayer = 'top';   // 'top' = above everything (fallback, demo); 'follow' = right above WoW
let wowHwnd = null, lastWowCheck = 0, lastForeground = null;
let followBroken = false, lastStackCheck = 0, raiseFails = 0;

function setOverlayLayer(layer) {
  if (layer === overlayLayer) return;
  overlayLayer = layer;
  for (const w of [videoWin, barWin]) {
    if (layer === 'top') w.setAlwaysOnTop(true, 'screen-saver');
    else w.setAlwaysOnTop(false);
  }
  lastForeground = null;
}

function hwndOf(win) {
  if (!win || win.isDestroyed()) return null;
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0);
}

// WoW's window is whatever window is under the TV's corner marker.
function findWowWindow(marker, frameW, d) {
  if (!native.available || !marker) return;
  const now = Date.now();
  if (wowHwnd && now - lastWowCheck < 2000) return;
  lastWowCheck = now;
  const toPhysical = (d.size.width * d.scaleFactor) / frameW;
  const h = Number(native.rootWindowAt((marker.x + 7) * toPhysical, (marker.y + 7) * toPhysical)) || null;
  const ours = [videoWin, barWin, control, tracker].some((w) => h && hwndOf(w) === h);
  if (h && !ours) {
    wowHwnd = h;
    if (!followBroken) setOverlayLayer('follow');
  }
}

// Is the betting bar really the window on top at its own center? (The stream window
// is click-through, so Windows' hit-test skips it; the bar isn't.)
function overlayOnTop() {
  const b = barWin.getBounds();
  const p = screen.dipToScreenPoint({ x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) });
  return (Number(native.rootWindowAt(p.x, p.y)) || null) === hwndOf(barWin);
}

function raiseOverlay() {
  videoWin.moveTop(); // back on top of WoW (without taking focus)
  barWin.moveTop();
}

function followWow() {
  if (overlayLayer !== 'follow' || !wowHwnd || demo || !videoWin.isVisible()) { lastForeground = null; return; }
  const fg = Number(native.getForegroundWindow()) || null;
  const now = Date.now();
  if (fg === wowHwnd && (lastForeground !== wowHwnd || now - lastStackCheck > 1000)) {
    lastStackCheck = now;
    if (lastForeground !== wowHwnd) raiseOverlay();
    // Safety net: if Windows didn't let us go back above WoW, the stream would be
    // hidden behind it. Try again once, then go back to "always on top" for this session.
    if (!overlayOnTop()) {
      raiseOverlay();
      if (!overlayOnTop() && ++raiseFails >= 2) {
        followBroken = true;
        setOverlayLayer('top');
      }
    } else {
      raiseFails = 0;
    }
  }
  lastForeground = fg;
}

// ---------- where the TV is (shared by live tracking and the snapshot fallback) ----------
let tracking = { via: 'snapshots', fps: null, reason: null };

// A move of a pixel or two is never you moving the TV (dragging it hides the
// stream anyway), so the overlay ignores those and stays perfectly still.
const WIGGLE = 2;
let placedRect = null; // the TV (frame pixels) the overlay is sitting on now

function nearlySame(a, b) {
  return Math.abs(a.x - b.x) <= WIGGLE && Math.abs(a.y - b.y) <= WIGGLE &&
    Math.abs(a.x + a.w - b.x - b.w) <= WIGGLE && Math.abs(a.y + a.h - b.y - b.h) <= WIGGLE;
}

function applyFound(rect, frameW, hidden, marker) {
  if (demo) return;
  if (placedRect && placedRect.frameW === frameW && nearlySame(placedRect, rect)) rect = placedRect;
  else placedRect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h, frameW };
  const d = screen.getPrimaryDisplay();
  const k = frameW / d.size.width; // frame pixels per DIP
  // round the edges (not the size), so the right and bottom edges land where they should too
  const left = Math.round(rect.x / k), top = Math.round(rect.y / k);
  const b = {
    x: d.bounds.x + left, y: d.bounds.y + top,
    width: Math.round((rect.x + rect.w) / k) - left, height: Math.round((rect.y + rect.h) / k) - top,
  };
  findWowWindow(marker, frameW, d);
  if (hidden) hideOverlay({ pause: false }); // dragging, map or menu open: hide, keep the sound
  else placeOverlay(b);
  send(control, 'detector', { found: true, rect: b, hidden, via: tracking.via, fps: tracking.fps, reason: tracking.reason });
}

function applyLost() {
  if (demo) return;
  placedRect = null;
  hideOverlay();
  wowHwnd = null;
  setOverlayLayer('top');
  send(control, 'detector', { found: false, via: tracking.via, reason: tracking.reason });
}

// ---------- live tracking: a hidden window watching the screen ~30x a second ----------
let tracker = null, trackerReadyTimer = null;
let lastTrackerRect = null; // the tracker's last 'rect' message (it only sends changes)

async function primaryScreenSource() {
  const d = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  return sources.find((s) => s.display_id === String(d.id)) || sources[0] || null;
}

function startTracker(webPreferences) {
  const ses = session.fromPartition('tracker');
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    primaryScreenSource().then((src) => cb(src ? { video: src } : {})).catch(() => cb({}));
  }, { useSystemPicker: false });
  tracker = new BrowserWindow({
    show: false, width: 320, height: 240, skipTaskbar: true,
    webPreferences: { ...webPreferences, partition: 'tracker', backgroundThrottling: false },
  });
  tracker.loadURL(`http://localhost:${port}/tracker.html`);
  tracker.webContents.on('did-finish-load', async () => {
    const d = screen.getPrimaryDisplay();
    const src = await primaryScreenSource().catch(() => null);
    send(tracker, 'tracker-start', {
      sourceId: src && src.id,
      width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor),
    });
  });
  trackerReadyTimer = setTimeout(() => stopTracker('the screen capture never started'), 10000);
}

function stopTracker(reason) {
  clearTimeout(trackerReadyTimer);
  tracking = { via: 'snapshots', fps: null, reason };
  lastTrackerRect = null;
  const t = tracker;
  tracker = null;
  if (t && !t.isDestroyed()) t.destroy();
}

ipcMain.on('tracker', (e, msg) => {
  if (!tracker || e.sender !== tracker.webContents || !msg) return;
  if (msg.type === 'ready') {
    clearTimeout(trackerReadyTimer);
    tracking = { via: 'live', fps: null, reason: null };
  } else if (msg.type === 'rect') {
    lastTrackerRect = msg;
    applyFound(msg.rect, msg.width, msg.hidden, msg.marker);
  } else if (msg.type === 'lost') {
    lastTrackerRect = null;
    applyLost();
  } else if (msg.type === 'stats') {
    tracking.fps = msg.fps;
  } else if (msg.type === 'error') {
    stopTracker(msg.error); // fall back to snapshots
  }
});

// ---------- snapshot fallback (if live tracking can't start) ----------
let worker, reqId = 0;
const pending = new Map();

function startWorker() {
  worker = new Worker(path.join(__dirname, 'detector-worker.js'));
  worker.on('message', ({ id, rect }) => {
    const done = pending.get(id);
    pending.delete(id);
    if (done) done(rect);
  });
  const restart = () => {
    for (const done of pending.values()) done(null);
    pending.clear();
    setTimeout(startWorker, 1000);
  };
  worker.on('error', restart);
  worker.on('exit', (code) => { if (code !== 0) restart(); });
}

function scanInWorker(bmp, width, height, exclude) {
  return new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    // copy into a fresh ArrayBuffer we can hand to the worker without another copy
    const ab = bmp.buffer.slice(bmp.byteOffset, bmp.byteOffset + bmp.byteLength);
    worker.postMessage({ id, buf: ab, width, height, exclude }, [ab]);
  });
}

async function scan() {
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor;
  const wanted = { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: wanted });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  if (!src) return false;

  const img = src.thumbnail;
  const { width, height } = img.getSize();
  const bmp = img.toBitmap();

  let rect = null, near = null;
  if (lastRect && lastRect.bw === width) {
    // quick look: are the markers still (about) where they were?
    near = lastRect.markers.map((p) => findMarkerNear(bmp, width, height, p.x, p.y)).filter(Boolean);
    if (near.length === lastRect.markers.length) rect = rectFromMarkers(near);
  }
  if (!rect) {
    const exclude = lastRect && { x: lastRect.x, y: lastRect.y, w: lastRect.w, h: lastRect.h };
    rect = await scanInWorker(bmp, width, height, exclude);
  }
  if (!rect) rect = stillInPlace(lastRect, near); // some corners hidden, the rest haven't moved
  if (demo || tracking.via === 'live') return true;

  if (rect) {
    misses = 0;
    rect.bw = width;
    lastRect = rect;
    applyFound(rect, width, rect.hidden, rect.markers[0]);
    return true;
  }
  if (++misses >= HIDE_AFTER_MISSES) {
    lastRect = null;
    applyLost();
    return false;
  }
  return true; // brief miss: keep the overlay where it is for now
}

async function scanLoop() {
  let onScreen = false;
  if (demo || tracking.via === 'live') {
    onScreen = true; // live tracking is doing the work
  } else {
    try {
      onScreen = await scan();
    } catch (e) {
      send(control, 'detector', { found: false, error: String(e) });
    }
  }
  setTimeout(scanLoop, tracking.via === 'live' ? 1000 : onScreen ? SCAN_FOUND_MS : SCAN_IDLE_MS);
}

function setDemo(on) {
  demo = on;
  if (on) {
    setOverlayLayer('top');
    const wa = screen.getPrimaryDisplay().workArea;
    placeOverlay({ x: wa.x + 40, y: wa.y + 40, width: 640, height: 400 });
  } else {
    hideOverlay();
    lastRect = null;
    placedRect = null;
    misses = HIDE_AFTER_MISSES;
    // live tracking only reports changes: put the stream back on the TV it last saw
    if (tracking.via === 'live' && lastTrackerRect) {
      const m = lastTrackerRect;
      applyFound(m.rect, m.width, m.hidden, m.marker);
    }
  }
}

// ---------- SaltyBet ----------
const num = (v) => parseInt(String(v ?? '0').replace(/[^\d]/g, ''), 10) || 0;

async function pollState() {
  try {
    const r = await salty().fetch(`${SALTY}/state.json?t=${Date.now()}`, { cache: 'no-store' });
    const s = await r.json();
    const next = {
      p1name: s.p1name, p2name: s.p2name,
      p1total: num(s.p1total), p2total: num(s.p2total),
      status: String(s.status), remaining: s.remaining || '', alert: s.alert || '',
    };
    const newMatch = next.p1name !== match.p1name || next.p2name !== match.p2name;
    const statusChanged = next.status !== match.status;
    if (newMatch) {
      myBet = null; trackedBet = null; lockedPots = null; resultHandled = false;
      result = null; startBalance = null;
    }
    match = next;
    if (newMatch) loadStats(next.p1name, next.p2name);
    if (next.status === 'locked') {
      lockedPots = { p1: next.p1total, p2: next.p2total };
      if (statusChanged) confirmBet(); // your final bet, as SaltyBet has it (also bets made on the site)
    }
    if ((next.status === '1' || next.status === '2') && !resultHandled) {
      resultHandled = true;
      handleResult(next.status);
    }
    if (statusChanged) refreshBalance();
  } catch (e) {
    match = { ...match, error: 'Could not reach SaltyBet' };
  }
  pushState();
}

async function refreshBalance() {
  try {
    const r = await salty().fetch(`${SALTY}/`, { cache: 'no-store' });
    const html = await r.text();
    const m = html.match(/id=["']balance["'][^>]*>\s*([\d,]+)/);
    balance = m ? num(m[1]) : null;
  } catch {
    balance = null;
  }
  if (balance !== null && match.status === 'open') {
    if (!myBet && startBalance === null) startBalance = balance;
    // right after a bet: did the site take it out of your balance already?
    const d = myBet ? detectDeduction(startBalance, balance, myBet.wager) : null;
    if (d !== null) deducted = d;
  }
  if (records && balance !== null && records.onBalance(balance, matchMode())) scheduleDataWrite();
  pushState();
}

// ---------- guild leaderboard: your numbers ----------
// 'matchmaking', 'tournament', 'exhibition' or 'unknown', plus whether a tournament is next.
function modeInfo() {
  return detectMode(match.remaining, stats && stats.format);
}
function matchMode() {
  return modeInfo().mode;
}

async function fetchZdata() {
  const r = await salty().fetch(`${SALTY}/zdata.json?t=${Date.now()}`, { cache: 'no-store' });
  return r.json();
}

// After your first bet from the bar, find yourself in SaltyBet's bettor list to learn your name.
function learnNameAfterBet(bet) {
  if (!records || records.get().saltyKey) return;
  setTimeout(async () => {
    try {
      const me = findSelfInZdata(await fetchZdata(), bet);
      if (me && records.setSaltyName(me.name, me.key)) scheduleDataWrite();
    } catch { /* try again next bet */ }
  }, 3000);
}

const matchId = () => `${match.p1name}|${match.p2name}`;

// Your bet as SaltyBet has it, from its bettor list (once we know your name). Run when
// bets lock and after you change a bet, so the bar always shows the bet that counts,
// including bets you placed or changed on the SaltyBet site itself.
async function confirmBet() {
  const key = records && records.get().saltyKey;
  if (!key) return;
  const id = matchId();
  try {
    const e = (await fetchZdata())[key];
    if (id !== matchId() || resultHandled) return; // too late, it's another match now
    if (e && (String(e.p) === '1' || String(e.p) === '2') && num(e.w) > 0) {
      myBet = { side: String(e.p) === '1' ? 'player1' : 'player2', wager: num(e.w) };
      trackedBet = myBet;
      pushState();
    }
  } catch { /* keep what we have */ }
}

// The winner is in: what did your bet do? (+ your share of the other pot, or - your wager)
function handleResult(status) {
  const pots = lockedPots || { p1: match.p1total, p2: match.p2total };
  const r = betResult(trackedBet, status, pots);
  if (!r) return;
  result = { id: `${matchId()}|${status}`, ...r, side: trackedBet.side, wager: trackedBet.wager };
  // SaltyBet pays out a moment after the result: look at the balance again shortly
  setTimeout(refreshBalance, 3000);
  setTimeout(refreshBalance, 10000);
  if (records && r.won && records.onWin(r.amount)) scheduleDataWrite();
}

// Writing the SaltyTV_Data addon
const dataStatus = { written: false, needsRestart: false, error: null };
let writeTimer = null;

function scheduleDataWrite(delay = 1500) {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeData, delay);
}

function writeData() {
  const r = records && records.get();
  if (addOnsDir && r && r.balance > 0) {
    try {
      const res = writeDataAddon(ensureDir(addOnsDir), r);
      if (res.created) dataStatus.needsRestart = true;
      dataStatus.written = true;
      dataStatus.error = null;
    } catch (e) {
      dataStatus.error = String((e && e.message) || e);
    }
  }
  pushLeaderboard();
}

function pushLeaderboard() {
  send(control, 'leaderboard', { addOnsDir, ...dataStatus, ...(records ? records.get() : {}), mode: matchMode(), addon: addonStatus });
}

function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* not fatal */ }
}

async function initLeaderboard() {
  addOnsDir = await findAddOnsDir(settings.addOnsDir);
  syncAddon();
  scheduleDataWrite(0);
}

// ---------- the in-game addon (normally from CurseForge; the app fills in if it's missing) ----------
let addonStatus = null; // see addoninstall.js, or { error }

function bundledAddonDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'addon', 'SaltyTV')
    : path.join(__dirname, '..', 'addon', 'SaltyTV');
}

function syncAddon(opts) {
  if (!addOnsDir) { addonStatus = null; return; }
  try {
    addonStatus = installAddon(bundledAddonDir(), addOnsDir, opts);
  } catch (e) {
    addonStatus = { error: String((e && e.message) || e) };
  }
}
// "Update it for me": replace an older CurseForge/hand-copied addon with the app's copy
ipcMain.on('update-addon', () => { syncAddon({ force: true }); pushLeaderboard(); });

// ---------- optional ad skipping (TwitchAdSolutions' vaft, off by default) ----------
let vaftCode = null;
function readVaft() {
  if (vaftCode === null) {
    try { vaftCode = fs.readFileSync(path.join(__dirname, 'vendor', 'vaft.user.js'), 'utf8'); } catch { vaftCode = ''; }
  }
  return vaftCode;
}

// Asked by preload.js from inside the Twitch player frame, before Twitch's own scripts run.
ipcMain.on('adblock-script', (e) => {
  e.returnValue = settings.adblock && videoWin && e.sender === videoWin.webContents ? readVaft() : '';
});

ipcMain.on('set-adblock', (_e, on) => {
  settings.adblock = !!on;
  saveSettings();
  pushSettings();
  if (videoWin && !videoWin.isDestroyed()) videoWin.webContents.reload(); // restart the player with/without it
});

function pushSettings() {
  send(control, 'settings', {
    adblock: !!settings.adblock,
    adblockAvailable: !!readVaft(), // the public installer doesn't include the script
    startWithWindows: startsWithWindows(),
    canStartWithWindows: app.isPackaged && process.platform === 'win32',
    version: require('./package.json').version + (personal ? ' personal' : ''),
  });
}

// ---------- tray icon and starting with Windows ----------
let tray = null;

function showControl() {
  if (!control || control.isDestroyed()) return;
  if (control.isMinimized()) control.restore();
  control.show();
  control.focus();
}

function startsWithWindows() {
  return app.isPackaged && process.platform === 'win32' && app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin;
}

function setStartWithWindows(on) {
  if (!app.isPackaged || process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: !!on, args: ['--hidden'] });
  pushSettings();
  updateTrayMenu();
}
ipcMain.on('start-with-windows', (_e, on) => setStartWithWindows(on));

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png')));
  } catch {
    tray = null; // no tray on this system: closing the window quits instead
    return;
  }
  tray.setToolTip('SaltyTV');
  tray.on('click', showControl);
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const items = [{ label: 'Open SaltyTV', click: showControl }];
  if (app.isPackaged && process.platform === 'win32') {
    items.push({ label: 'Start with Windows', type: 'checkbox', checked: startsWithWindows(),
      click: (item) => setStartWithWindows(item.checked) });
  }
  if (update.status === 'ready') items.push({ label: `Restart to update (v${update.version})`, click: installUpdate });
  items.push({ type: 'separator' }, { label: 'Quit SaltyTV', click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---------- updates (from GitHub Releases; only in the installed app) ----------
let update = { status: 'idle' };

function setUpdate(u) {
  update = u;
  pushUpdate();
  updateTrayMenu();
}
function pushUpdate() { send(control, 'update', update); }

// The personal build (with ad skipping) only says when a new version is out: installing
// the public release over it would remove the ad skipping.
const PKG = require('./package.json');
const personal = PKG.saltytvEdition === 'personal';

function checkPersonalUpdate() {
  const repo = PKG.saltytvRepo;
  net.fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`GitHub said ${r.status}`))))
    .then((rel) => {
      const latest = String(rel.tag_name || '').replace(/^v/, '');
      if (latest && compareVersions(latest, PKG.version) > 0) setUpdate({ status: 'personal-new', version: latest });
      else setUpdate({ status: 'current' });
    })
    .catch((e) => setUpdate({ status: 'error', message: String((e && e.message) || e) }));
}

function initUpdates() {
  if (!app.isPackaged) return setUpdate({ status: 'source' });
  if (personal) {
    setTimeout(checkPersonalUpdate, 5000);
    setInterval(checkPersonalUpdate, 6 * 60 * 60 * 1000);
    return;
  }
  if (!autoUpdater) return setUpdate({ status: 'source' });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // a downloaded update installs next time you quit anyway
  autoUpdater.on('checking-for-update', () => { if (update.status !== 'ready') setUpdate({ status: 'checking' }); });
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'current' }));
  autoUpdater.on('update-available', (i) => setUpdate({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => setUpdate({ ...update, status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => setUpdate({ status: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => { if (update.status !== 'ready') setUpdate({ status: 'error', message: String((e && e.message) || e) }); });
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* reported through 'error' */ });
  setTimeout(check, 5000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

function installUpdate() {
  if (update.status !== 'ready' || !autoUpdater) return;
  quitting = true;
  autoUpdater.quitAndInstall(true, true); // quiet install, then start SaltyTV again
}
ipcMain.on('install-update', installUpdate);
ipcMain.on('check-update', () => {
  if (!app.isPackaged) return;
  if (personal) checkPersonalUpdate();
  else if (autoUpdater) autoUpdater.checkForUpdates().catch(() => {});
});

ipcMain.on('choose-wow-folder', async () => {
  const res = await dialog.showOpenDialog(control, {
    title: 'Select your World of Warcraft folder', properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return;
  const dir = addOnsDirFrom(res.filePaths[0]);
  if (!dir) {
    dataStatus.error = "That folder doesn't have WoW Forever in it (no _forever_ folder).";
    return pushLeaderboard();
  }
  addOnsDir = dir;
  settings.addOnsDir = res.filePaths[0];
  saveSettings();
  dataStatus.error = null;
  syncAddon();
  scheduleDataWrite(0);
});

// ---------- SaltyBoy stats (win rates, tier) ----------
function loadStats(p1, p2) {
  if (!p1 || !p2) { stats = null; statsKey = ''; return; }
  const key = `${p1}|${p2}`;
  statsKey = key;
  stats = { loading: true };
  fetchMatchStats((url) => net.fetch(url), p1, p2, { isCurrent: () => statsKey === key })
    .then((s) => {
      if (statsKey !== key || !s) return; // a newer match started meanwhile
      stats = s;
      pushState();
    });
}

function pushState() {
  const { mode, next } = modeInfo();
  const state = { ...match, balance, loggedIn: balance !== null, myBet, stats, mode, nextMode: next,
    available: availableToBet(balance, myBet, deducted), result };
  send(barWin, 'state', state);
  send(control, 'state', state);
  if (mode !== lastPushedMode) { lastPushedMode = mode; pushLeaderboard(); }
}
let lastPushedMode = null;

ipcMain.handle('bet', async (_e, { side, wager }) => {
  if (side !== 'player1' && side !== 'player2') return { ok: false, msg: 'Bad side' };
  wager = Math.floor(Number(wager));
  if (!(wager > 0)) return { ok: false, msg: 'Pick a wager' };
  if (match.status !== 'open') return { ok: false, msg: 'Betting is closed' };
  // Like on the site, you can change your bet (side or amount) until bets lock:
  // a new bet replaces the old one.
  const before = myBet;
  if (before && before.side === side && before.wager === wager) return { ok: true, same: true };
  const id = matchId();
  try {
    const body = new URLSearchParams({ selectedplayer: side, wager: String(wager) }).toString();
    const r = await salty().fetch(`${SALTY}/ajax_place_bet.php`, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!r.ok) return { ok: false, msg: `SaltyBet said ${r.status}` };
    if (id !== matchId()) return { ok: false, msg: 'Too late, a new match started' };
    myBet = { side, wager };
    trackedBet = myBet;
    learnNameAfterBet({ side, wager, balanceBefore: startBalance ?? balance });
    if (before) setTimeout(confirmBet, 1500); // check SaltyBet has the new one
    refreshBalance();
    pushState();
    return { ok: true, changed: !!before, switched: !!before && before.side !== side };
  } catch (e) {
    return { ok: false, msg: String(e) };
  }
});

// ---------- typing a bet amount ----------
// The bar normally can't take the keyboard (so your WoW keybinds keep working).
// While you type in the $ box it can; afterwards focus goes straight back to WoW.
let typing = false, focusBefore = null;
ipcMain.on('kbd', (_e, msg) => {
  if (msg === 'capture' && !typing) {
    typing = true;
    focusBefore = native.getForegroundWindow(); // WoW, normally
    barWin.setFocusable(true);
    barWin.focus();
    barWin.webContents.focus();
    send(barWin, 'kbd', 'ready');
  } else if ((msg === 'release' || msg === 'release-keep') && typing) {
    typing = false;
    // 'release' = Enter/Esc/bet: give focus back. 'release-keep' = you already clicked elsewhere.
    if (msg === 'release' && !native.setForegroundWindow(focusBefore)) barWin.blur();
    barWin.setFocusable(false);
    focusBefore = null;
  }
});

// stream controls from the betting bar
ipcMain.on('player', (_e, cmd) => {
  if (cmd === 'toggle-play' || cmd === 'toggle-mute') send(videoWin, 'player', cmd);
});
let lastPlayerState = null;
ipcMain.on('player-state', (_e, s) => { lastPlayerState = s; send(barWin, 'player-state', s); });
ipcMain.on('click-stream', (_e, on) => setClickStream(!!on && videoWin.isVisible()));
ipcMain.on('reload-player', () => videoWin.webContents.reload());

ipcMain.on('login', () => {
  const win = new BrowserWindow({
    width: 900, height: 760, title: 'Log in to SaltyBet', autoHideMenuBar: true,
    webPreferences: { partition: 'persist:saltybet' },
  });
  win.loadURL(`${SALTY}/authenticate?signin=1`);
  win.webContents.on('did-navigate', (_e, url) => {
    if (url.replace(/\/$/, '') === SALTY) { win.close(); refreshBalance(); }
  });
});

ipcMain.on('logout', async () => {
  await salty().clearStorageData();
  balance = null;
  pushState();
});

ipcMain.on('demo', (_e, on) => setDemo(!!on));

// ---------- start ----------
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  port = await startServer();
  settings = loadSettings();
  records = new Records(path.join(app.getPath('userData'), 'records.json'));
  startWorker();
  createWindows();
  createTray();
  initUpdates();
  scanLoop();
  if (native.available) setInterval(followWow, 100);
  setInterval(pollState, STATE_MS);
  pollState();
  refreshBalance();
  initLeaderboard();
});

app.on('window-all-closed', () => app.quit());
