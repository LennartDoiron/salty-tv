// A few tiny Windows calls (via koffi, which ships a prebuilt binary, so nothing
// gets compiled):
//   - hand the keyboard back to WoW after you type a bet amount
//   - find WoW's window under the TV's corner marker, so the overlay can stay
//     right above WoW instead of above every app
// On other platforms (or if loading fails) these are no-ops.

let user32 = null;
if (process.platform === 'win32') {
  try {
    const koffi = require('koffi');
    const lib = koffi.load('user32.dll');
    const POINT = koffi.struct('SALTYTV_POINT', { x: 'long', y: 'long' });
    user32 = {
      GetForegroundWindow: lib.func('intptr_t __stdcall GetForegroundWindow()'),
      SetForegroundWindow: lib.func('int __stdcall SetForegroundWindow(intptr_t hWnd)'),
      WindowFromPoint: lib.func('__stdcall', 'WindowFromPoint', 'intptr_t', [POINT]),
      GetAncestor: lib.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)'),
    };
  } catch {
    user32 = null;
  }
}

const GA_ROOT = 2;

module.exports = {
  available: !!user32,
  /** Handle of the window that currently has focus (WoW, while you play). */
  getForegroundWindow() {
    return user32 ? user32.GetForegroundWindow() : null;
  },
  /** Give focus back to a window from getForegroundWindow(). */
  setForegroundWindow(hwnd) {
    return user32 && hwnd ? user32.SetForegroundWindow(hwnd) !== 0 : false;
  },
  /** The top-level window at a screen point (physical pixels), e.g. WoW under a marker. */
  rootWindowAt(x, y) {
    if (!user32) return null;
    try {
      const h = user32.WindowFromPoint({ x: Math.round(x), y: Math.round(y) });
      return h ? user32.GetAncestor(h, GA_ROOT) || null : null;
    } catch {
      return null;
    }
  },
};
