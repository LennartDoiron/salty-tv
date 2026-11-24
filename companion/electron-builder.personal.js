// The personal build: the same SaltyTV, plus the "Try to skip Twitch ads" switch.
// For you and your friends only. Build it on your own PC with: npm run dist:personal
// It isn't published to GitHub, and it doesn't auto-update from the public releases
// (they don't include the ad skipping); it tells you when a new version is out instead.
const base = require('./package.json').build;

module.exports = {
  ...base,
  files: base.files.filter((f) => f !== '!vendor/**'), // include vendor/vaft.user.js
  extraMetadata: { saltytvEdition: 'personal', saltytvRepo: 'LennartDoiron/salty-tv' },
  nsis: { ...base.nsis, artifactName: 'SaltyTV-Personal-Setup-${version}.${ext}' },
  publish: null,
};
