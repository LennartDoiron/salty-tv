// Runs the full-screen marker scan on its own thread so the app's main thread
// (which handles windows and input) never stalls.
const { parentPort } = require('worker_threads');
const { findScreenRect } = require('./detector');

parentPort.on('message', ({ id, buf, width, height, exclude }) => {
  let rect = null;
  try {
    rect = findScreenRect(new Uint8Array(buf), width, height, exclude);
  } catch {
    rect = null;
  }
  parentPort.postMessage({ id, rect });
});
