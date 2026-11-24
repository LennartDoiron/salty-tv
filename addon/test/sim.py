"""
Runs several fake WoW clients with the real SaltyTV addon code (Lua 5.1, like WoW),
passes guild addon messages between them, and checks the leaderboard syncs.

    python3 addon/test/sim.py
"""
import os
import sys
import lupa.lua51 as lua51

HERE = os.path.dirname(os.path.abspath(__file__))
ADDON = os.path.join(HERE, '..', 'SaltyTV')
FILES = ['SaltyTV.lua', 'Sync.lua', 'Board.lua']  # same order as SaltyTV.toc
BASE_EPOCH = 1_700_000_000


def appdata(id_, bal, peak, win, updated, salty=None):
    s = 'nil' if salty is None else f'"{salty}"'
    return (f'SaltyTV_AppData = {{ version = 1, id = "{id_}", saltyName = {s}, balance = {bal}, '
            f'peak = {peak}, biggestWin = {win}, updated = {updated} }}')


class Client:
    def __init__(self, world, name, cls, guild='Baboochie', data=None, saved=None, roster=None, seed=1):
        self.world, self.name, self.guild = world, name, guild
        self.full = f'{name}-Realm'
        self.lua = lua51.LuaRuntime(unpack_returned_tuples=True)
        self.lua.execute(open(os.path.join(HERE, 'wowmock.lua')).read())
        g = self.lua.globals()
        self.M = g.MOCK
        self.M.player, self.M.realm, self.M['class'] = name, 'Realm', cls
        self.M.guild = guild
        self.M.epoch = BASE_EPOCH + int(world.t)
        if roster is not None:
            self.M.roster = self.lua.table_from(roster)
        if saved:
            self.lua.execute('SaltyTVDB = ' + saved)
        if data:
            self.lua.execute(data)
        self.lua.execute(f'math.randomseed({seed})')
        self.ns = self.lua.table()
        load = self.lua.eval('function(src, name, ns) local f = assert(loadstring(src, "@" .. name)); f("SaltyTV", ns) end')
        for f in FILES:
            load(open(os.path.join(ADDON, f)).read(), f, self.ns)
        fire = self.M.fire
        fire('ADDON_LOADED', 'SaltyTV_Data')
        fire('ADDON_LOADED', 'SaltyTV')
        fire('PLAYER_LOGIN')
        fire('PLAYER_ENTERING_WORLD', True, False)

    # helpers
    def store(self):
        db = self.lua.globals().SaltyTVDB
        guilds = db.guilds
        return guilds[f'{self.guild}-Realm'] if guilds and self.guild else None

    def records(self):
        s = self.store()
        out = {}
        if s:
            for k, r in s.items():
                out[k] = dict(char=r.char, bal=r.bal, peak=r.peak, win=r.win, t=r.t, salty=r.salty)
        return out

    def logout(self):
        return self.lua.eval('MOCK.serialize(SaltyTVDB)')

    def board(self):
        """What the leaderboard panel shows, read from the fake frames."""
        self.ns.Board.Toggle(True)
        frames = list(self.M.frames.values())
        panel = self.lua.globals().SaltyTVBoard
        rows = [f for f in frames if f.parentUid == panel.uid and f.kind == 'Button' and f['name'] is not None]
        texts = [f for f in frames if f.parentUid == panel.uid and f.kind == 'FontString']
        sections = []
        for s in range(3):
            shown = []
            for row in rows[s * 3:(s + 1) * 3]:
                if row.shown:
                    coin = row.icon.texture.split('\\')[-1] if row.icon.shown and row.icon.texture else None
                    if coin and row.icon.alpha is not None and row.icon.alpha < 1:
                        coin = 'dim:' + coin  # nobody holds this spot yet
                    shown.append((coin or (row.rank.text or ''), row['name'].text, row.value.text or ''))
            sections.append((texts[1 + s].text, shown, texts[4 + s].text or ''))
        footer = texts[-1].text
        return dict(title=texts[0].text, sections=sections, footer=footer, side=panel.side)


class World:
    def __init__(self):
        self.t = 0.0
        self.online = []
        self.sent = []  # (sender, msg)

    def login(self, *args, **kw):
        c = Client(self, *args, **kw)
        self.online.append(c)
        return c

    def logout(self, c):
        self.online.remove(c)
        return c.logout()

    def run(self, seconds, dt=0.1):
        for _ in range(int(round(seconds / dt))):
            self.t += dt
            for c in list(self.online):
                c.M.advance(dt)
            for c in list(self.online):
                box = c.M.outbox
                msgs = [tuple(box[i].values()) for i in range(1, len(box) + 1)]
                for i in range(len(box), 0, -1):
                    box[i] = None
                for prefix, msg, chan in msgs:
                    self.sent.append((c.name, msg))
                    for d in self.online:
                        if d.guild == c.guild:  # guild messages reach everyone online, sender included
                            d.M.fire('CHAT_MSG_ADDON', prefix, msg, chan, c.full)

    def count(self, kind, since=0):
        return sum(1 for _, m in self.sent[since:] if m.startswith(kind + ';'))


def check(cond, label):
    if not cond:
        print('FAIL ', label)
        sys.exit(1)
    print('ok   ', label)


# --------------------------------------------------------------------------
w = World()
T0 = BASE_EPOCH

# Three guildmates online with the app: they all end up with all three records.
lenny = w.login('Lenny', 'MAGE', data=appdata('aaa', 12345, 50000, 2601, T0 + 10, 'lenny'), seed=1)
bingi = w.login('Bingi', 'WARRIOR', data=appdata('bbb', 1_930_000, 2_000_000, 400_000, T0 + 20, 'bingi'), seed=2)
drain = w.login('Drain', 'ROGUE', data=appdata('ccc', 946_090, 946_090, 90_000, T0 + 30, 'drain'), seed=3)
w.run(40)
for c in (lenny, bingi, drain):
    check(set(c.records()) == {'aaa', 'bbb', 'ccc'}, f'{c.name} has all 3 records after everyone logs in')
check(all(len(m) <= 255 for _, m in w.sent), 'every addon message fits in 255 bytes')

# A guildmate without the app (no SaltyTV_Data) still sees everyone.
jenny = w.login('Jenny', 'PRIEST', seed=4)
mark = len(w.sent)
w.run(40)
check(set(jenny.records()) == {'aaa', 'bbb', 'ccc'}, 'Jenny (no app) gets all 3 records')
r_sent = w.count('R', mark)
check(r_sent <= 6, f'answering her request took {r_sent} record messages for 3 records (not one per guildmate)')

# Bingi and Drain log off. Chair logs in later and only Lenny is online:
# Lenny relays the records of people Chair has never been online with.
saved_bingi = w.logout(bingi)
saved_drain = w.logout(drain)
w.logout(jenny)
chair = w.login('Chairman', 'HUNTER', data=appdata('ddd', 129_570, 918_000_000_000, 5_000, T0 + 50), seed=5)
w.run(40)
check(set(chair.records()) == {'aaa', 'bbb', 'ccc', 'ddd'}, 'Chairman gets Bingi and Drain via Lenny (relay)')
check(set(lenny.records()) == {'aaa', 'bbb', 'ccc', 'ddd'}, 'Lenny gets Chairman')

# Bingi comes back with newer numbers: the newer version replaces the old one everywhere.
bingi = w.login('Bingi', 'WARRIOR', data=appdata('bbb', 2_500_000, 2_500_000, 400_000, T0 + 500, 'bingi'),
                saved=saved_bingi, seed=6)
w.run(40)
for c in (lenny, chair, bingi):
    check(c.records()['bbb']['bal'] == 2_500_000, f'{c.name} has Bingi\'s new balance')

# Drain logs back in with an OLD copy of Bingi saved; it must not overwrite the new one,
# and Drain should be brought up to date.
drain = w.login('Drain', 'ROGUE', data=appdata('ccc', 946_090, 946_090, 90_000, T0 + 30, 'drain'),
                saved=saved_drain, seed=7)
w.run(40)
check(drain.records()['bbb']['bal'] == 2_500_000, 'Drain\'s old copy of Bingi gets replaced by the newer one')
check(lenny.records()['bbb']['bal'] == 2_500_000, 'the old copy never overwrote anyone\'s newer one')

# Lenny logs in on an alt (same app, same id): one entry, now showing the alt.
saved_lenny = w.logout(lenny)
alt = w.login('Lennyalt', 'WARRIOR', data=appdata('aaa', 12345, 50000, 2601, T0 + 10, 'lenny'),
              saved=saved_lenny, seed=8)
w.run(40)
recs = chair.records()
check(sum(1 for r in recs.values() if r['salty'] == 'lenny') == 1, 'alts count once')
check(recs['aaa']['char'] == 'Lennyalt-Realm', 'the entry follows the character you last played')

# In a dungeon: nothing is sent; it all goes out once you leave.
alt.M.inInstance = True
mark = len(w.sent)
alt.ns.Sync.RequestNow()
w.run(15)
check(not any(s == 'Lennyalt' for s, _ in w.sent[mark:]), 'nothing sent from inside an instance')
alt.M.inInstance = False
w.run(10)
check(any(s == 'Lennyalt' for s, _ in w.sent[mark:]), 'queued messages go out after leaving the instance')

# The board, as Lennyalt sees it.
b = alt.board()
print('      board:', b)
check(b['title'] == 'Guild records', 'board title')
rich = b['sections'][0]
check(rich[0] == 'Richest', 'first section is Richest')
check([r[1] for r in rich[1]][:3] == ['Bingi', 'Drain', 'Chairman'], 'Richest top 3 in order')
check([r[0] for r in rich[1]][:3] == ['UI-GoldIcon', 'UI-SilverIcon', 'UI-CopperIcon'], 'gold, silver, bronze coins')
check(rich[1][0][2] == '$2.5M' and rich[1][1][2] == '$946K', 'values abbreviated like the bar ($2.5M, $946K)')
check(len(rich[1]) == 3, 'exactly a top 3 per category')
check(rich[2] == 'You: 4th', 'your own rank shown next to the title when you are below the top 3')
peak = b['sections'][1]
check(peak[1][0][1:] == ('Chairman', '$918B'), 'Peak balance leader')
check(b['side'] == 'right', 'panel attaches to the right of the TV')
check(b['footer'].startswith('Updates when'), 'footer explains when it updates')

# Hover a row: tooltip shows the SaltyBet name and how old the record is.
rows = [f for f in alt.M.frames.values() if f.parentUid == alt.lua.globals().SaltyTVBoard.uid and f.kind == 'Button' and f['name'] is not None]
rows[0].scripts.OnEnter(rows[0])
tip = list(alt.lua.globals().GameTooltip.lines.values())
print('      tooltip:', tip)
check('SaltyBet name: bingi' in tip and any(str(l).startswith('Updated ') for l in tip), 'tooltip: SaltyBet name + age')

# Someone who left the guild disappears from the board once the roster loads.
alt.M.roster = alt.lua.table_from(['Lennyalt-Realm', 'Bingi-Realm', 'Chairman-Realm'])
alt.M.fire('GUILD_ROSTER_UPDATE')
w.run(1)
names = [r[1] for r in alt.board()['sections'][0][1]]
check('Drain' not in names and 'Bingi' in names, 'members who left the guild are hidden')

# TV against the right edge: the panel opens on the left instead.
alt.lua.globals().SaltyTVFrame.right = 1800
alt.ns.Board.Toggle(False)
check(alt.board()['side'] == 'left', 'panel opens on the left when there is no room on the right')

# Not in a guild: just your own numbers, with a note.
solo = w.login('Solo', 'MAGE', guild=None, data=appdata('eee', 777, 900, 50, T0 + 5), seed=9)
w.run(10)
b = solo.board()
check([r[1] for r in b['sections'][0][1]] == ['Solo', '\u2014', '\u2014'] and 'not in a guild' in b['footer'], 'no guild: own numbers only')
check([r[0] for r in b['sections'][0][1]] == ['UI-GoldIcon', 'dim:UI-SilverIcon', 'dim:UI-CopperIcon'], 'empty 2nd/3rd spots keep their silver/copper coin, dimmed')
check(all(len(sec[1]) == 3 for sec in b['sections']), 'all three categories always show a top 3')

# No app data at all.
newbie = w.login('Newbie', 'PRIEST', guild=None, seed=10)
w.run(10)
tips = [p for p in newbie.M.prints.values() if 'free SaltyTV app' in str(p)]
check(len(tips) == 1, 'addon without the app: one chat tip saying where the stream comes from')
bingi_tips = [p for p in w.online[0].M.prints.values() if 'free SaltyTV app' in str(p)]
check(not bingi_tips, 'no tip for people who use the app')
b = jenny_board = newbie.board()
check(b['sections'][0][1] == [('dim:UI-GoldIcon', 'No records yet', ''), ('dim:UI-SilverIcon', '\u2014', ''), ('dim:UI-CopperIcon', '\u2014', '')] and 'SaltyTV app' in b['footer'], 'no app yet: empty top 3 with a hint')

# Sharing off: your record isn't broadcast.
quiet = w.login('Quiet', 'ROGUE', data=appdata('fff', 5555, 5555, 0, T0 + 5), seed=11)
quiet.ns.Sync.SetShare(False)
mark = len(w.sent)
w.run(30)
check(not any(m.startswith('R;fff;') for _, m in w.sent[mark:]), '/salty share off: your record is not sent')

# The data file the app writes loads in WoW's Lua.
sample = os.path.join(open('/tmp/saltytv-last-tmp').read().strip(), 'sample-data.lua') if os.path.exists('/tmp/saltytv-last-tmp') else None
if sample and os.path.exists(sample):
    L = lua51.LuaRuntime()
    L.execute(open(sample).read())
    d = L.globals().SaltyTV_AppData
    check(d.id == 'abc123' and d.balance == 13000 and d.saltyName == 'len"ny\\x', 'the app\'s SaltyTV_Data.lua loads in Lua 5.1')


# --------------------------------------------------------------------------
# The marker signal: centers turn yellow while dragging/resizing or with the map open.
sig = w.login('Signal', 'MAGE', data=appdata('sss', 1, 1, 0, T0 + 1), seed=12)
G = sig.lua.globals()
frames = list(sig.M.frames.values())
def centers():
    out = []
    for f in frames:
        c = f.colorTex
        # Lua tables are 1-based: c[1]=red, c[2]=green, c[3]=blue
        if f.kind == 'Texture' and c is not None and c[2] == 1 and c[3] == 0 and c[1] in (0, 1):
            out.append('yellow' if c[1] == 1 else 'green')
    return out
check(centers() == ['green'] * 4, 'markers start with green centers (show the stream)')
header = sig.ns.header
header.scripts.OnDragStart(header)
check(centers() == ['yellow'] * 4 and sig.ns.SignalHidden(), 'dragging the TV turns the centers yellow (hide)')
header.scripts.OnDragStop(header)
check(centers() == ['green'] * 4 and not sig.ns.SignalHidden(), 'letting go turns them green again')
grip = [f for f in frames if f.kind == 'Button' and f.parentUid == header.uid and f.scripts.OnMouseDown is not None][0]
grip.scripts.OnMouseDown(grip)
check(centers() == ['yellow'] * 4, 'resizing hides the stream too')
grip.scripts.OnMouseUp(grip)
check(centers() == ['green'] * 4, 'and shows it after')
G.SaltyTVDB.locked = True
header.scripts.OnDragStart(header)
check(centers() == ['green'] * 4, 'a locked TV does not move, so no signal')
G.SaltyTVDB.locked = False
header.scripts.OnDragStop(header)
sig.lua.execute('CreateFrame("Frame", "WorldMapFrame")')
sig.M.advance(0.3)
check(centers() == ['yellow'] * 4, 'opening the map hides the stream')
sig.lua.execute('WorldMapFrame:Hide()')
sig.M.advance(0.3)
check(centers() == ['green'] * 4, 'closing the map shows it again')
sig.lua.execute('CreateFrame("Frame", "GameMenuFrame")')
sig.M.advance(0.3)
check(centers() == ['yellow'] * 4, 'the game menu (Esc) hides it too')
sig.lua.execute('GameMenuFrame:Hide()')
sig.M.advance(0.3)

print('all sync/board simulations passed')
