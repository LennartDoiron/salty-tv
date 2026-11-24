-- A fake WoW API, just enough to run SaltyTV's Lua outside the game (tests only).
MOCK = {
    now = 0, epoch = 1700000000,
    timers = {}, events = {}, outbox = {}, prints = {}, frames = {},
    player = "Player", realm = "Realm", class = "MAGE",
    guild = nil, guildRealm = nil, roster = nil, inInstance = false,
    uiRight = 1920,
}

local noop = function() end
local Obj = {}
-- Unknown WoW-style methods (CamelCase) are no-ops; unknown fields are nil.
Obj.__index = function(_, k)
    local v = rawget(Obj, k)
    if v ~= nil then return v end
    if type(k) == "string" and k:match("^%u") then return noop end
    return nil
end

local function new(kind, name, parent)
    local o = setmetatable({ kind = kind, frameName = name, parent = parent, scripts = {}, shown = true, points = {} }, Obj)
    o.uid = #MOCK.frames + 1
    o.parentUid = parent and parent.uid or 0
    if name then _G[name] = o end
    table.insert(MOCK.frames, o)
    return o
end

function Obj:SetScript(n, f) self.scripts[n] = f end
function Obj:GetScript(n) return self.scripts[n] end
function Obj:HookScript(n, f)
    local old = self.scripts[n]
    self.scripts[n] = function(...) if old then old(...) end return f(...) end
end
function Obj:RegisterEvent(e) MOCK.events[e] = MOCK.events[e] or {}; table.insert(MOCK.events[e], self) end
function Obj:Show() self.shown = true end
function Obj:Hide() self.shown = false end
function Obj:SetShown(v) self.shown = v and true or false end
function Obj:IsShown() return self.shown end
function Obj:IsVisible()
    local o = self
    while o do if not o.shown then return false end o = o.parent end
    return true
end
function Obj:SetText(t) self.text = t end
function Obj:GetText() return self.text end
function Obj:SetTexture(t) self.texture = t end
function Obj:SetAlpha(a) self.alpha = a end
function Obj:SetNormalTexture(t) self.texture = t end
function Obj:SetTextColor(r, g, b) self.color = { r, g, b } end
function Obj:SetColorTexture(r, g, b, a) self.colorTex = { r, g, b, a } end
function Obj:CreateTexture() return new("Texture", nil, self) end
function Obj:CreateFontString() return new("FontString", nil, self) end
function Obj:ClearAllPoints() self.points = {} end
function Obj:SetPoint(...) table.insert(self.points, { ... }) end
function Obj:SetWidth(w) self.width = w end
function Obj:SetHeight(h) self.height = h end
function Obj:SetSize(w, h) self.width, self.height = w, h end
function Obj:GetWidth() return self.width or 0 end
function Obj:GetHeight() return self.height or 0 end
function Obj:GetRight() return self.right end
function Obj:GetPoint() return "CENTER", nil, "CENTER", 0, 0 end
function Obj:GetEffectiveScale() return 1 end

function CreateFrame(kind, name, parent) return new(kind, name, parent) end
UIParent = new("Frame", "UIParent")
function UIParent:GetRight() return MOCK.uiRight end

GameTooltip = new("GameTooltip", "GameTooltip")
GameTooltip.lines = {}
function GameTooltip:SetOwner() self.lines = {} end
function GameTooltip:AddLine(t) table.insert(self.lines, t) end
function GameTooltip:AddDoubleLine(a, b) table.insert(self.lines, a .. ": " .. b) end

-- timers on a fake clock
C_Timer = {}
function C_Timer.After(sec, fn) table.insert(MOCK.timers, { due = MOCK.now + sec, fn = fn }) end
function C_Timer.NewTicker(sec, fn)
    local t = { due = MOCK.now + sec, every = sec, fn = fn }
    table.insert(MOCK.timers, t)
    return t
end
function MOCK.advance(dt)
    local target = MOCK.now + dt
    while true do
        local best, idx
        for i, t in ipairs(MOCK.timers) do
            if t.due <= target and (not best or t.due < best.due) then best, idx = t, i end
        end
        if not best then break end
        MOCK.now = math.max(MOCK.now, best.due)
        if best.every then best.due = best.due + best.every else table.remove(MOCK.timers, idx) end
        best.fn()
    end
    MOCK.now = target
end

function MOCK.fire(event, ...)
    for _, f in ipairs(MOCK.events[event] or {}) do
        local s = f.scripts.OnEvent
        if s then s(f, event, ...) end
    end
end

-- addon messages: collected here, delivered by the test harness
C_ChatInfo = {}
function C_ChatInfo.RegisterAddonMessagePrefix() return true end
function C_ChatInfo.SendAddonMessage(prefix, msg, chan)
    assert(#prefix <= 16, "prefix too long")
    assert(#msg <= 255, "addon message over 255 bytes: " .. #msg)
    assert(not MOCK.inInstance, "sent an addon message inside an instance")
    table.insert(MOCK.outbox, { prefix, msg, chan })
    return 0 -- Enum.SendAddonMessageResult.Success
end

function GetTime() return MOCK.now end
function time() return MOCK.epoch + math.floor(MOCK.now) end
function GetGuildInfo()
    if not MOCK.guild then return nil end
    return MOCK.guild, "Member", 1, MOCK.guildRealm
end
function IsInGuild() return MOCK.guild ~= nil end
function UnitName() return MOCK.player end
function GetNormalizedRealmName() return MOCK.realm end
function UnitClass() return "Class", MOCK.class, 1 end
function IsInInstance() return MOCK.inInstance, MOCK.inInstance and "party" or "none" end
function GetNumGuildMembers() return MOCK.roster and #MOCK.roster or 0 end
function GetGuildRosterInfo(i) return MOCK.roster[i] end
C_GuildInfo = { GuildRoster = function() end }
RAID_CLASS_COLORS = {
    MAGE = { r = 0.25, g = 0.78, b = 0.92 }, WARRIOR = { r = 0.78, g = 0.61, b = 0.43 },
    ROGUE = { r = 1, g = 0.96, b = 0.41 }, PRIEST = { r = 1, g = 1, b = 1 }, HUNTER = { r = 0.67, g = 0.83, b = 0.45 },
}
function GetPhysicalScreenSize() return 1920, 1080 end
SlashCmdList = {}
strlower = string.lower
function strtrim(s) return (s:gsub("^%s+", ""):gsub("%s+$", "")) end
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
format = string.format
function print(...)
    local parts = {}
    for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
    table.insert(MOCK.prints, table.concat(parts, " "))
end

-- SavedVariables round trip (what WoW does at logout/login)
function MOCK.serialize(v)
    local t = type(v)
    if t == "table" then
        local keys = {}
        for k in pairs(v) do keys[#keys + 1] = k end
        table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
        local parts = {}
        for _, k in ipairs(keys) do
            parts[#parts + 1] = "[" .. MOCK.serialize(k) .. "]=" .. MOCK.serialize(v[k])
        end
        return "{" .. table.concat(parts, ",") .. "}"
    elseif t == "string" then
        return string.format("%q", v)
    else
        return tostring(v)
    end
end
