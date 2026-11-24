const $ = (id) => document.getElementById(id);
const { parseAmount, fmtMoney, fmtShort } = window.SaltyUtil;

let state = {};
let flashMsg = null;
let clickOn = false;
let wasBlocked = false;

// The wager is either a share of your balance (the % buttons) or a fixed amount you typed.
let wager = { type: 'pct', pct: 0.1 };
let typing = false;

// What you can bet: your balance (counting a bet you're changing as available again).
const available = () => state.available ?? state.balance;

function wagerAmount() {
  if (wager.type === 'fixed') return wager.amount;
  if (!available()) return 0;
  return Math.max(1, Math.floor(available() * wager.pct));
}

const sideName = (side) => (side === 'player1' ? 'RED' : 'BLUE');

// ---------- stream controls (the stream window itself is click-through) ----------
$('play').onclick = () => salty.send('player', 'toggle-play');
$('mute').onclick = () => salty.send('player', 'toggle-mute');
$('reload').onclick = () => { salty.send('reload-player'); flash('Reloading stream…'); };
$('click').onclick = () => salty.send('click-stream', !clickOn);

salty.on('click-stream', (on) => {
  clickOn = on;
  $('click').classList.toggle('on', on);
  if (on) flash('Stream clickable for 20s');
});

salty.on('player-state', (p) => {
  $('play').textContent = p.paused ? '▶' : '⏸';
  $('mute').textContent = p.muted ? '🔇' : '🔊';
  if (p.blocked && !wasBlocked) flash('Started muted · press 🔇 for sound');
  wasBlocked = p.blocked;
});

// ---------- the $ box ----------
// The bar normally can't take the keyboard, so WoW keeps your keybinds. Clicking
// the box asks the app to hand the keyboard over; Enter, Esc or a bet hands it back.
const input = $('amount');

input.addEventListener('mousedown', (e) => {
  if (typing) return;
  e.preventDefault();
  salty.send('kbd', 'capture');
});

salty.on('kbd', (msg) => {
  if (msg !== 'ready') return;
  typing = true;
  input.value = wagerAmount() ? String(wagerAmount()) : '';
  input.classList.add('typing');
  input.focus();
  input.select();
});

function commitTyped() {
  const n = parseAmount(input.value);
  if (n) wager = { type: 'fixed', amount: n };
  else if (input.value.trim()) flash('Type an amount like 500, 2k or 1.5m');
}

function stopTyping(giveFocusBack) {
  if (!typing) return;
  typing = false;
  input.classList.remove('typing');
  input.blur();
  salty.send('kbd', giveFocusBack ? 'release' : 'release-keep');
  render();
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); commitTyped(); stopTyping(true); }
  else if (e.key === 'Escape') { e.preventDefault(); stopTyping(true); } // discard the edit
});
input.addEventListener('input', () => {
  const n = parseAmount(input.value);
  input.classList.toggle('over', !!(n && available() && n > available()));
});

// Clicked back into WoW (or anywhere else) while typing: keep what was typed.
window.addEventListener('blur', () => {
  if (typing) { commitTyped(); stopTyping(false); }
});

// ---------- % presets ----------
document.querySelectorAll('.wagers button').forEach((b) => {
  b.onclick = () => {
    wager = { type: 'pct', pct: Number(b.dataset.pct) };
    stopTyping(true);
    render();
  };
});

// ---------- betting ----------
// Like on the site, you can change your bet until bets lock: click the other side to
// switch, or pick a new amount and click your side again.
let betting = false; // a bet is on its way (ignore a double-click)
document.querySelectorAll('.bet').forEach((b) => {
  b.onclick = async () => {
    if (betting) return;
    if (typing) { commitTyped(); stopTyping(true); }
    const side = b.dataset.side, amount = wagerAmount();
    if (!amount) return flash('Pick or type an amount first');
    if (available() && amount > available()) return flash(`You only have ${fmtMoney(available())}`);
    betting = true;
    let res;
    try { res = await salty.bet(side, amount); } finally { betting = false; }
    if (!res.ok) return flash(res.msg);
    if (res.same) return flash("That's already your bet");
    const what = `${fmtMoney(amount)} on ${sideName(side)}`;
    flash(res.switched ? `Switched to ${what}` : res.changed ? `Changed to ${what}` : `Bet ${what}`);
  };
});

function flash(msg) {
  flashMsg = msg;
  render();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { flashMsg = null; render(); }, 2500);
}

// ---------- rendering ----------
function statusText(s) {
  if (flashMsg) return flashMsg;
  if (s.error) return s.error;
  if (s.status === 'open' && s.myBet) return `Your bet: ${fmtMoney(s.myBet.wager)} on ${sideName(s.myBet.side)}`;
  if (s.status === 'open') return 'Bets are OPEN';
  if (s.status === 'locked') return 'Bets locked — fight!';
  if (s.status === '1') return `${s.p1name} wins!`;
  if (s.status === '2') return `${s.p2name} wins!`;
  return s.alert || '…';
}

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

// "62% (13–8) · $1.03M"
function renderStat(el, fighter, pot, stats) {
  el.textContent = '';
  if (stats && stats.loading) {
    el.append(span('wr', '…'));
  } else if (fighter && fighter.total) {
    const pct = Math.round(fighter.winRate * 100);
    el.append(span('wr' + (pct >= 60 ? ' hot' : pct <= 40 ? ' cold' : ''), `${pct}%`));
    el.append(span('rec', ` (${fighter.wins}–${fighter.losses})`));
  } else if (stats) {
    el.append(span('none', 'No stats'));
  }
  if (pot > 0) el.append(span('pot', ` · ${fmtShort(pot)}`));
  el.title = fighter && fighter.total
    ? `${fighter.wins} wins, ${fighter.losses} losses · ELO ${fighter.elo ?? '?'} · Tier ${fighter.tier ?? '?'}` +
      ` · Best streak ${fighter.bestStreak ?? '?'}\nStats from salty-boy.com`
    : '';
}

function renderTier(stats) {
  const el = $('tier');
  if (stats && stats.tier) {
    el.hidden = false;
    el.textContent = stats.tier;
    el.className = 'tier t-' + stats.tier;
    const format = stats.format ? stats.format[0].toUpperCase() + stats.format.slice(1) + ' · ' : '';
    el.title = `${format}Tier ${stats.tier} (from salty-boy.com)`;
  } else {
    el.hidden = true;
  }
}

// TOURNAMENT / EXHIBITION / TOURNAMENT NEXT label; hover shows SaltyBet's own message
const MODES = {
  tournament: ['TOURNAMENT', 'TOURNEY', 'tournament'],
  exhibition: ['EXHIBITION', 'EXHIB', 'exhibition'],
  next: ['TOURNAMENT NEXT', 'TOURNEY NEXT', 'next'],
};
function renderMode(s) {
  const key = s.mode === 'tournament' ? 'tournament' : s.mode === 'exhibition' ? 'exhibition' : s.nextMode === 'tournament' ? 'next' : null;
  const el = $('mode');
  $('bar').classList.toggle('tourney', s.mode === 'tournament');
  if (!key) { el.hidden = true; return; }
  const [long, short, cls] = MODES[key];
  el.hidden = false;
  el.className = 'mode ' + cls;
  el.querySelector('.long').textContent = long;
  el.querySelector('.short').textContent = short;
  el.title = (s.mode === 'tournament'
    ? 'Tournament: bets use your separate tournament funds. Winnings are added to your real balance when it ends.\n'
    : '') + (s.remaining || '');
}

// ---------- your balance (always shown) and the +/- when a fight ends ----------
const narrow = window.matchMedia('(max-width: 480px)');
const fmtBal = (n) => (narrow.matches ? fmtShort(n) : fmtMoney(n));
let shownBal = null, balTarget = null, balAnim = 0, balColorTimer = null;

/** Show a new balance, counting up/down to it. tint = color it green/red (a payout landing). */
function showBalance(target, tint) {
  const el = $('wamt');
  if (target === null || target === undefined) {
    cancelAnimationFrame(balAnim);
    balAnim = 0; shownBal = balTarget = null;
    el.textContent = '—';
    return;
  }
  if (target === balTarget) return; // already showing it, or counting toward it
  balTarget = target;
  cancelAnimationFrame(balAnim);
  balAnim = 0;
  if (shownBal === null) { shownBal = target; el.textContent = fmtBal(target); return; }
  const from = shownBal, t0 = performance.now(), dur = 900;
  if (tint) {
    el.classList.remove('up', 'down');
    el.classList.add(target > from ? 'up' : 'down');
    clearTimeout(balColorTimer);
    balColorTimer = setTimeout(() => el.classList.remove('up', 'down'), 2000);
  }
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur), ease = 1 - Math.pow(1 - k, 3);
    shownBal = k < 1 ? Math.round(from + (target - from) * ease) : target;
    el.textContent = fmtBal(shownBal);
    balAnim = k < 1 ? requestAnimationFrame(step) : 0;
  };
  balAnim = requestAnimationFrame(step);
}
narrow.addEventListener('change', () => { if (shownBal !== null) $('wamt').textContent = fmtBal(shownBal); });

let shownResult, firstState = true;
/** "+$1,234" in green or "-$500" in red, floating up from your balance (once per fight). */
function popResult(r) {
  const id = r ? r.id : null;
  if (id === shownResult) return;
  shownResult = id;
  if (!r || firstState) return; // don't replay an old result after the bar reloads
  const d = $('delta');
  d.textContent = (r.won ? '+' : '\u2212') + fmtMoney(r.amount);
  d.className = 'delta ' + (r.won ? 'win' : 'loss');
  void d.offsetWidth; // restart the animation
  d.classList.add('go');
  $('wallet').classList.add('popping');
  clearTimeout(popResult.timer);
  popResult.timer = setTimeout(() => $('wallet').classList.remove('popping'), 2800);
}

function renderWallet(s) {
  const tourney = s.mode === 'tournament';
  $('wlabel').textContent = tourney ? 'TOURNEY' : 'BALANCE';
  $('wallet').title = !s.loggedIn ? 'Log in (SaltyTV window) to see your balance'
    : tourney ? 'Your tournament funds. Winnings go to your real balance when the tournament ends.'
    : 'Your SaltyBet balance';
  showBalance(s.loggedIn ? s.balance : null, s.status === '1' || s.status === '2');
  popResult(s.result);
}

function render() {
  const s = state;
  renderMode(s);
  $('p1').textContent = s.p1name || '—';
  $('p2').textContent = s.p2name || '—';
  renderStat($('p1s'), s.stats && s.stats.red, s.p1total, s.stats);
  renderStat($('p2s'), s.stats && s.stats.blue, s.p2total, s.stats);
  renderTier(s.stats);
  $('status').textContent = statusText(s);
  $('status').className = !flashMsg && s.status === 'open' && s.myBet
    ? (s.myBet.side === 'player1' ? 'pick-red' : 'pick-blue') : '';

  // you can bet, and change your bet, until bets lock
  const canBet = s.loggedIn && s.status === 'open';
  for (const b of [$('betRed'), $('betBlue')]) {
    const mine = !!s.myBet && s.myBet.side === b.dataset.side;
    b.disabled = !canBet;
    b.classList.toggle('picked', mine);
    b.title = !s.myBet ? '' : mine
      ? `Your bet: ${fmtMoney(s.myBet.wager)} on ${sideName(b.dataset.side)}` +
        (canBet ? '. Pick a new amount and click to change it.' : '')
      : canBet ? `Switch your bet to ${sideName(b.dataset.side)}` : '';
  }

  document.querySelector('.wagers').classList.toggle('off', !canBet);
  document.querySelectorAll('.wagers button').forEach((b) =>
    b.classList.toggle('on', wager.type === 'pct' && Number(b.dataset.pct) === wager.pct));

  // third line: the $ box while you can bet, otherwise your bet or how it went
  let msg = null, msgClass = '';
  const r = s.result;
  if (!s.loggedIn) msg = 'Log in to bet (SaltyTV window)';
  else if (r && (s.status === '1' || s.status === '2')) {
    msg = `${r.won ? 'You won' : 'You lost'} ${fmtMoney(r.amount)}`;
    msgClass = r.won ? 'win' : 'loss';
  } else if (s.myBet && s.status !== 'open') msg = `Your bet: ${fmtMoney(s.myBet.wager)} on ${sideName(s.myBet.side)}`;
  $('amountRow').hidden = !!msg && !typing;
  $('amountMsg').hidden = !msg || typing;
  $('amountMsg').textContent = msg || '';
  $('amountMsg').className = 'msg' + (msgClass ? ' ' + msgClass : '');

  if (!typing) {
    const amount = wagerAmount();
    input.value = amount ? amount.toLocaleString('en-US') : '';
    input.classList.toggle('over', !!(available() && amount > available()));
  }
  renderWallet(s);
}

salty.on('state', (s) => { state = s; render(); firstState = false; });
render();
