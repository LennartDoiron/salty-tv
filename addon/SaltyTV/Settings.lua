-- SaltyTV settings: a panel next to the TV (gear button on the TV's header,
-- /salty settings, or Shift-click the minimap button), and the same options in
-- the game's Options > AddOns > SaltyTV.
--
-- The panel sits beside the TV like Guild records, because the app draws the
-- stream on top of everything inside the TV. With the TV closed it opens in
-- the middle of the screen.

local ADDON, ns = ...
local S = {}
ns.Settings = S

local WIDTH, PAD = 300, 12
local ROW = 24
local GEAR = "Interface\\Icons\\INV_Misc_Gear_01"

local tv, panel
local views = {} -- every built copy of the options (the panel, Options > AddOns)

---------------------------------------------------------------------------
-- the options
---------------------------------------------------------------------------
local function MinimapHidden() return SaltyTVDB.minimap and SaltyTVDB.minimap.hide end

-- kind: "check" (get/set) or "radio" (value of SaltyTVDB[key])
local OPTIONS = {
    { section = "The TV" },
    { key = "locked", label = "Lock it in place",
      get = function() return SaltyTVDB.locked end,
      set = function(v) SaltyTVDB.locked = v end },
    { key = "minimap", label = "Show the minimap button",
      get = function() return not MinimapHidden() end,
      set = function(v) if ns.Minimap then ns.Minimap.SetHidden(not v) end end },

    { section = "Open or close it for me" },
    { key = "flightOpen", label = "Open it on flight paths, close it when I land",
      get = function() return SaltyTVDB.flightOpen end,
      set = function(v) SaltyTVDB.flightOpen = v end },
    { key = "combatHide", label = "Hide it during combat",
      get = function() return SaltyTVDB.combatHide end,
      set = function(v) SaltyTVDB.combatHide = v end },
    { key = "instanceHide", label = "Hide it in dungeons, raids and PvP",
      get = function() return SaltyTVDB.instanceHide end,
      set = function(v) SaltyTVDB.instanceHide = v; if ns.CheckInstance then ns.CheckInstance() end end },

    { section = "When the world map is open" },
    { key = "map_hide", radio = "mapMode", value = "hide", label = "Hide the stream, keep the sound" },
    { key = "map_show", radio = "mapMode", value = "show", label = "Keep showing it, on top of the map" },
    { key = "map_pause", radio = "mapMode", value = "pause", label = "Pause it" },

    { section = "Guild records" },
    { key = "share", label = "Share my numbers with my guild",
      get = function() return SaltyTVDB.share end,
      set = function(v) if ns.Sync then ns.Sync.SetShare(v) else SaltyTVDB.share = v end end },
}

---------------------------------------------------------------------------
-- widgets (plain textures, no templates that change between game versions)
---------------------------------------------------------------------------
local function Label(parent, button, text)
    local fs = parent:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    fs:SetPoint("LEFT", button, "RIGHT", 4, 0)
    fs:SetJustifyH("LEFT")
    fs:SetText(text)
    button:SetHitRectInsets(0, -(WIDTH - 2 * PAD - 30), 0, 0) -- clicking the words works too
    return fs
end

local function CheckBox(parent, text)
    local cb = CreateFrame("CheckButton", nil, parent)
    cb:SetSize(24, 24)
    cb:SetNormalTexture("Interface\\Buttons\\UI-CheckBox-Up")
    cb:SetPushedTexture("Interface\\Buttons\\UI-CheckBox-Down")
    cb:SetHighlightTexture("Interface\\Buttons\\UI-CheckBox-Highlight", "ADD")
    cb:SetCheckedTexture("Interface\\Buttons\\UI-CheckBox-Check")
    cb.label = Label(parent, cb, text)
    return cb
end

local RADIO = "Interface\\Buttons\\UI-RadioButton" -- four 16x16 states side by side
local function Radio(parent, text)
    local rb = CreateFrame("CheckButton", nil, parent)
    rb:SetSize(16, 16)
    local function part(set, left, right)
        local t = rb:CreateTexture()
        t:SetTexture(RADIO)
        t:SetTexCoord(left, right, 0, 1)
        t:SetAllPoints()
        set(rb, t)
        return t
    end
    part(rb.SetNormalTexture, 0, 0.25)
    part(rb.SetCheckedTexture, 0.25, 0.5)
    part(rb.SetHighlightTexture, 0.5, 0.75)
    rb.label = Label(parent, rb, text)
    return rb
end

local function Button(parent, text, width, onClick)
    local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
    b:SetSize(width, 22)
    b:SetText(text)
    b:SetScript("OnClick", onClick)
    return b
end

--- Builds the options into a frame; returns how tall they are.
local function BuildOptions(parent, top)
    local view = { widgets = {} }
    local y = top
    for _, o in ipairs(OPTIONS) do
        if o.section then
            y = y - 8
            local h = parent:CreateFontString(nil, "ARTWORK", "GameFontNormal")
            h:SetPoint("TOPLEFT", PAD, y)
            h:SetText(o.section)
            h:SetTextColor(1, 0.5, 0.1)
            y = y - 18
        elseif o.radio then
            local rb = Radio(parent, o.label)
            rb:SetPoint("TOPLEFT", PAD + 4, y - 3)
            rb:SetScript("OnClick", function()
                SaltyTVDB[o.radio] = o.value
                S.Refresh()
            end)
            rb.option = o
            view.widgets[o.key] = rb
            y = y - 21
        else
            local cb = CheckBox(parent, o.label)
            cb:SetPoint("TOPLEFT", PAD, y)
            cb:SetScript("OnClick", function(self)
                o.set(self:GetChecked() and true or false)
                S.Refresh()
            end)
            cb.option = o
            view.widgets[o.key] = cb
            y = y - ROW
        end
    end
    y = y - 10
    view.reset = Button(parent, "Reset the TV's spot and size", WIDTH - 2 * PAD, function() if ns.ResetTV then ns.ResetTV() end end)
    view.reset:SetPoint("TOPLEFT", PAD, y)
    y = y - 22 - 8
    local tip = parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    tip:SetPoint("TOPLEFT", PAD, y)
    tip:SetWidth(WIDTH - 2 * PAD)
    tip:SetJustifyH("LEFT")
    tip:SetText("Also in Options > AddOns > SaltyTV, and /salty settings.")
    y = y - 14
    table.insert(views, view)
    return -y + PAD
end

--- Updates every copy of the checkboxes from the saved settings.
function S.Refresh()
    for _, view in ipairs(views) do
        for _, w in pairs(view.widgets) do
            local o = w.option
            if o.radio then
                w:SetChecked(SaltyTVDB[o.radio] == o.value)
            else
                w:SetChecked(o.get() and true or false)
            end
        end
    end
end

--- For the tests: the panel's checkbox or radio button for an option key.
function S.Widget(key) return views[1] and views[1].widgets[key] end

---------------------------------------------------------------------------
-- the panel next to the TV
---------------------------------------------------------------------------
local function Anchor()
    if not panel then return end
    panel:ClearAllPoints()
    if not (tv and tv:IsShown()) then
        panel:SetPoint("CENTER", UIParent, "CENTER", 0, 60)
        return
    end
    local right, screen = tv:GetRight(), UIParent:GetRight()
    if right and screen and right + WIDTH + 6 > screen then
        panel:SetPoint("TOPRIGHT", tv, "TOPLEFT", -4, 0) -- no room on the right
    else
        panel:SetPoint("TOPLEFT", tv, "TOPRIGHT", 4, 0)
    end
end
S.Anchor = Anchor

local function Build()
    panel = CreateFrame("Frame", "SaltyTVSettings", UIParent, "BackdropTemplate")
    panel:SetWidth(WIDTH)
    panel:SetFrameStrata("DIALOG")
    panel:SetClampedToScreen(true)
    panel:EnableMouse(true)
    panel:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 14,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    panel:SetBackdropColor(0.04, 0.04, 0.06, 0.96)
    panel:SetBackdropBorderColor(0.45, 0.45, 0.5, 1)

    local icon = panel:CreateTexture(nil, "ARTWORK")
    icon:SetSize(20, 20)
    icon:SetPoint("TOPLEFT", PAD, -PAD + 2)
    icon:SetTexture(ns.ICON)
    local title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetPoint("LEFT", icon, "RIGHT", 6, 0)
    title:SetText("SaltyTV settings")

    local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", 0, 0)
    close:SetScript("OnClick", function() S.Toggle(false) end)

    panel:SetHeight(BuildOptions(panel, -(PAD + 22)))
    panel:SetScript("OnShow", S.Refresh)
    panel:Hide()
    if UISpecialFrames then table.insert(UISpecialFrames, "SaltyTVSettings") end -- Esc closes it
end

function S.Toggle(show)
    if not panel then return end
    if show == nil then show = not panel:IsShown() end
    if show then
        if ns.Board and ns.Board.Side() then ns.Board.Toggle(false) end -- same spot as Guild records
        Anchor()
        S.Refresh()
    end
    panel:SetShown(show)
end

function S.IsShown() return panel and panel:IsShown() or false end

---------------------------------------------------------------------------
-- Options > AddOns > SaltyTV (the game's own settings window)
---------------------------------------------------------------------------
local function RegisterInGameOptions()
    if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then return end
    local f = CreateFrame("Frame")
    local title = f:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", PAD, -PAD)
    title:SetText("|cffff4444Salty|r|cff4488ffTV|r")
    BuildOptions(f, -(PAD + 24))
    f:SetScript("OnShow", S.Refresh)
    f.OnRefresh = S.Refresh
    local category = Settings.RegisterCanvasLayoutCategory(f, "SaltyTV")
    Settings.RegisterAddOnCategory(category)
    S.category = category
end

--- Called by SaltyTV.lua once the TV exists: the gear button and the panel.
function ns.OnSettingsBuilt(tvFrame, header)
    tv = tvFrame
    local btn = CreateFrame("Button", "SaltyTVSettingsButton", header)
    btn:SetSize(14, 14)
    btn:SetPoint("RIGHT", header, "RIGHT", -40, 0) -- left of the Guild records coin
    btn:SetNormalTexture(GEAR)
    btn:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
    btn:SetScript("OnClick", function() S.Toggle() end)
    btn:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:AddLine("Settings")
        GameTooltip:Show()
    end)
    btn:SetScript("OnLeave", function() GameTooltip:Hide() end)

    Build()
    pcall(RegisterInGameOptions) -- if the game's settings window works differently, the panel still does
    -- follow the TV around, and go to the middle when it's closed
    header:HookScript("OnDragStop", function() if panel:IsShown() then Anchor() end end)
    tv:HookScript("OnSizeChanged", function() if panel:IsShown() then Anchor() end end)
    tv:HookScript("OnShow", function() if panel:IsShown() then Anchor() end end)
    tv:HookScript("OnHide", function() if panel:IsShown() then Anchor() end end)
end
