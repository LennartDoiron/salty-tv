<!--
  Project description for CurseForge (paste everything below this comment).
  Before pasting, replace YOUR-GITHUB-NAME in the link at the bottom.
  CurseForge's rules: no direct download links to files elsewhere, and links to
  other sites go at the bottom of the description. So this links the GitHub
  project page (whose README has the download), at the bottom.
-->

# SaltyTV

Watch the **SaltyBet** stream on a TV inside WoW Forever, bet on the fights without alt-tabbing, and race your guild for the biggest SaltyBet bankroll.

**SaltyTV needs the free SaltyTV companion app for Windows.** WoW addons can't play video or go online, so the app puts the stream on your in-game TV and places your bets. See **Getting the app** at the bottom of this page.

## Features

- **A TV in WoW**: drag it anywhere, resize it, lock it. The stream follows it smoothly and hides while you drag it or have the map or game menu open.
- **Betting bar** under the stream:
  - Each fighter's win rate and record (from SaltyBoy), the tier, and the pots once bets lock
  - Bet with 5% / 10% / 25% / 50% / ALL IN, or type any amount
  - Change your bet until bets lock, just like on the site
  - Your balance always on screen, with a green +$ or red −$ after every fight
  - Tournaments are easy to spot: the bar turns purple (tournament funds)
- **Guild records**: click the coin on the TV's header for your guild's top 3 in **Richest**, **Peak balance** and **Biggest win**. Shared automatically with guildmates who use SaltyTV.
- Your keybinds keep working. Play, pause, mute and reload buttons are on the bar.

## Getting started

1. Install **SaltyTV** with the CurseForge app (with your **Forever** install selected).
2. Install the **SaltyTV app** (see below) and log in to SaltyBet in its window.
3. In WoW, set Display Mode to **Windowed** or **Windowed (Maximized)**. WoW needs to be on your main monitor.
4. Type `/salty` to show the TV.

## Commands

| Command | What it does |
|---|---|
| `/salty` | Show or hide the TV |
| `/salty lock` | Lock or unlock the TV |
| `/salty reset` | Put the TV back in the middle |
| `/salty board` | Open or close Guild records |
| `/salty share on` / `off` | Share your numbers with your guild (on by default) |
| `/salty sync` | Ask your guild for their latest records |

## FAQ

**Is this allowed?** The addon only draws the TV frame and four small colored squares in its corners. The app finds those squares by looking at your screen, the way streaming overlays work. Nothing reads or changes the game's memory or sends input to the game.

**Is it real money?** No. SaltyBet uses play money.

**What does guild sharing send?** Your character name and class, your SaltyBet name, balance, peak and biggest win, only to your guild, over WoW's addon channel. Turn it off with `/salty share off`.

**The TV is empty.** Start the SaltyTV app. Its window shows whether it found the TV. Color-blind filters, ReShade or HDR can stop it from finding the corner squares.

SaltyTV is a fan project, not affiliated with SaltyBet, Twitch or Blizzard. Fighter stats come from SaltyBoy by FranciscoAT.

---

## Getting the app

The SaltyTV app is free and open source. Download it and read the install guide here:
**https://github.com/YOUR-GITHUB-NAME/salty-tv**

The installer isn't code-signed yet, so Windows may say "Windows protected your PC". Click **More info**, then **Run anyway**.
