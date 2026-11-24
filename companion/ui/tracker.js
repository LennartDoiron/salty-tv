// Live tracking of the in-game TV (runs in a hidden window).
//
// Keeps one screen-capture stream open and looks at up to ~30 frames a second.
// Normally it only reads four small patches around where the markers were last
// seen, which takes a couple of milliseconds. If the TV jumps further than that,
// or isn't on screen, it scans the whole frame instead (at most every 0.4s while
// nothing is found). It tells the app whenever the TV moves, resizes, asks to be
// hidden (yellow marker centers) or disappears. Marker positions are measured
// from their centers (detector.js), so what the game shows right next to the TV
// can't make the stream wiggle.

const D = window.SaltyDetector;
const FPS = 30;
const R = 64;                 // how far (px) a marker may move between two frames and still be followed
const IDLE_SCAN_MS = 400;     // full scans while the TV isn't on screen
const LOST_AFTER = 3;         // frames without the TV before we say it's gone

const S = 2 * R + D.MARKER;
const patch = new OffscreenCanvas(S, S);
const pctx = patch.getContext('2d', { willReadFrequently: true });
let full = null, fctx = null;

let reader = null;
let markers = null;           // last seen markers, in frame pixels
let lastRect = null;
let partial = false;          // keeping the TV from only some of its corners (see stillInPlace)
let misses = 0, lastFull = -Infinity, lastFrameAt = 0;
const stats = { frames: 0, localMs: 0, fullScans: 0, since: performance.now() };

const send = (msg) => salty.send('tracker', msg);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

salty.on('tracker-start', (cfg) => {
  start(cfg).catch((e) => send({ type: 'error', error: String((e && e.message) || e) }));
});

async function start({ sourceId, width, height }) {
  let stream, mode;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: FPS, width, height } });
    mode = 'getDisplayMedia';
  } catch {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId,
        minWidth: width, maxWidth: width, minHeight: height, maxHeight: height, maxFrameRate: FPS } },
    });
    mode = 'getUserMedia';
  }
  if (typeof MediaStreamTrackProcessor === 'undefined') throw new Error('MediaStreamTrackProcessor is not available');
  const track = stream.getVideoTracks()[0];
  reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  send({ type: 'ready', mode, settings: track.getSettings() });
  loop();
}

async function loop() {
  for (;;) {
    let r;
    try { r = await reader.read(); } catch (e) { send({ type: 'error', error: String(e) }); return; }
    if (r.done) { send({ type: 'error', error: 'screen capture stopped' }); return; }
    const frame = r.value;
    const now = performance.now();
    if (now - lastFrameAt < 1000 / FPS - 4) { frame.close(); continue; } // keep it to ~30 fps
    lastFrameAt = now;
    try { handleFrame(frame, now); } catch { /* one bad frame shouldn't stop tracking */ } finally { frame.close(); }
    if (now - stats.since > 5000) {
      send({ type: 'stats', fps: Math.round(stats.frames * 1000 / (now - stats.since)),
        localMs: stats.frames ? +(stats.localMs / stats.frames).toFixed(2) : 0, fullScans: stats.fullScans });
      Object.assign(stats, { frames: 0, localMs: 0, fullScans: 0, since: now });
    }
  }
}

function handleFrame(frame, now) {
  const W = frame.displayWidth, H = frame.displayHeight;
  stats.frames++;
  let rect = null, near = null;
  if (markers) {
    const t = performance.now();
    near = localSearch(frame, W, H);
    rect = D.rectFromMarkers(near);
    stats.localMs += performance.now() - t;
  }
  // lost track of a known TV: look everywhere right away; otherwise every 0.4s
  if (!rect && now - lastFull >= (markers && !partial ? 0 : IDLE_SCAN_MS)) {
    lastFull = now;
    stats.fullScans++;
    rect = fullScan(frame, W, H);
  }
  // some corners can't be seen, but the ones we can see haven't moved
  partial = false;
  if (!rect && (rect = D.stillInPlace(lastRect, near))) partial = true;

  if (rect) {
    misses = 0;
    markers = rect.markers;
    const moved = !lastRect || rect.x !== lastRect.x || rect.y !== lastRect.y || rect.w !== lastRect.w ||
      rect.h !== lastRect.h || rect.hidden !== lastRect.hidden;
    lastRect = rect;
    if (moved) {
      send({ type: 'rect', rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, hidden: rect.hidden,
        marker: { x: rect.markers[0].x, y: rect.markers[0].y }, width: W, height: H });
    }
  } else if (markers || lastRect) {
    if (++misses >= LOST_AFTER) {
      markers = null;
      lastRect = null;
      partial = false;
      send({ type: 'lost' });
    }
  }
}

// Read a small patch around each last-known marker and find it again.
function localSearch(frame, W, H) {
  const found = [];
  for (const m of markers) {
    const x0 = clamp(m.x - R, 0, Math.max(0, W - S)), y0 = clamp(m.y - R, 0, Math.max(0, H - S));
    pctx.clearRect(0, 0, S, S);
    pctx.drawImage(frame, x0, y0, S, S, 0, 0, S, S);
    const hits = D.findMarkersIn(pctx.getImageData(0, 0, S, S).data, S, S) || [];
    let best = null, bestDist = Infinity;
    for (const h of hits) {
      const x = h.x + x0, y = h.y + y0, d = Math.abs(x - m.x) + Math.abs(y - m.y);
      if (d < bestDist) { bestDist = d; best = { x, y, state: h.state }; }
    }
    if (best && !found.some((f) => Math.abs(f.x - best.x) < D.MARKER && Math.abs(f.y - best.y) < D.MARKER)) found.push(best);
  }
  return found;
}

function fullScan(frame, W, H) {
  if (!full || full.width !== W || full.height !== H) {
    full = new OffscreenCanvas(W, H);
    fctx = full.getContext('2d', { willReadFrequently: true });
  }
  fctx.drawImage(frame, 0, 0);
  const exclude = lastRect && { x: lastRect.x, y: lastRect.y, w: lastRect.w, h: lastRect.h }; // our own overlay
  return D.findScreenRect(fctx.getImageData(0, 0, W, H).data, W, H, exclude);
}
