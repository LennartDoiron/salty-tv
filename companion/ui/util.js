// Small helpers shared by the betting bar (browser) and the tests (Node).
(function (root) {
  /** "500", "1,000", "$2k", "1.5m" -> whole dollars, or null if not a positive amount. */
  function parseAmount(text) {
    const t = String(text ?? '').trim().toLowerCase().replace(/[$,\s]/g, '');
    const m = /^(\d+(?:\.\d+)?)([kmb]?)$/.exec(t);
    if (!m) return null;
    const mult = { '': 1, k: 1e3, m: 1e6, b: 1e9 }[m[2]];
    const n = Math.floor(parseFloat(m[1]) * mult);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** 1234567 -> "$1,234,567" */
  function fmtMoney(n) {
    return '$' + Math.floor(Number(n) || 0).toLocaleString('en-US');
  }

  /** 1234567 -> "$1.23M", 45800 -> "$45.8K", 600 -> "$600" */
  function fmtShort(n) {
    n = Number(n) || 0;
    const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, s] of units) {
      if (n >= v) {
        const x = n / v;
        const str = x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2);
        return '$' + str.replace(/\.0+$|(\.\d*?)0+$/, '$1') + s;
      }
    }
    return '$' + Math.floor(n).toLocaleString('en-US');
  }

  const api = { parseAmount, fmtMoney, fmtShort };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaltyUtil = api;
})(this);
