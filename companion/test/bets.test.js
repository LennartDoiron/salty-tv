// Your bet's result (+/-), changing bets and what you can still bet.
const assert = require('assert');
const { betResult, detectDeduction, availableToBet } = require('../bets');

const red = (wager) => ({ side: 'player1', wager });
const blue = (wager) => ({ side: 'player2', wager });
const pots = { p1: 1000, p2: 3000 }; // red is the favorite... of nobody: 1000 vs 3000

// won: your share of the other side's pot; lost: your wager
assert.deepStrictEqual(betResult(red(100), '1', pots), { won: true, amount: 300 });
assert.deepStrictEqual(betResult(blue(300), '2', pots), { won: true, amount: 100 });
assert.deepStrictEqual(betResult(red(100), '2', pots), { won: false, amount: 100 });
assert.deepStrictEqual(betResult(blue(2500), '1', pots), { won: false, amount: 2500 });
assert.deepStrictEqual(betResult(red(333), '1', pots), { won: true, amount: 999 }); // rounded down
assert.strictEqual(betResult(null, '1', pots), null, 'no bet, nothing to show');
assert.strictEqual(betResult(red(100), 'locked', pots), null, 'no winner yet');
assert.strictEqual(betResult(red(0), '1', pots), null);
console.log('ok  result: +your share of the other pot when you win, -your wager when you lose');

// does the site's balance already leave out your bet?
assert.strictEqual(detectDeduction(12345, 12345, 2500), false, 'balance unchanged: not taken out');
assert.strictEqual(detectDeduction(12345, 9845, 2500), true, 'balance minus the wager: taken out');
assert.strictEqual(detectDeduction(12345, 11000, 2500), null, "something else changed: can't tell");
assert.strictEqual(detectDeduction(null, 9845, 2500), null);
console.log('ok  learns whether SaltyBet takes your bet out of the balance right away');

// what you can bet while changing a bet
assert.strictEqual(availableToBet(9845, red(2500), true), 12345, 'the old bet comes back when you change it');
assert.strictEqual(availableToBet(12345, red(2500), false), 12345);
assert.strictEqual(availableToBet(12345, null, true), 12345);
assert.strictEqual(availableToBet(9845, red(2500), null), 9845, "unknown yet: don't count it");
assert.strictEqual(availableToBet(null, red(2500), true), null, 'not logged in');
console.log('ok  changing a bet: ALL IN and the % buttons count your current bet as available again');

// reading your balance from SaltyBet's home page
const { parseBalance } = require('../bets');
assert.strictEqual(parseBalance('<span class="dollar" id="balance">12,345</span>'), 12345);
assert.strictEqual(parseBalance('<span id="balance">0</span><a href="/logout">Log out</a>'), 0, 'a real $0 balance');
assert.strictEqual(parseBalance('<span id="balance">0</span> Sign in to start playing! <a href="https://www.saltybet.com/authenticate?signin=1">Sign in</a>'), null);
assert.strictEqual(parseBalance('<span id="balance">0</span><a href="/authenticate?signin=1">Sign in</a>'), null);
assert.strictEqual(parseBalance('<html>no balance here</html>'), null);
console.log('ok  signed out of SaltyBet reads as "not logged in", not as $0');

console.log('all bet tests passed');
