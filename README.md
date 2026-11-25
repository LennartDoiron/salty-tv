# SaltyTV — SaltyBet inside WoW Forever

Watch the SaltyBet stream on an in-game "TV" and bet without leaving WoW.

WoW addons can't play video or go online, so this comes in two parts:

| Part | What it does |
|---|---|
| `addon/SaltyTV` | Draws a movable, resizable black screen in WoW with four magenta markers in its corners. |
| `companion/` | A Windows app (Electron) that watches the screen, finds those markers, and puts two borderless windows exactly over the screen: the Twitch stream, and a betting bar under it. |

**Feels like part of WoW:**
- **Live tracking:** a hidden window keeps a screen capture running and checks about 30 frames a second, only looking at small patches around the markers. The stream follows the TV as you move it. If live capture can't start on your PC, the app falls back to checking the screen twice a second. The SaltyTV window shows which one is running ("live" or "snapshots").
- **Hides when it should:** the markers' centers are a little signal from the addon to the app. They're green normally and turn yellow while you drag or resize the TV, or while the game menu, settings or a cinematic is open. Then the stream hides (the sound keeps playing) and comes back when you're done. The world map does what you pick in Settings: hide the stream the same way, keep the TV on top of the map, or pause (the markers turn off, so the app treats the TV as closed).
- **Stays with WoW:** the overlay sits right above WoW instead of above every app, so if you switch to another window it doesn't float over it. If Windows won't let it go back above WoW, the app falls back to keeping the stream above all windows.

The stream window lets every click pass through to WoW. The betting bar is a separate window that takes clicks without stealing focus, so your keybinds keep working. Because they're separate, the app never installs a system-wide mouse hook.

## Install

1. **The addon:** install **SaltyTV** from CurseForge (with your **Forever** install selected in the CurseForge app).
2. **The app:** download **SaltyTV-Setup-x.y.z.exe** from the [Releases page](../../releases/latest) and run it. It installs for your Windows user only (no admin needed) and starts SaltyTV.
   - Windows may say **"Windows protected your PC"** because the installer isn't code-signed yet. Click **More info**, then **Run anyway**.
   - The app finds your WoW folder by itself. If you skipped step 1, it installs the addon for you (restart WoW once). If it can't find WoW, click **Change…** next to *WoW folder* and pick your `World of Warcraft` folder.
3. **WoW settings**: Display Mode must be **Windowed** or **Windowed (Maximized)**, not exclusive Fullscreen. WoW must be on your **primary monitor**.
4. In the SaltyTV window, click **Log in** and sign in to SaltyBet. Your session is saved.
5. In WoW, click the SaltyTV button on your minimap (or type `/salty`) to show or hide the TV. Right-click it for Guild records, Shift-click for Settings. Drag the header to move it and drag the corner icon to resize. `/salty lock` locks it, `/salty reset` recenters it.

**Updates:** CurseForge keeps the addon up to date. The app updates itself: a new version downloads in the background and the SaltyTV window shows **Restart to update** (or it installs the next time you quit). If your addon falls behind the app, the window says so; update it in CurseForge, or click **Update it for me**. The app never overwrites an addon CurseForge manages unless you click that.

Closing the SaltyTV window keeps it running in the tray (bottom right, near the clock). Click the icon to open it again; right-click it to quit or to turn on **Start with Windows**, which starts SaltyTV quietly in the tray when you log in.

Tick **Show without WoW** in the SaltyTV window to test the stream and betting bar without the game running.

### Run from source

Install [Node.js](https://nodejs.org) (LTS), then:
```
cd companion
npm install
npm start
```
`npm test` runs the app's tests, `python3 addon/test/sim.py` (needs `pip install lupa`) runs the addon's multi-client simulation.

## Betting bar

- **Win rates:** under each fighter you see their win rate and record, e.g. `62% (13–8)`. Once bets lock, the pot is added: `· $1.03M`. Hover for ELO, tier and best streak.
- **Tier:** the colored badge next to the status (X, S, A, B, P). Hover it to see whether it's matchmaking or a tournament.
- **Tournaments:** during a SaltyBet tournament the bar turns purple, says **TOURNAMENT** (TOURNEY on a small TV), and your balance is labeled **TOURNEY**. Tournaments use separate tournament funds; whatever you win is added to your real balance when it ends. Hover the label for SaltyBet's own message, like "6 characters are left in the bracket!". Exhibitions show a grey **EXHIBITION** label, and the last match before a tournament shows **TOURNAMENT NEXT**. The SaltyTV window has a Mode row too.
- **Amount:** click a % button, or click the `$` box and type an amount: `500`, `1,000`, `2k`, `1.5m`. Press Enter to confirm or Esc to cancel. While you type, the bar holds the keyboard so your numbers don't fire WoW keybinds. Afterwards the keyboard goes straight back to WoW.
- **Changing your bet:** like on the site, you can change your bet until bets lock. Your side gets a ✓ and the bar shows `Your bet: $2,500 on RED`. Misclicked? Click the other side to switch, or pick a new amount and click your side again. The % buttons count your current bet as yours again, so ALL IN still means everything.
- **Balance:** always on the right of the bar, next to the stream buttons (labeled TOURNEY during tournaments).
- **Wins and losses:** when a fight you bet on ends, a green `+$4,115` or red `−$1,646` pops up over your balance, the bar says `You won` / `You lost` until the next match, and the balance counts up or down once SaltyBet pays out.

Fighter stats come from [SaltyBoy](https://salty-boy.com) by FranciscoAT, a community project that records every SaltyBet match. The app asks it once per match (plus a few retries if SaltyBoy hasn't caught up yet), never in a loop.

## Guild leaderboard

Click the coin button on the TV's header (or type `/salty board`) to open **Guild records**, attached to the right of the TV (or the left if the TV is against the right edge of your screen):

- **Richest:** current balance.
- **Peak balance:** the highest balance you've reached.
- **Biggest win:** your largest winnings from one bet, calculated from the pots. Counts bets made while the SaltyTV app is running, whether you bet from the bar or on the SaltyBet site, in any mode, including tournaments. Site bets only count once the app knows your SaltyBet name (see below).

Each always shows a top 3 with a gold, silver and copper coin (empty spots stay dimmed until someone takes them). If you rank lower, "You: 5th" shows next to the category name. Hover over a name to see their SaltyBet name and how old their numbers are.

**How it works:**
1. The SaltyTV app keeps track of your numbers and writes them into a small addon called `SaltyTV_Data`, next to SaltyTV in your AddOns folder.
2. WoW reads it when you log in or `/reload`. **The first time it appears, restart WoW completely once** so WoW notices the new addon.
3. Your SaltyTV addon shares your numbers with guildmates who have SaltyTV, over WoW's hidden addon channel. Everyone keeps a copy and passes it on, so you also see people you're never online with at the same time. The newest numbers always win, and alts count once.

**Good to know:**
- Richest and Peak only use your real balance, read during matchmaking and exhibition matches. Tournament funds never count. During a tournament the leaderboard pauses (the SaltyTV window says so) and picks up your balance, winnings included, as soon as it ends.
- Your row updates when you log in or `/reload`, not live.
- WoW blocks addon messages inside dungeons, raids and battlegrounds, so sharing waits until you're back outside.
- The app learns your SaltyBet name after your first bet from the betting bar. Until then the tooltip says "unknown".
- What's shared with your guild: your character name and class, SaltyBet name, balance, peak and biggest win. Turn it off with `/salty share off`.
- `/salty sync` asks your guild to share records again.
- **Settings** (the gear on the TV, `/salty settings`, Shift-click the minimap button, or Options > AddOns > SaltyTV): lock the TV, show or hide the minimap button, open the TV on flight paths (on by default; it closes again when you land), hide it during combat, hide it in dungeons, raids and PvP, choose what the world map does to the stream, and guild sharing. Showing or hiding the TV yourself always wins over the automatic ones.
- `/salty minimap` hides or shows the minimap button. Drag the button to move it around the minimap.
- The app finds your WoW folder automatically. If it can't, click **Change…** in the SaltyTV window and pick your World of Warcraft folder.

## Stream controls

The stream itself is click-through, so it's controlled from the four small buttons at the right end of the betting bar:

| Button | Does |
|---|---|
| ▶ / ⏸ | Play or pause. The stream also pauses when you hide the TV (`/salty`) and resumes when it comes back, unless you paused it yourself. |
| 🔊 / 🔇 | Mute or unmute. |
| 🖱 | Makes the stream clickable for 20 seconds, for Twitch's own buttons such as a content warning or quality settings. A yellow border shows while it's on. |
| ↻ | Reloads the stream if it gets stuck. |

Twitch won't autoplay a player smaller than 400×300, so on a small TV the player is laid out at that size and shrunk to fit.

## How betting works

- The app polls `https://www.saltybet.com/state.json` every 2 seconds to get the fighters, pots and status (`open`, `locked`, `1` or `2` for the winner).
- It reads your balance from the SaltyBet homepage, using the session from when you logged in.
- Bets go to `ajax_place_bet.php` (`selectedplayer=player1|player2`, `wager=N`), the same request the site makes.
- A new bet while bets are open replaces your old one (SaltyBet keeps one bet per player). Once the app knows your SaltyBet name it reads your bet back from SaltyBet's bettor list (`zdata.json`), so the bar always shows the bet that counts, including bets you place or change on the site.

## Things to know

- **SaltyBet can change its site.** The endpoints the app uses aren't an official API (they're the same requests the site and community bots make), so a change on SaltyBet's side can break betting until SaltyTV is updated.
- **Ads**: the stream is SaltyBet's Twitch channel, so Twitch's ads play by default. Twitch Turbo removes them reliably. If you build SaltyTV yourself (see [Building it with ad skipping](#building-it-with-ad-skipping)), you can also tick **Try to skip Twitch ads (experimental)** in the SaltyTV window. It runs [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions)' `vaft` script (MIT) inside the stream's Twitch player, which tries to switch to an ad-free copy of the stream during ad breaks. It isn't guaranteed: sometimes you'll see a short pause instead of an ad, and since that project is archived, a Twitch change could stop it working. It's off by default.
- **SaltyBet's rules**: this is a custom client that places bets you click yourself. Check SaltyBet's terms if you plan to share it.
- **App and addon go together.** The app installs the matching addon itself. If you also use CurseForge, keep both up to date: the markers changed size in 0.4, so an older addon isn't found by a newer app (and the other way round).
- **Things that can confuse the detector**: color-blind filters, ReShade or other post-processing, HDR, or something covering several of the TV's corners at once (one or two is fine). If the control window says "Not found", turn those off.
- **Blizzard**: the addon only draws textures and the app only reads the screen. Nothing touches the game's memory or sends input to it, which is the same approach other overlay addons use.

## Privacy

- The app looks at your screen only to find the TV's corner markers, on your PC. Nothing is recorded or sent anywhere.
- It talks to saltybet.com (with your own login, stored on your PC), salty-boy.com (fighter stats), Twitch (the stream) and GitHub (update checks). Nothing else.
- Guild sharing goes over WoW's own addon channel to your guild only, and you can turn it off with `/salty share off`.

## Credits

- Fighter stats: [SaltyBoy](https://salty-boy.com) by FranciscoAT (MIT).
- The stream and betting: [SaltyBet](https://www.saltybet.com). SaltyTV is a fan project and isn't affiliated with SaltyBet, Twitch or Blizzard Entertainment.
- Optional ad skipping in self-built copies: [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) by pixeltris (MIT).

## Releasing a new version

1. Bump the version in **both** `companion/package.json` and `addon/SaltyTV/SaltyTV.toc` (same number).
2. Commit, then tag and push: `git tag v0.6.0 && git push origin main v0.6.0`.
3. GitHub Actions (`.github/workflows/release.yml`) runs the tests, builds `SaltyTV-Setup-0.6.0.exe` on Windows and publishes it as a release. Installed copies update from there.
4. The release also gets `SaltyTV-addon-v0.6.0.zip`: upload that to CurseForge as a new file (game version: Forever). The project description lives in `CURSEFORGE.md`.

## Building it with ad skipping

The installer on the Releases page doesn't include the experimental **Try to skip Twitch ads** switch, but the source does (`companion/vendor/`, from [TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions)). To build an installer with it for yourself, on Windows with [Node.js](https://nodejs.org) installed: download this repo (green **Code** button, **Download ZIP**, or `git clone`), then double-click **`build-personal.bat`**. It opens the folder with `SaltyTV-Personal-Setup-<version>.exe` when it's done. (Or run `npm install` and `npm run dist:personal` in `companion`.)

The personal build installs over the regular one, shows **personal** next to its version, and has the switch (off until you tick it). It doesn't update itself, since the regular releases would remove the switch; the SaltyTV window tells you when a new version is out, and you build again. Please don't re-upload it to Releases or CurseForge.

## Files

```
addon/SaltyTV/SaltyTV.toc, SaltyTV.lua   in-game screen + markers
companion/main.js              windows, screen detection, SaltyBet requests
companion/ui/detector.js       finds the markers (shared by the app, the tracker and the tests)
companion/ui/tracker.*         live tracking (hidden window, ~30 fps screen capture)
companion/detector-worker.js   full scans for the snapshot fallback, on a separate thread
companion/saltyboy.js          fighter stats (win rates, tier) from salty-boy.com
companion/native.js            hands keyboard focus back to WoW after typing (Windows)
companion/records.js           your leaderboard numbers (balance, peak, biggest win)
companion/addoninstall.js      installs/updates the addon in WoW's AddOns folder
companion/assets/, build/      icons (app, tray, installer)
companion/bets.js              your bet: what it won or lost, and what you can still bet
companion/dataaddon.js         writes them into the SaltyTV_Data addon
companion/wowpath.js           finds WoW Forever's AddOns folder
companion/modes.js             tells matchmaking, tournaments and exhibitions apart
companion/vendor/              TwitchAdSolutions' vaft script + its MIT license (only used if you turn on ad skipping)
addon/SaltyTV/Sync.lua         shares leaderboard records with your guild
addon/SaltyTV/Board.lua        the Guild records panel
addon/test/                    runs several fake WoW clients to test the sync (python3 addon/test/sim.py)
companion/ui/                  video.html/video.js (stream), bar.html/bar.js/util.js (betting + stream controls), control.html
companion/test/                unit tests: detector, bets, stats, modes, leaderboard (npm test)
```

## Ideas for v2

- Show what your guildmates bet on the current fight (over the same hidden addon channel as the leaderboard).
- Multi-monitor support (right now the TV has to be on your main screen).
