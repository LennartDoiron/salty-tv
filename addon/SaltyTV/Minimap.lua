-- SaltyTV minimap button, like other addons have: left-click shows or hides the
-- TV, right-click opens Guild records, Shift-click opens Settings, drag it
-- around the edge of the minimap.
-- /salty minimap hides or shows the button. No libraries needed; it's a normal
-- minimap button, so button collectors can gather it up.

local ADDON, ns = ...
local M = {}
ns.Minimap = M

local ICON = ns.ICON
local button

local function Settings()
    SaltyTVDB.minimap = SaltyTVDB.minimap or {}
    local s = SaltyTVDB.minimap
    if s.angle == nil then s.angle = 215 end -- bottom left of the minimap, out of the way
    return s
end

-- on the minimap's edge at the saved angle (square minimaps: on the square's edge)
local function Place()
    if not button then return end
    local a = math.rad(Settings().angle)
    local x, y = math.cos(a), math.sin(a)
    if GetMinimapShape and GetMinimapShape() == "SQUARE" then
        local m = math.max(math.abs(x), math.abs(y))
        x, y = x / m, y / m
    end
    local rx = (Minimap:GetWidth() or 140) / 2 + 5
    local ry = (Minimap:GetHeight() or 140) / 2 + 5
    button:ClearAllPoints()
    button:SetPoint("CENTER", Minimap, "CENTER", x * rx, y * ry)
end

local function FollowCursor()
    local mx, my = Minimap:GetCenter()
    if not mx then return end
    local scale = Minimap:GetEffectiveScale()
    local cx, cy = GetCursorPosition()
    Settings().angle = math.deg(math.atan2(cy / scale - my, cx / scale - mx)) % 360
    Place()
end

local function ShowTooltip(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("|cffff4444Salty|r|cff4488ffTV|r")
    local shown = ns.tv and ns.tv:IsShown()
    GameTooltip:AddLine("Left-click: " .. (shown and "hide" or "show") .. " the TV", 1, 1, 1)
    GameTooltip:AddLine("Right-click: Guild records", 1, 1, 1)
    GameTooltip:AddLine("Shift-click: Settings", 1, 1, 1)
    GameTooltip:AddLine("Drag: move this button", 0.7, 0.7, 0.7)
    GameTooltip:Show()
end

function M.Click(which)
    if IsShiftKeyDown and IsShiftKeyDown() then
        if ns.Settings then ns.Settings.Toggle() end
    elseif which == "RightButton" then
        if ns.Board then ns.Board.Toggle() end
    elseif ns.ToggleTV then
        ns.ToggleTV()
    end
end

local function Create()
    button = CreateFrame("Button", "SaltyTVMinimapButton", Minimap)
    button:SetSize(31, 31)
    button:SetFrameStrata("MEDIUM")
    button:SetFrameLevel(8)
    button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    button:RegisterForDrag("LeftButton")
    button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

    -- the same pieces as the standard round minimap buttons
    local background = button:CreateTexture(nil, "BACKGROUND")
    background:SetSize(24, 24)
    background:SetTexture("Interface\\Minimap\\UI-Minimap-Background")
    background:SetPoint("CENTER")
    local icon = button:CreateTexture(nil, "ARTWORK")
    icon:SetSize(18, 18)
    icon:SetTexture(ICON)
    icon:SetPoint("CENTER")
    button.icon = icon
    local border = button:CreateTexture(nil, "OVERLAY")
    border:SetSize(50, 50)
    border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
    border:SetPoint("TOPLEFT")

    button:SetScript("OnClick", function(self, which)
        M.Click(which)
        if GameTooltip:IsOwned(self) then ShowTooltip(self) end -- "show"/"hide" flips
    end)
    button:SetScript("OnEnter", ShowTooltip)
    button:SetScript("OnLeave", function() GameTooltip:Hide() end)
    button:SetScript("OnMouseDown", function() icon:SetPoint("CENTER", 1, -1) end)
    button:SetScript("OnMouseUp", function() icon:SetPoint("CENTER") end)
    button:SetScript("OnDragStart", function(self)
        GameTooltip:Hide()
        self:SetScript("OnUpdate", FollowCursor)
    end)
    button:SetScript("OnDragStop", function(self)
        self:SetScript("OnUpdate", nil)
        icon:SetPoint("CENTER")
    end)

    Place()
    button:SetShown(not Settings().hide)
    M.button = button
end

--- the Settings checkbox
function M.SetHidden(hide)
    Settings().hide = hide and true or false
    if button then button:SetShown(not hide) end
end

--- /salty minimap
function M.Toggle()
    local s = Settings()
    M.SetHidden(not s.hide)
    print("SaltyTV: minimap button " .. (s.hide and "hidden. /salty minimap brings it back." or "shown."))
end

-- Titan Panel, ChocolateBar and other LibDataBroker displays: a launcher there too
local function RegisterLauncher()
    local ldb = LibStub and LibStub("LibDataBroker-1.1", true)
    if not ldb then return end
    ldb:NewDataObject("SaltyTV", {
        type = "launcher", icon = ICON, label = "SaltyTV",
        OnClick = function(_, which) M.Click(which) end,
        OnTooltipShow = function(tt)
            tt:AddLine("SaltyTV")
            tt:AddLine("Left-click: show/hide the TV", 1, 1, 1)
            tt:AddLine("Right-click: Guild records", 1, 1, 1)
            tt:AddLine("Shift-click: Settings", 1, 1, 1)
        end,
    })
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
    if not Minimap then return end
    Create()
    pcall(RegisterLauncher)
end)
