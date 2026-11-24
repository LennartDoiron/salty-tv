// The Twitch stream. This window is click-through, so it's controlled from the
// betting bar (play/pause, mute, reload) through the main process.

const MIN_W = 400, MIN_H = 300; // Twitch won't autoplay a smaller player
const wrap = document.getElementById('wrap');

// Lay the player out at least 400x300 and scale it down to fit the window.
function fit() {
  const W = window.innerWidth, H = window.innerHeight;
  const k = Math.min(1, W / MIN_W, H / MIN_H);
  wrap.style.width = W / k + 'px';
  wrap.style.height = H / k + 'px';
  wrap.style.transform = k < 1 ? `scale(${k})` : '';
}
window.addEventListener('resize', fit);
fit();

let player = null, ready = false, userPaused = false, blocked = false;
let shown = false; // the main process tells us when the TV is actually on screen

function report() {
  if (!ready) return;
  salty.send('player-state', { paused: player.isPaused(), muted: player.getMuted(), blocked });
}

// Start playing when the TV is on screen, unless you paused it yourself.
// (document.visibilityState can't be trusted here: Electron reports hidden windows as visible.)
function autoPlay() {
  if (ready && shown && !userPaused) player.play();
}

try {
  player = new Twitch.Player('player', {
    channel: 'saltybet', parent: ['localhost'], width: '100%', height: '100%',
    autoplay: true, muted: false,
  });
  const E = Twitch.Player;
  player.addEventListener(E.READY, () => { ready = true; autoPlay(); report(); });
  player.addEventListener(E.PLAY, report);
  player.addEventListener(E.PAUSE, report);
  player.addEventListener(E.PLAYING, () => { blocked = false; report(); });
  player.addEventListener(E.PLAYBACK_BLOCKED, () => {
    // Twitch refused to start with sound: start muted instead (unmute from the bar).
    blocked = true;
    player.setMuted(true);
    player.play();
    report();
  });
} catch (e) {
  document.getElementById('player').textContent = 'Could not load the Twitch player: ' + e;
}

salty.on('player', (cmd) => {
  if (cmd === 'show') {
    shown = true;
    autoPlay();
  } else if (cmd === 'hide') {
    shown = false;
    if (ready) player.pause(); // TV hidden in game: pause, and resume when it comes back
  } else if (!ready) {
    return;
  } else if (cmd === 'toggle-play') {
    if (player.isPaused()) { userPaused = false; player.play(); }
    else { userPaused = true; player.pause(); }
  } else if (cmd === 'toggle-mute') {
    player.setMuted(!player.getMuted());
  }
  setTimeout(report, 300);
});

salty.on('click-stream', (on) => {
  document.getElementById('clickable').style.display = on ? 'block' : 'none';
});
