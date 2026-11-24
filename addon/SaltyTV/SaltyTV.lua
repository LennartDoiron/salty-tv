-- SaltyTV: draws an in-game "TV" that the SaltyTV companion app finds on screen
-- and covers with the SaltyBet stream + betting bar.
--
-- Addons can't play video or reach the internet, so this addon only does two things:
--   1. Gives you a movable / resizable frame to decide where the stream goes.
--   2. Paints four markers (magenta squares) in the screen's corners. The
--      companion app watches the screen, finds the markers, and places its video
--      window inside them.
--
-- The markers' centers are also a tiny signal to the app: green = show the
-- stream, yellow = hide it for now (you're dragging/resizing the TV, or the map,
-- game menu, settings or a cinematic is open, which the stream would cover).
--
-- MARKER, CENTER and BEZEL are in *physical* pixels and must match
-- companion/ui/detector.js.
--
-- The guild leaderboard lives in Sync.lua (sharing) and Board.lua (the panel).

local ADDON, ns = ...

local MARKER = 14     -- marker square size
local CENTER = 6      -- colored center size (4px magenta stripe around it)
local BEZEL  = 18     -- the app leaves this many pixels uncovered around the edge
local HEADER = 18     -- header height in UI units (drag bar)

local SHOW = { 0, 1, 0 }   -- green center: show the stream
local HIDE = { 1, 1, 0 }   -- yellow center: hide it for now

-- Windows the stream would cover: hide it while any of these is open.
local COVERING_FRAMES = {
    "WorldMapFrame", "GameMenuFrame", "SettingsPanel", "InterfaceOptionsFrame",
    "VideoOptionsFrame", "CinematicFrame", "MovieFrame",
}

local DEFAULTS = { point = "CENTER", x = 0, y = 120, w = 480, h = 300, shown = true, locked = false }

local tv, screen, markers = nil, nil, {}
local hideFor = { dragging = false, resizing = false, covered = false }
local signalHidden = false

-- Convert physical pixels to UI units for a given region, so markers are crisp
-- squares of known size no matter what UI scale the player uses.
local function px(n, region)
    local _, physH = GetPhysicalScreenSize()
    return n * 768 / physH / region:GetEffectiveScale()
end

local function LayoutMarkers()
    if not screen then return end
    local m, c, inset = px(MARKER, screen), px(CENTER, screen), px((MARKER - CENTER) / 2, screen)
    local corners = { "TOPLEFT", "TOPRIGHT", "BOTTOMLEFT", "BOTTOMRIGHT" }
    for i, corner in ipairs(corners) do
        local mk = markers[i]
        mk.outer:ClearAllPoints()
        mk.outer:SetPoint(corner, screen, corner, 0, 0)
        mk.outer:SetSize(m, m)
        mk.inner:ClearAllPoints()
        mk.inner:SetPoint("TOPLEFT", mk.outer, "TOPLEFT", inset, -inset)
        mk.inner:SetSize(c, c)
    end
end

--- Turn the marker centers green (show) or yellow (hide) when the reasons change.
local function UpdateSignal()
    local hide = hideFor.dragging or hideFor.resizing or hideFor.covered
    if hide == signalHidden then return end
    signalHidden = hide
    local c = hide and HIDE or SHOW
    for _, mk in ipairs(markers) do mk.inner:SetColorTexture(c[1], c[2], c[3], 1) end
end

local function SetHideFor(reason, on)
    hideFor[reason] = on and true or false
    UpdateSignal()
end

local function AnyCoveringFrameOpen()
    for _, name in ipairs(COVERING_FRAMES) do
        local f = _G[name]
        if type(f) == "table" and f.IsVisible and f:IsVisible() then return true end
    end
    return false
end

local function SavePosition()
    local point, _, _, x, y = tv:GetPoint(1)
    SaltyTVDB.point, SaltyTVDB.x, SaltyTVDB.y = point, x, y
    SaltyTVDB.w, SaltyTVDB.h = tv:GetWidth(), tv:GetHeight()
end

local function MakeTexture(parent, layer, sublevel, r, g, b, a)
    local t = parent:CreateTexture(nil, layer, nil, sublevel)
    t:SetColorTexture(r, g, b, a or 1)
    t:SetSnapToPixelGrid(true)
    t:SetTexelSnappingBias(0)
    return t
end

local function Build()
    tv = CreateFrame("Frame", "SaltyTVFrame", UIParent)
    tv:SetFrameStrata("MEDIUM")
    tv:SetClampedToScreen(true)
    tv:SetMovable(true)
    tv:SetResizable(true)
    tv:SetResizeBounds(320, 200, 1600, 1000)
    tv:SetPoint(SaltyTVDB.point, UIParent, SaltyTVDB.point, SaltyTVDB.x, SaltyTVDB.y)
    tv:SetSize(SaltyTVDB.w, SaltyTVDB.h)

    -- Header / drag bar
    local header = CreateFrame("Frame", nil, tv)
    header:SetPoint("TOPLEFT")
    header:SetPoint("TOPRIGHT")
    header:SetHeight(HEADER)
    MakeTexture(header, "BACKGROUND", 0, 0.08, 0.08, 0.1, 0.95):SetAllPoints()
    local title = header:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    title:SetPoint("LEFT", 6, 0)
    title:SetText("|cffff4444Salty|r|cff4488ffTV|r")
    header:EnableMouse(true)
    header:RegisterForDrag("LeftButton")
    header:SetScript("OnDragStart", function()
        if SaltyTVDB.locked then return end
        SetHideFor("dragging", true) -- the app hides the stream until you let go
        tv:StartMoving()
    end)
    header:SetScript("OnDragStop", function()
        tv:StopMovingOrSizing()
        SavePosition()
        SetHideFor("dragging", false)
    end)

    -- Resize handle lives in the header so it never covers a marker
    local grip = CreateFrame("Button", nil, header)
    grip:SetSize(16, 16)
    grip:SetPoint("RIGHT", -2, 0)
    grip:SetNormalTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Up")
    grip:SetHighlightTexture("Interface\\ChatFrame\\UI-ChatIM-SizeGrabber-Highlight")
    grip:SetScript("OnMouseDown", function()
        if SaltyTVDB.locked then return end
        SetHideFor("resizing", true)
        tv:StartSizing("BOTTOMRIGHT")
    end)
    grip:SetScript("OnMouseUp", function()
        tv:StopMovingOrSizing()
        SavePosition()
        SetHideFor("resizing", false)
    end)
    ns.tv, ns.header = tv, header

    -- The "screen" the companion app covers
    screen = CreateFrame("Frame", nil, tv)
    screen:SetPoint("TOPLEFT", 0, -HEADER)
    screen:SetPoint("BOTTOMRIGHT")
    MakeTexture(screen, "BACKGROUND", 0, 0, 0, 0, 1):SetAllPoints()

    local hint = screen:CreateFontString(nil, "ARTWORK", "GameFontDisable")
    hint:SetPoint("CENTER")
    hint:SetText("The stream shows up here with the free SaltyTV app\n(link on SaltyTV's CurseForge page).\nWoW must be in Windowed or Maximized mode.")

    for i = 1, 4 do
        markers[i] = {
            outer = MakeTexture(screen, "OVERLAY", 0, 1, 0, 1, 1),                 -- magenta
            inner = MakeTexture(screen, "OVERLAY", 1, SHOW[1], SHOW[2], SHOW[3], 1), -- green
        }
    end
    LayoutMarkers()
    screen:SetScript("OnSizeChanged", LayoutMarkers)

    -- hide the stream while the map, game menu, settings or a cinematic is open
    C_Timer.NewTicker(0.15, function() SetHideFor("covered", AnyCoveringFrameOpen()) end)

    tv:SetShown(SaltyTVDB.shown)
    if ns.OnTVBuilt then ns.OnTVBuilt(tv, header) end -- the leaderboard button and panel (Board.lua)
end

--- For the tests and the leaderboard: is the stream currently asked to hide?
function ns.SignalHidden() return signalHidden end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("UI_SCALE_CHANGED")
events:RegisterEvent("DISPLAY_SIZE_CHANGED")
events:SetScript("OnEvent", function(_, event, name)
    if event == "ADDON_LOADED" and name == "SaltyTV" then
        SaltyTVDB = SaltyTVDB or {}
        for k, v in pairs(DEFAULTS) do
            if SaltyTVDB[k] == nil then SaltyTVDB[k] = v end
        end
        if SaltyTVDB.share == nil then SaltyTVDB.share = true end -- share your numbers with the guild
        -- Installed from CurseForge but never used the app: say once where the stream comes from.
        if not SaltyTV_AppData and not SaltyTVDB.appHintShown then
            SaltyTVDB.appHintShown = true
            C_Timer.After(8, function()
                print("|cffff4444Salty|r|cff4488ffTV|r: the stream and betting come from the free SaltyTV app " ..
                    "(link on SaltyTV's CurseForge page). Type /salty help for commands.")
            end)
        end
        SaltyTVDB.guilds = SaltyTVDB.guilds or {}                   -- leaderboard records, per guild
        Build()
    elseif tv then
        LayoutMarkers()
    end
end)

SLASH_SALTYTV1 = "/salty"
SLASH_SALTYTV2 = "/saltytv"
SlashCmdList.SALTYTV = function(msg)
    msg = strlower(strtrim(msg or ""))
    if not tv then return end
    if msg == "board" then
        if ns.Board then ns.Board.Toggle() end
    elseif msg == "share on" or msg == "share off" then
        if ns.Sync then ns.Sync.SetShare(msg == "share on") end
    elseif msg == "sync" then
        if ns.Sync then ns.Sync.RequestNow() end
    elseif msg == "debug" then
        if ns.Sync then ns.Sync.Debug() end
    elseif msg == "help" then
        print("SaltyTV: /salty (show/hide), /salty lock, /salty reset, /salty board, /salty share on|off, /salty sync, /salty debug")
    elseif msg == "lock" then
        SaltyTVDB.locked = not SaltyTVDB.locked
        print("SaltyTV " .. (SaltyTVDB.locked and "locked" or "unlocked"))
    elseif msg == "reset" then
        for k, v in pairs(DEFAULTS) do SaltyTVDB[k] = v end
        tv:ClearAllPoints()
        tv:SetPoint(DEFAULTS.point, UIParent, DEFAULTS.point, DEFAULTS.x, DEFAULTS.y)
        tv:SetSize(DEFAULTS.w, DEFAULTS.h)
        tv:Show()
    else
        SaltyTVDB.shown = not tv:IsShown()
        tv:SetShown(SaltyTVDB.shown)
    end
end
