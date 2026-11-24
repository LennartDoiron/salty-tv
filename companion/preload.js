const { contextBridge, ipcRenderer, webFrame } = require('electron');

// This script also runs inside the Twitch player frame in the stream window (so the
// optional ad skipping can start before Twitch's own code). SaltyTV's controls are
// only ever handed to SaltyTV's own pages, never to Twitch's.
const host = location.hostname;

if (location.protocol === 'http:' && (host === 'localhost' || host === '127.0.0.1')) {
  const LISTEN = ['state', 'detector', 'player', 'player-state', 'click-stream', 'kbd', 'leaderboard', 'settings',
    'tracker-start', 'update'];
  const SEND = ['login', 'logout', 'demo', 'player', 'player-state', 'click-stream', 'reload-player', 'kbd',
    'choose-wow-folder', 'set-adblock', 'tracker', 'start-with-windows', 'install-update', 'check-update', 'update-addon'];

  contextBridge.exposeInMainWorld('salty', {
    on: (ch, cb) => LISTEN.includes(ch) && ipcRenderer.on(ch, (_e, data) => cb(data)),
    send: (ch, data) => SEND.includes(ch) && ipcRenderer.send(ch, data),
    bet: (side, wager) => ipcRenderer.invoke('bet', { side, wager }),
  });
} else if (host === 'player.twitch.tv') {
  // "Try to skip Twitch ads": the app hands over TwitchAdSolutions' vaft script only when
  // that's switched on, and it runs in the player's page before any of Twitch's scripts.
  const code = ipcRenderer.sendSync('adblock-script');
  if (code) webFrame.executeJavaScript(code);
}
