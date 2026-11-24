// Your bet in the current match: what it did, and how much you can bet.
// Shared by main.js and the tests.

const { payout } = require('./records');

/**
 * What your bet did once the winner is in (status '1' = red won, '2' = blue won).
 * pots = { p1, p2 } as they were when bets locked.
 * Returns { won, amount } (what you gained or lost), or null if you had no bet.
 */
function betResult(bet, status, pots) {
  if (!bet || !(bet.wager > 0) || (status !== '1' && status !== '2')) return null;
  const winSide = status === '1' ? 'player1' : 'player2';
  if (bet.side !== winSide) return { won: false, amount: bet.wager };
  const own = winSide === 'player1' ? pots.p1 : pots.p2;
  const other = winSide === 'player1' ? pots.p2 : pots.p1;
  return { won: true, amount: payout(bet.wager, own, other) };
}

/**
 * Does SaltyBet's balance already leave out your current bet? Compares your balance
 * from before you bet with the one right after. true / false, or null if it can't tell.
 */
function detectDeduction(before, after, wager) {
  if (!(before > 0) || !(after >= 0) || !(wager > 0)) return null;
  if (after === before) return false;
  if (after === before - wager) return true;
  return null;
}

/**
 * How much you can bet right now. Changing a bet gives the old one back, so if the
 * site already took it out of your balance, it counts as available again.
 */
function availableToBet(balance, bet, deducted) {
  if (balance === null || balance === undefined) return null;
  return balance + (bet && deducted ? bet.wager : 0);
}

module.exports = { betResult, detectDeduction, availableToBet };
