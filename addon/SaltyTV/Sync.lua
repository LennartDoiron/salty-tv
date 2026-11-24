-- SaltyTV guild sync: shares everyone's SaltyBet numbers with guildmates over
-- WoW's hidden addon channel and keeps a merged copy for the leaderboard.
--
-- Your own numbers come from the SaltyTV app, which writes them into the
-- SaltyTV_Data addon (the SaltyTV_AppData table). WoW reads that file when you
-- log in or /reload, so your row updates then.
--
-- Messages (GUILD channel, prefix "SaltyTV", fields separated by ";"):
--   R;id;char;class;salty;bal;peak;win;t   one player's record; the highest t wins
--   Q;1                                    "I just logged in, please share"
-- Everyone who hears Q queues every record they know with a random delay, and
-- drops a queued record as soon as someone else broadcasts it. That way each
-- record is usually sent once per request, not once per guildmate.

local ADDON, ns = ...
local Sync = {}
ns.Sync = Sync

local PREFIX = "SaltyTV"
local SEND_GAP = 0.5               -- seconds between our messages (well under Blizzard's throttle)
local QUERY_COOLDOWN = 60          -- answer each guildmate's share request at most once a minute
local PRUNE_AFTER = 180 * 86400    -- forget records nobody has updated in ~6 months
local MAX_TRIES = 5

local guildName, guildKey, me, myFull
local pendingById = {}             -- id -> { due = GetTime(), t = version }
local outbox = {}                  -- { msg = "...", tries = n, id = record id, t = version }
local nextSendAt = 0
local lastQueryFrom = {}           -- sender -> GetTime() of the last share request we answered
local started, dirty = false, false
local roster, rosterNames          -- sets of "Name-Realm" / "name" in the guild, or nil if not loaded
local debugOn = false

local function dbg(...)
    if debugOn then print("|cff8888ffSaltyTV sync|r:", ...) end
end

-- "MirageRaceway": the realm part of "Name-Realm". Falls back to the plain realm
-- name if WoW doesn't have the normalized one yet.
local function RealmName()
    local r = GetNormalizedRealmName and GetNormalizedRealmName()
    if (not r or r == "") and GetRealmName then r = (GetRealmName() or ""):gsub("[%s%-]", "") end
    return r or ""
end

local function BaseName(full)
    return (tostring(full or ""):match("^([^%-]+)") or ""):lower()
end

-- Classic-style clients only know your guild's name after the roster was requested.
local function RequestRoster()
    if C_GuildInfo and C_GuildInfo.GuildRoster then C_GuildInfo.GuildRoster()
    elseif GuildRoster then GuildRoster() end
end

---------------------------------------------------------------------------
-- encoding
---------------------------------------------------------------------------
local function esc(s)
    return (tostring(s or ""):gsub("%%", "%%25"):gsub(";", "%%3B"))
end

local function unesc(s)
    return (s:gsub("%%3B", ";"):gsub("%%25", "%%"))
end

local function split(s)
    local out = {}
    for part in (s .. ";"):gmatch("([^;]*);") do out[#out + 1] = part end
    return out
end

local function int(v)
    local n = tonumber(v)
    if not n or n ~= n or n < 0 or n == math.huge then return nil end
    return math.floor(n)
end

function Sync.Encode(r)
    return table.concat({ "R", esc(r.id), esc(r.char), esc(r.class), esc(r.salty),
        string.format("%.0f", r.bal), string.format("%.0f", r.peak), string.format("%.0f", r.win),
        string.format("%.0f", r.t) }, ";")
end

function Sync.Decode(msg)
    local f = split(msg)
    if f[1] ~= "R" or #f < 9 then return nil end
    local r = {
        id = unesc(f[2]), char = unesc(f[3]), class = unesc(f[4]), salty = unesc(f[5]),
        bal = int(f[6]), peak = int(f[7]), win = int(f[8]), t = int(f[9]),
    }
    if r.id == "" or r.char == "" or not (r.bal and r.peak and r.win and r.t) or r.t <= 0 then return nil end
    if r.class == "" then r.class = nil end
    if r.salty == "" then r.salty = nil end
    return r
end

--- Keep the newest version of each player's record. Returns true if store changed.
function Sync.Merge(store, r)
    local cur = store[r.id]
    if cur and cur.t >= r.t then return false end
    store[r.id] = r
    return true
end

---------------------------------------------------------------------------
-- state
---------------------------------------------------------------------------
local function Store()
    if not guildKey or not SaltyTVDB then return nil end
    SaltyTVDB.guilds = SaltyTVDB.guilds or {}
    SaltyTVDB.guilds[guildKey] = SaltyTVDB.guilds[guildKey] or {}
    return SaltyTVDB.guilds[guildKey]
end

local function Changed() dirty = true end

local function AppData()
    local d = SaltyTV_AppData
    if type(d) ~= "table" or type(d.id) ~= "string" or d.id == "" or not int(d.updated) then return nil end
    return d
end

--- Your own record, built from what the SaltyTV app wrote.
local function BuildMine()
    local d = AppData()
    if not d or not myFull then return nil end
    local _, class = UnitClass("player")
    return {
        id = d.id, char = myFull, class = class,
        salty = type(d.saltyName) == "string" and d.saltyName ~= "" and d.saltyName or nil,
        bal = int(d.balance) or 0, peak = int(d.peak) or 0, win = int(d.biggestWin) or 0,
        t = int(d.updated),
    }
end

---------------------------------------------------------------------------
-- sending
---------------------------------------------------------------------------
local function CanSend()
    if not IsInGuild() then return false end
    if IsInInstance() then return false end -- addon messages are blocked in instances on this client
    if C_ChatInfo.InChatMessagingLockdown then
        local ok, locked = pcall(C_ChatInfo.InChatMessagingLockdown)
        if ok and locked then return false end
    end
    return true
end

local function Queue(msg, id, t)
    outbox[#outbox + 1] = { msg = msg, tries = 0, id = id, t = t }
end

-- Someone else just sent this record: don't send our copy too.
local function Unqueue(id, t)
    local p = pendingById[id]
    if p and t >= p.t then pendingById[id] = nil end
    for i = #outbox, 1, -1 do
        local item = outbox[i]
        if item.id == id and t >= item.t then table.remove(outbox, i) end
    end
end

local function Schedule(id, minDelay, maxDelay)
    local store = Store()
    local r = store and store[id]
    if not r then return end
    local due = GetTime() + minDelay + math.random() * (maxDelay - minDelay)
    local p = pendingById[id]
    if p and p.due <= due and p.t >= r.t then return end -- already queued, sooner
    pendingById[id] = { due = due, t = r.t }
end

local function Tick()
    local now = GetTime()
    local store = Store()
    if store then
        for id, p in pairs(pendingById) do
            if p.due <= now then
                pendingById[id] = nil
                local r = store[id]
                if r then Queue(Sync.Encode(r), r.id, r.t) end
            end
        end
    end

    if outbox[1] and now >= nextSendAt and CanSend() then
        local item = table.remove(outbox, 1)
        local ok, res = pcall(C_ChatInfo.SendAddonMessage, PREFIX, item.msg, "GUILD")
        dbg("sent", item.msg:sub(1, 1), item.id or "", "->", ok and tostring(res) or ("error: " .. tostring(res)))
        if ok and (res == nil or res == true or res == 0) then
            nextSendAt = now + SEND_GAP
        else
            item.tries = item.tries + 1
            if item.tries < MAX_TRIES then table.insert(outbox, 1, item) end
            nextSendAt = now + 2 -- throttled or blocked: back off a little
        end
    end

    if dirty then
        dirty = false
        if ns.Board then ns.Board.Refresh() end
    end
end

---------------------------------------------------------------------------
-- receiving
---------------------------------------------------------------------------
local function OnAddonMessage(prefix, text, channel, sender)
    if prefix ~= PREFIX then return end
    dbg("got", tostring(text):sub(1, 1), "from", tostring(sender), "on", tostring(channel))
    if channel ~= "GUILD" or type(text) ~= "string" then return end
    local store = Store()
    if not store then dbg("  ignored: not connected to the guild yet") return end
    if type(sender) == "string" and not sender:find("-", 1, true) then
        sender = sender .. "-" .. RealmName()
    end
    local fromMe = sender == myFull

    local kind = text:sub(1, 2)
    if kind == "R;" then
        local r = Sync.Decode(text)
        if not r then dbg("  couldn't read it") return end
        if not fromMe then Unqueue(r.id, r.t) end -- someone already shared it
        local cur = store[r.id]
        if cur and cur.t > r.t then
            if not fromMe then Schedule(r.id, 2, 8) end -- they have an old copy: share ours
        elseif Sync.Merge(store, r) then
            Changed()
        end
    elseif kind == "Q;" and not fromMe then
        local last = lastQueryFrom[sender]
        if last and GetTime() - last < QUERY_COOLDOWN then return end -- they're asking too often
        lastQueryFrom[sender] = GetTime()
        for id in pairs(store) do Schedule(id, 1, 12) end
    end
end

---------------------------------------------------------------------------
-- your own record
---------------------------------------------------------------------------
local function ShareMine()
    local store = Store()
    local mine = BuildMine()
    if not (store and mine) then return end
    local cur = store[mine.id]
    if cur and cur.t >= mine.t then
        -- same numbers as before; if you're on another character, show this one
        if cur.char ~= mine.char or cur.class ~= mine.class then
            mine.t = cur.t + 1
        else
            mine = nil
        end
    end
    if mine then
        store[mine.id] = mine
        Changed()
    end
    if SaltyTVDB.share ~= false then Schedule((mine or cur).id, 2, 6) end
end

local function Prune()
    local store = Store()
    if not store then return end
    local cutoff = time() - PRUNE_AFTER
    for id, r in pairs(store) do
        if type(r) ~= "table" or not int(r.t) or r.t < cutoff then store[id] = nil end
    end
end

local function UpdateRoster()
    local n = GetNumGuildMembers and GetNumGuildMembers() or 0
    if not n or n == 0 then roster, rosterNames = nil, nil return end
    local set, names, realm = {}, {}, RealmName()
    for i = 1, n do
        local name = GetGuildRosterInfo(i)
        if type(name) == "string" then
            if not name:find("-", 1, true) then name = name .. "-" .. realm end
            set[name] = true
            names[BaseName(name)] = true -- realms can be written differently; names can't
        end
    end
    roster, rosterNames = set, names
    Changed()
end

local function Start()
    local gName, _, _, gRealm = GetGuildInfo("player")
    me = UnitName("player")
    local realm = RealmName()
    myFull = me and realm ~= "" and (me .. "-" .. realm) or nil
    if not gName or not myFull then
        guildName, guildKey, started = nil, nil, false
        if IsInGuild() then
            RequestRoster() -- so WoW looks up the guild; we try again in a few seconds
            dbg("waiting for WoW's guild info")
        end
        Changed()
        return
    end
    if started and gName == guildName then return end
    started, guildName = true, gName
    guildKey = gName .. "-" .. (gRealm or realm)
    wipe(pendingById)
    Prune()
    ShareMine()
    C_Timer.After(4 + math.random() * 4, function() Queue("Q;1") end)
    RequestRoster()
    dbg("connected to", guildKey, "as", myFull)
    Changed()
end

---------------------------------------------------------------------------
-- for the leaderboard panel
---------------------------------------------------------------------------
--- All records to show: your guild's, minus people who left; or just yours if you're not in a guild.
function Sync.Records()
    local list = {}
    local store = Store()
    if store then
        for _, r in pairs(store) do
            if not roster or roster[r.char] or rosterNames[BaseName(r.char)]
                or (AppData() and r.id == AppData().id) then
                list[#list + 1] = r
            end
        end
    else
        local mine = BuildMine()
        if mine then list[1] = mine end
    end
    return list
end

--- Records with field > 0, best first.
function Sync.Ranked(list, field)
    local out = {}
    for _, r in ipairs(list) do
        if (r[field] or 0) > 0 then out[#out + 1] = r end
    end
    table.sort(out, function(a, b)
        if a[field] ~= b[field] then return a[field] > b[field] end
        return (a.char or "") < (b.char or "")
    end)
    return out
end

function Sync.MyId()
    local d = AppData()
    return d and d.id or nil
end

--- "ok", "noguild", "waiting" (in a guild, still connecting), "nodata" (no SaltyTV_Data yet)
--- or "off" (sharing turned off)
function Sync.Status()
    if not AppData() then return "nodata" end
    if not guildKey then return IsInGuild() and "waiting" or "noguild" end
    if SaltyTVDB.share == false then return "off" end
    return "ok"
end

function Sync.SetShare(on)
    SaltyTVDB.share = on and true or false
    print("SaltyTV: sharing your SaltyBet numbers with your guild is " .. (on and "on" or "off") .. ".")
    if on then ShareMine() end
    Changed()
end

--- /salty debug: what the guild sync is doing, and log its messages to chat (again to stop).
function Sync.Debug()
    debugOn = not debugOn
    local count = function(t) local n = 0 for _ in pairs(t or {}) do n = n + 1 end return n end
    local inInstance = IsInInstance()
    print(("|cff8888ffSaltyTV sync|r: in a guild: %s | connected: %s | you: %s | app numbers: %s | sharing: %s"):format(
        tostring(IsInGuild()), tostring(guildKey or "no"), tostring(myFull), AppData() and "yes" or "no",
        SaltyTVDB.share == false and "off" or "on"))
    print(("|cff8888ffSaltyTV sync|r: records stored: %d | shown: %d | roster: %d | waiting to send: %d | in an instance: %s"):format(
        count(Store()), #Sync.Records(), count(roster), #outbox + count(pendingById), tostring(inInstance)))
    print("|cff8888ffSaltyTV sync|r: message log " .. (debugOn and "ON (type /salty debug again to stop)" or "off"))
    if debugOn and guildKey then Sync.RequestNow() end
end

function Sync.RequestNow()
    if not guildKey then print("SaltyTV: you're not in a guild.") return end
    Queue("Q;1")
    ShareMine()
    print("SaltyTV: asking your guild for leaderboard records…")
end

---------------------------------------------------------------------------
-- events
---------------------------------------------------------------------------
if C_ChatInfo and C_ChatInfo.RegisterAddonMessagePrefix then
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:RegisterEvent("PLAYER_GUILD_UPDATE")
events:RegisterEvent("GUILD_ROSTER_UPDATE")
events:RegisterEvent("CHAT_MSG_ADDON")
events:SetScript("OnEvent", function(_, event, ...)
    if event == "CHAT_MSG_ADDON" then
        local ok = pcall(OnAddonMessage, ...)
        if not ok then return end
    elseif event == "PLAYER_LOGIN" then
        if IsInGuild() then RequestRoster() end
        C_Timer.After(3, Start) -- guild info isn't always ready right at login
    elseif event == "PLAYER_GUILD_UPDATE" then
        Start()
    elseif event == "GUILD_ROSTER_UPDATE" then
        if not started then Start() end
        UpdateRoster()
    end
end)

C_Timer.NewTicker(0.25, Tick)
-- still not connected to the guild (WoW was slow with the guild info)? keep trying
C_Timer.NewTicker(5, function() if not started and IsInGuild() then Start() end end)
