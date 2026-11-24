// Finds the SaltyTV addon's corner markers in screen pixels. Shared by the app
// (Node) and the tracker page (browser).
//
// A marker is a 14x14 magenta square with a 6x6 center (physical pixels). The
// center is green normally and yellow when the addon wants the stream hidden
// (you're dragging the TV, or the map / game menu is open). The 4px stripes
// survive the slight color bleeding of compressed screen-capture video, and
// positions are measured from the center (see refineMarker), so whatever the
// game shows right next to the TV can't nudge them.
// Magenta, green and yellow read the same in RGBA and BGRA.
//
// Must match MARKER / CENTER / BEZEL in addon/SaltyTV/SaltyTV.lua.
(function (root) {
  const MARKER = 14;
  const CENTER = 6;
  const BEZEL = 18;

  function isMagenta(b, i) {
    return b[i] > 190 && b[i + 1] < 80 && b[i + 2] > 190;
  }

  // green center = 'show', yellow center = 'hide'
  function centerState(b, i) {
    const r = b[i], g = b[i + 1], bl = b[i + 2];
    if (g < 180 || bl > 80) return null;
    if (r < 80) return 'show';
    if (r > 180) return 'hide';
    return null;
  }

  /**
   * If a marker's top-left corner is at (x, y), returns its state ('show' | 'hide'), else null.
   * Samples stay away from the stripe edges, so a 1px shift from color bleeding is fine.
   */
  function markerAt(buf, width, height, x, y) {
    if (x < 1 || y < 1 || x + MARKER >= width || y + MARKER >= height) return null;
    const at = (px, py) => (py * width + px) * 4;
    if (!isMagenta(buf, at(x, y)) || isMagenta(buf, at(x - 1, y)) || isMagenta(buf, at(x, y - 1))) return null;
    // each stripe is checked at two neighbouring spots; either may be the clean one
    const m = (ax, ay, bx, by) => isMagenta(buf, at(ax, ay)) || isMagenta(buf, at(bx, by));
    if (!m(x + 1, y + 1, x + 2, y + 2) || !m(x + 11, y + 7, x + 12, y + 7) ||
        !m(x + 7, y + 11, x + 7, y + 12) || !m(x + 11, y + 11, x + 12, y + 12)) return null;
    return centerState(buf, at(x + 7, y + 7)) || centerState(buf, at(x + 6, y + 6));
  }

  /** Back-compat: true if there's a marker at (x, y). */
  function isMarkerAt(buf, width, height, x, y) {
    return markerAt(buf, width, height, x, y) !== null;
  }

  // Brightness. Screen-capture video keeps the brightness of every single pixel and
  // only shares *color* between neighbouring pixels, so brightness edges stay exact.
  function luma(b, i) {
    return 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
  }

  const MID = (MARKER - CENTER) / 2 + (CENTER - 1) / 2; // 6.5: middle of the center, from the corner

  /**
   * The exact corner of a marker that markerAt() found at about (x, y).
   *
   * markerAt() can be a pixel or two off on the TV's outer edges: there the game
   * world's colors bleed into the marker in compressed screen-capture video, so as
   * the camera turned the stream wiggled with it. The colored center only touches
   * our own magenta stripe, so we measure from its brightness edges instead, which
   * are the same in every frame. Only looks 2+ px inside the marker, where no
   * outside color reaches. Returns null if the center can't be measured.
   */
  function refineMarker(buf, width, height, x, y) {
    if (x < 1 || y < 1 || x + MARKER >= width || y + MARKER >= height) return null;
    const at = (px, py) => (py * width + px) * 4;
    const L = (px, py) => luma(buf, at(px, py));
    // the stripe's brightness, from the spots markerAt() checks that really are magenta
    let sum = 0, n = 0;
    for (const [px, py] of [[x + 1, y + 1], [x + 2, y + 2], [x + 11, y + 7], [x + 12, y + 7],
      [x + 7, y + 11], [x + 7, y + 12], [x + 11, y + 11], [x + 12, y + 12]]) {
      if (isMagenta(buf, at(px, py))) { sum += L(px, py); n++; }
    }
    const cx = x + 7, cy = y + 7; // inside the center even if (x, y) is 2px off
    const inner = L(cx, cy);
    if (!n || inner - sum / n < 16) return null;
    const thr = (inner + sum / n) / 2;
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    while (x0 - 1 >= x + 2 && L(x0 - 1, cy) > thr) x0--;
    while (x1 + 1 <= x + 12 && L(x1 + 1, cy) > thr) x1++;
    while (y0 - 1 >= y + 2 && L(cx, y0 - 1) > thr) y0--;
    while (y1 + 1 <= y + 12 && L(cx, y1 + 1) > thr) y1++;
    if (Math.abs(x1 - x0 + 1 - CENTER) > 1 || Math.abs(y1 - y0 + 1 - CENTER) > 1) return null;
    return { x: Math.round((x0 + x1) / 2 - MID), y: Math.round((y0 + y1) / 2 - MID) };
  }

  // spots within 2px, nearest first
  const NEAR = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) NEAR.push([dx, dy]);
  NEAR.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));

  /**
   * The marker at or right next to (x, y): {x, y, state} at its exact corner, or null.
   * Falls back to the plain markerAt() spot if the center can't be measured.
   */
  function findMarkerNear(buf, width, height, x, y) {
    let rough = null;
    for (const [dx, dy] of NEAR) {
      const state = markerAt(buf, width, height, x + dx, y + dy);
      if (!state) continue;
      const p = refineMarker(buf, width, height, x + dx, y + dy);
      if (p) return { x: p.x, y: p.y, state };
      if (!rough) rough = { x: x + dx, y: y + dy, state };
    }
    return rough;
  }

  /**
   * All markers in a pixel buffer (4 bytes per pixel, row-major).
   * @param exclude optional {x,y,w,h} to skip (our own overlay)
   * @returns [{x, y, state}] or null if there are suspiciously many
   */
  function findMarkersIn(buf, width, height, exclude) {
    const found = [];
    const inExclude = (x, y) =>
      exclude && x >= exclude.x && x < exclude.x + exclude.w && y >= exclude.y && y < exclude.y + exclude.h;
    for (let y = 1; y < height - MARKER; y++) {
      const row = y * width * 4;
      for (let x = 1; x < width - MARKER; x++) {
        if (!isMagenta(buf, row + x * 4)) continue; // fast reject for almost every pixel
        if (inExclude(x, y)) continue;
        if (!markerAt(buf, width, height, x, y)) continue;
        if (found.some((f) => Math.abs(f.x - x) < MARKER && Math.abs(f.y - y) < MARKER)) continue;
        const p = findMarkerNear(buf, width, height, x, y); // its exact corner
        if (found.some((f) => Math.abs(f.x - p.x) < MARKER && Math.abs(f.y - p.y) < MARKER)) continue;
        found.push(p);
        if (found.length > 8) return null; // something odd on screen, don't guess
      }
    }
    return found;
  }

  /**
   * The inner video rect from the markers' bounding box (so one covered corner doesn't matter).
   * hidden = most markers ask for the stream to be hidden.
   */
  function rectFromMarkers(found) {
    if (!found || found.length < 2) return null;
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, hides = 0;
    for (const p of found) {
      left = Math.min(left, p.x);
      top = Math.min(top, p.y);
      right = Math.max(right, p.x + MARKER);
      bottom = Math.max(bottom, p.y + MARKER);
      if (p.state === 'hide') hides++;
    }
    const w = right - left - 2 * BEZEL, h = bottom - top - 2 * BEZEL;
    if (w < 100 || h < 60) return null;
    return { x: left + BEZEL, y: top + BEZEL, w, h, markers: found, hidden: hides * 2 > found.length };
  }

  /**
   * Too few markers for a rect, but at least two of the last ones are exactly where
   * they were (a pink spell effect right next to a corner, a bag over two corners):
   * the TV hasn't moved, so keep the last rect, with the state of the ones we see.
   */
  function stillInPlace(last, found) {
    if (!last || !found) return null;
    const same = found.filter((p) => last.markers.some((m) => m.x === p.x && m.y === p.y));
    if (same.length < 2) return null;
    const hides = same.filter((p) => p.state === 'hide').length;
    return { ...last, hidden: hides * 2 > same.length };
  }

  /** Full scan of a screenshot -> inner rect (+ markers, hidden), or null. */
  function findScreenRect(buf, width, height, exclude) {
    return rectFromMarkers(findMarkersIn(buf, width, height, exclude));
  }

  const api = { MARKER, CENTER, BEZEL, markerAt, isMarkerAt, refineMarker, findMarkerNear, findMarkersIn,
    rectFromMarkers, stillInPlace, findScreenRect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaltyDetector = api;
})(this);
