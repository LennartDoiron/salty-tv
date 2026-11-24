// Draws fake screenshots and checks the detector finds the in-game screen,
// including the color bleeding of compressed (I420/NV12) screen-capture video.
const assert = require('assert');
const path = require('path');
const { Worker } = require('worker_threads');
const D = require('../detector');
const { MARKER, CENTER, BEZEL, findScreenRect, findMarkersIn, rectFromMarkers, markerAt, isMarkerAt } = D;

const GREEN = [0, 255, 0], YELLOW = [255, 255, 0], MAGENTA = [255, 0, 255];

function makeImage(w, h, seed = 1) {
  const buf = Buffer.alloc(w * h * 4);
  let s = seed;
  for (let i = 0; i < buf.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    buf[i] = s & 255; buf[i + 1] = (s >> 8) & 255; buf[i + 2] = (s >> 16) & 255; buf[i + 3] = 255;
  }
  return buf;
}

// coverage-based blending, to simulate a marker that isn't aligned to the pixel grid
function fillRect(buf, w, x0, y0, size, rgb) {
  for (let y = Math.floor(y0); y < Math.ceil(y0 + size); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + size); x++) {
      const cx = Math.min(x + 1, x0 + size) - Math.max(x, x0);
      const cy = Math.min(y + 1, y0 + size) - Math.max(y, y0);
      const a = Math.max(0, cx) * Math.max(0, cy);
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) buf[i + c] = Math.round(buf[i + c] * (1 - a) + rgb[c] * a);
    }
  }
}

function fillRectRaw(buf, w, x0, y0, rw, rh, rgb) {
  for (let y = y0; y < y0 + rh; y++)
    for (let x = x0; x < x0 + rw; x++) {
      const i = (y * w + x) * 4;
      buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2];
    }
}

/** The addon's TV screen: black, with a marker in each corner. centers = one color or four. */
function drawScreen(buf, w, x, y, sw, sh, centers = GREEN) {
  fillRectRaw(buf, w, Math.round(x), Math.round(y), Math.round(sw), Math.round(sh), [0, 0, 0]);
  const list = Array.isArray(centers[0]) ? centers : [centers, centers, centers, centers];
  const inset = (MARKER - CENTER) / 2;
  [[x, y], [x + sw - MARKER, y], [x, y + sh - MARKER], [x + sw - MARKER, y + sh - MARKER]].forEach(([mx, my], k) => {
    fillRect(buf, w, mx, my, MARKER, MAGENTA);
    fillRect(buf, w, mx + inset, my + inset, CENTER, list[k]);
  });
}

/**
 * What screen-capture video does to colors: full-resolution brightness, color shared per 2x2 block.
 * bilinear = color smoothed between blocks when turned back into RGB (GPU conversion), so it
 * reaches up to 2px into a neighbour instead of 1.
 */
function chroma420(buf, w, h, bilinear = false) {
  if (bilinear) return chroma420Bilinear(buf, w, h);
  const Y = new Float32Array(w * h), Cb = new Float32Array(w * h), Cr = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const r = buf[p * 4], g = buf[p * 4 + 1], b = buf[p * 4 + 2];
    Y[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[p] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[p] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  for (let by = 0; by < h - 1; by += 2) {
    for (let bx = 0; bx < w - 1; bx += 2) {
      const ps = [by * w + bx, by * w + bx + 1, (by + 1) * w + bx, (by + 1) * w + bx + 1];
      const cb = ps.reduce((s, p) => s + Cb[p], 0) / 4, cr = ps.reduce((s, p) => s + Cr[p], 0) / 4;
      for (const p of ps) {
        const r = Y[p] + 1.402 * (cr - 128);
        const g = Y[p] - 0.344136 * (cb - 128) - 0.714136 * (cr - 128);
        const b = Y[p] + 1.772 * (cb - 128);
        buf[p * 4] = Math.max(0, Math.min(255, Math.round(r)));
        buf[p * 4 + 1] = Math.max(0, Math.min(255, Math.round(g)));
        buf[p * 4 + 2] = Math.max(0, Math.min(255, Math.round(b)));
      }
    }
  }
  return buf;
}

function chroma420Bilinear(buf, w, h) {
  const n = w * h, Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const r = buf[p * 4], g = buf[p * 4 + 1], b = buf[p * 4 + 2];
    Y[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[p] = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[p] = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const cw = w >> 1, ch = h >> 1, sb = new Float32Array(cw * ch), sr = new Float32Array(cw * ch);
  for (let by = 0; by < ch; by++) {
    for (let bx = 0; bx < cw; bx++) {
      const ps = [2 * by * w + 2 * bx, 2 * by * w + 2 * bx + 1, (2 * by + 1) * w + 2 * bx, (2 * by + 1) * w + 2 * bx + 1];
      sb[by * cw + bx] = ps.reduce((s, p) => s + Cb[p], 0) / 4;
      sr[by * cw + bx] = ps.reduce((s, p) => s + Cr[p], 0) / 4;
    }
  }
  const at = (a, x, y) => a[Math.max(0, Math.min(ch - 1, y)) * cw + Math.max(0, Math.min(cw - 1, x))];
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x - 0.5) / 2, fy = (y - 0.5) / 2, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
      const bl = (a) => (at(a, x0, y0) * (1 - ax) + at(a, x0 + 1, y0) * ax) * (1 - ay) + (at(a, x0, y0 + 1) * (1 - ax) + at(a, x0 + 1, y0 + 1) * ax) * ay;
      const cb = bl(sb), cr = bl(sr), p = y * w + x;
      buf[p * 4] = cl(Y[p] + 1.402 * (cr - 128));
      buf[p * 4 + 1] = cl(Y[p] - 0.344136 * (cb - 128) - 0.714136 * (cr - 128));
      buf[p * 4 + 2] = cl(Y[p] + 1.772 * (cb - 128));
    }
  }
  return buf;
}

const W = 1280, H = 720;
const expected = (x, y, sw, sh) => [x + BEZEL, y + BEZEL, sw - 2 * BEZEL, sh - 2 * BEZEL];
const rectOf = (r) => [r.x, r.y, r.w, r.h];
const near = (r, want, tol) => r && rectOf(r).every((v, i) => Math.abs(v - want[i]) <= tol);

(async () => {
  // 1. clean screenshot (the old snapshot path)
  {
    const img = makeImage(W, H);
    drawScreen(img, W, 200, 150, 640, 360);
    const r = findScreenRect(img, W, H);
    assert(r, 'should find screen');
    assert.deepStrictEqual(rectOf(r), expected(200, 150, 640, 360));
    assert.strictEqual(r.markers.length, 4);
    assert.strictEqual(r.hidden, false);
    console.log('ok  clean screenshot', rectOf(r));
  }

  // 2. TV not on the pixel grid (UI scale)
  {
    const img = makeImage(W, H, 7);
    drawScreen(img, W, 300.5, 100.5, 500, 300);
    const r = findScreenRect(img, W, H);
    assert(near(r, expected(300.5, 100.5, 500, 300), 1.5), 'half-pixel: within 1-2px');
    console.log('ok  half-pixel markers', rectOf(r));
  }

  // 3. compressed video colors, at every odd/even position, on noisy and dark backgrounds
  {
    let n = 0;
    for (const [x, y] of [[200, 150], [201, 150], [200, 151], [201, 151], [333, 97], [444.5, 222.5]]) {
      for (const seed of [11, 12]) {
        const img = makeImage(W, H, seed);
        if (seed === 12) fillRectRaw(img, W, 0, 0, W, H, [20, 22, 30]); // dark WoW scene
        drawScreen(img, W, x, y, 520, 300);
        chroma420(img, W, H);
        const r = findScreenRect(img, W, H);
        const tol = Number.isInteger(x) && Number.isInteger(y) ? 0 : 1.5; // exact unless the TV is between pixels
        assert(near(r, expected(x, y, 520, 300), tol), `compressed video at ${x},${y} seed ${seed}: ${r && rectOf(r)}`);
        assert.strictEqual(r.markers.length, 4, `all 4 markers at ${x},${y}`);
        n++;
      }
    }
    console.log(`ok  compressed-video color bleeding: found the TV exactly in all ${n} cases (odd/even positions)`);
  }

  // 4. yellow centers = "hide the stream" (dragging, map open), also through compressed video
  {
    for (const compressed of [false, true]) {
      const img = makeImage(W, H, 21);
      drawScreen(img, W, 201, 151, 600, 340, YELLOW);
      if (compressed) chroma420(img, W, H);
      const r = findScreenRect(img, W, H);
      assert(r && r.hidden === true && r.markers.every((m) => m.state === 'hide'), `yellow -> hidden (compressed=${compressed})`);
    }
    const mixed = makeImage(W, H, 22);
    drawScreen(mixed, W, 200, 150, 600, 340, [YELLOW, YELLOW, YELLOW, GREEN]);
    assert.strictEqual(findScreenRect(mixed, W, H).hidden, true, 'most markers yellow -> hidden');
    const half = makeImage(W, H, 23);
    drawScreen(half, W, 200, 150, 600, 340, [YELLOW, GREEN, YELLOW, GREEN]);
    assert.strictEqual(findScreenRect(half, W, H).hidden, false, 'a tie keeps it showing');
    console.log('ok  yellow centers ask for the stream to be hidden');
  }

  // 5. one corner covered (bag window, tooltip, mouse cursor)
  {
    const img = makeImage(W, H, 13);
    drawScreen(img, W, 200, 150, 640, 360);
    fillRectRaw(img, W, 180, 130, 60, 60, [40, 40, 40]);
    const r = findScreenRect(img, W, H);
    assert.deepStrictEqual(rectOf(r), expected(200, 150, 640, 360));
    assert.strictEqual(r.markers.length, 3);
    console.log('ok  one covered corner', rectOf(r));
  }

  // 6. things that aren't markers
  {
    const img = makeImage(W, H, 3);
    fillRectRaw(img, W, 100, 100, 60, 60, MAGENTA);
    fillRectRaw(img, W, 900, 500, 30, 30, MAGENTA);
    fillRectRaw(img, W, 600, 300, 14, 14, MAGENTA);
    fillRectRaw(img, W, 604, 304, 6, 6, [0, 0, 255]); // blue center: not ours
    assert.strictEqual(findScreenRect(img, W, H), null);
    assert.strictEqual(findScreenRect(makeImage(W, H, 9), W, H), null);
    const ex = makeImage(W, H, 11);
    drawScreen(ex, W, 200, 150, 640, 360);
    assert.strictEqual(findScreenRect(ex, W, H, { x: 0, y: 0, w: W, h: H }), null);
    console.log('ok  magenta blobs, wrong centers, empty screens and our own overlay are ignored');
  }

  // 7. checking known spots: unchanged passes, a 1px move fails
  {
    const img = makeImage(W, H, 21);
    drawScreen(img, W, 200, 150, 640, 360);
    const r = findScreenRect(img, W, H);
    assert(r.markers.every((p) => isMarkerAt(img, W, H, p.x, p.y)));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const moved = makeImage(W, H, 21);
      drawScreen(moved, W, 200 + dx, 150 + dy, 640, 360);
      assert(!r.markers.every((p) => isMarkerAt(moved, W, H, p.x, p.y)), `1px move ${dx},${dy}`);
    }
    console.log('ok  known-position check notices 1px moves');
  }

  // 8. local search: small patches around the last marker positions (what the tracker does each frame)
  {
    const img = chroma420(drawScreenInto(makeImage(W, H, 31), 413, 207, 480, 300), W, H);
    const last = [{ x: 400, y: 200 }, { x: 400 + 480 - MARKER, y: 200 }, { x: 400, y: 200 + 300 - MARKER }, { x: 400 + 480 - MARKER, y: 200 + 300 - MARKER }];
    const R = 64, S = 2 * R + MARKER;
    const found = [];
    for (const m of last) {
      const x0 = m.x - R, y0 = m.y - R;
      const patch = Buffer.alloc(S * S * 4);
      for (let y = 0; y < S; y++) img.copy(patch, y * S * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + S) * 4);
      const hits = findMarkersIn(patch, S, S) || [];
      const best = hits.map((h) => ({ ...h, x: h.x + x0, y: h.y + y0 }))
        .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
      if (best) found.push(best);
    }
    const r = rectFromMarkers(found);
    assert(near(r, expected(413, 207, 480, 300), 0), `local search follows a 13,7 px move: ${r && rectOf(r)}`);
    console.log('ok  local search around the last positions follows the TV', rectOf(r));
  }

  // 9a. the game world right next to the TV keeps changing (camera turning, spell effects).
  // Its colors bleed 1-2px into the outer edge of the markers; the TV must not budge.
  {
    const worlds = [[30, 60, 30], [200, 200, 200], [255, 255, 255], [160, 60, 200], [220, 80, 220], [255, 120, 255],
      [60, 200, 60], [20, 20, 80], [250, 200, 40], [120, 0, 160], [180, 0, 255], [0, 0, 0]];
    let n = 0, pink = 0;
    for (const bilinear of [false, true]) {
      for (const [x, y] of [[200, 150], [201, 150], [200, 151], [201, 151]]) {
        for (const centers of [GREEN, YELLOW]) {
          for (const world of [...worlds, 'noise']) {
            const img = world === 'noise' ? makeImage(W, H, 40 + n) : Buffer.alloc(W * H * 4);
            if (world !== 'noise') fillRectRaw(img, W, 0, 0, W, H, world);
            fillRectRaw(img, W, x, y - 18, 520, 18, [20, 20, 25]); // the TV's header
            drawScreen(img, W, x, y, 520, 300, centers);
            chroma420(img, W, H, bilinear);
            const r = findScreenRect(img, W, H);
            const label = `world ${world} next to the TV at ${x},${y} (bilinear ${bilinear})`;
            if (r) {
              assert(near(r, expected(x, y, 520, 300), 0), `${label} -> ${rectOf(r)}`);
            } else {
              // only a world as pink as the markers themselves hides the left corners; the right
              // ones are still found exactly where they were, so the tracker keeps the TV in place
              assert(Array.isArray(world) && world[0] > 190 && world[2] > 190 && world[1] < 100, `${label} -> not found`);
              const corners = [[x, y], [x + 520 - MARKER, y], [x, y + 300 - MARKER], [x + 520 - MARKER, y + 300 - MARKER]];
              const last = { markers: corners.map(([mx, my]) => ({ x: mx, y: my })) };
              assert(D.stillInPlace(last, findMarkersIn(img, W, H)), `${label}: kept in place`);
              pink++;
            }
            n++;
          }
        }
      }
    }
    console.log(`ok  the game world next to the TV never moves it (${n} worlds, positions and color modes; ${pink} marker-pink ones kept in place)`);
  }

  // 9b. findMarkerNear (the snapshot path's quick look from the last corner): exact corner, even 1px off
  {
    const img = chroma420(drawScreenInto(makeImage(W, H, 51), 301, 211, 480, 300), W, H, true);
    for (const [cx, cy] of [[301, 211], [301 + 480 - MARKER, 211], [301, 211 + 300 - MARKER]]) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) {
        const p = D.findMarkerNear(img, W, H, cx + dx, cy + dy);
        assert(p && p.x === cx && p.y === cy && p.state === 'show', `near ${cx + dx},${cy + dy} -> ${p && [p.x, p.y]}`);
      }
      assert.strictEqual(D.findMarkerNear(img, W, H, cx + 5, cy), null, '5px away is not "near"');
    }
    console.log('ok  findMarkerNear gives the exact corner (also from 1px off); 5px away is a move');
  }

  // 9c. stillInPlace: two corners can't be seen, the two we see haven't moved -> keep the TV
  {
    const last = { x: 18, y: 18, w: 400, h: 300, markers: [{ x: 0, y: 0 }, { x: 422, y: 0 }, { x: 0, y: 322 }, { x: 422, y: 322 }] };
    const right = [{ x: 422, y: 0, state: 'show' }, { x: 422, y: 322, state: 'show' }];
    const kept = D.stillInPlace(last, right);
    assert(kept && kept.x === 18 && kept.w === 400 && kept.hidden === false && kept.markers === last.markers);
    assert.strictEqual(D.stillInPlace(last, right.map((p) => ({ ...p, state: 'hide' }))).hidden, true, 'their state still counts');
    assert.strictEqual(D.stillInPlace(last, right.slice(0, 1)), null, 'one corner is not enough');
    assert.strictEqual(D.stillInPlace(last, right.map((p) => ({ ...p, x: p.x + 3 }))), null, 'moved corners are not "in place"');
    assert.strictEqual(D.stillInPlace(null, right), null);
    console.log('ok  stillInPlace keeps a TV whose visible corners have not moved');
  }

  // 9. the Node worker thread (old snapshot path) still works
  {
    const img = makeImage(W, H, 31);
    drawScreen(img, W, 400, 200, 480, 300);
    const worker = new Worker(path.join(__dirname, '..', 'detector-worker.js'));
    const ab = img.buffer.slice(img.byteOffset, img.byteOffset + img.byteLength);
    const r = await new Promise((resolve, reject) => {
      worker.once('message', ({ rect }) => resolve(rect));
      worker.once('error', reject);
      worker.postMessage({ id: 1, buf: ab, width: W, height: H, exclude: null }, [ab]);
    });
    await worker.terminate();
    assert.deepStrictEqual(rectOf(r), expected(400, 200, 480, 300));
    console.log('ok  worker thread scan', rectOf(r));
  }

  // 10. timing on a 2560x1440 frame
  {
    const w = 2560, h = 1440;
    const img = makeImage(w, h, 5);
    drawScreen(img, w, 1200, 700, 800, 450);
    let t = process.hrtime.bigint();
    assert(findScreenRect(img, w, h));
    const full = Number(process.hrtime.bigint() - t) / 1e6;
    console.log(`ok  1440p full scan ${full.toFixed(1)} ms`);
  }

  console.log('all detector tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

function drawScreenInto(buf, x, y, sw, sh) { drawScreen(buf, W, x, y, sw, sh); return buf; }
