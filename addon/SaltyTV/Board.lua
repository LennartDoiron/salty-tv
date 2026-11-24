-- SaltyTV guild leaderboard panel ("Guild records"), opened from the coin
-- button on the TV's header (or /salty board). It's attached to the TV's
-- right side, or its left side when the TV is against the right screen edge.

local ADDON, ns = ...
local Board = {}
ns.Board = Board

local WIDTH, ROW_H, PAD, GAP = 240, 17, 10, 6
local ICON = "Interface\\Icons\\INV_Misc_Coin_01"
local COINS = {
    "Interface\\MoneyFrame\\UI-GoldIcon",
    "Interface\\MoneyFrame\\UI-SilverIcon",
    "Interface\\MoneyFrame\\UI-CopperIcon",
}
local SECTIONS = {
    { field = "bal", title = "Richest" },
    { field = "peak", title = "Peak balance" },
    { field = "win", title = "Biggest win" },
}
local FOOTER = {
    ok = "Updates when guildmates log in or /reload.",
    noguild = "You're not in a guild, so only your own numbers show.",
    nodata = "No numbers from the SaltyTV app yet. Run it, bet on a matchmaking match, then restart WoW once.",
    off = "You're not sharing your numbers (/salty share on).",
}

local tv, panel, footer

---------------------------------------------------------------------------
-- formatting
---------------------------------------------------------------------------
--- 1234567 -> "$1.23M", 45800 -> "$45.8K", 600 -> "$600"
function Board.Short(n)
    n = tonumber(n) or 0
    for _, u in ipairs({ { 1e12, "T" }, { 1e9, "B" }, { 1e6, "M" }, { 1e3, "K" } }) do
        if n >= u[1] then
            local x = n / u[1]
            local s = string.format(x >= 100 and "%.0f" or x >= 10 and "%.1f" or "%.2f", x)
            if s:find("%.") then s = s:gsub("0+$", ""):gsub("%.$", "") end
            return "$" .. s .. u[2]
        end
    end
    return "$" .. string.format("%.0f", n)
end

function Board.Ago(t)
    local d = time() - (tonumber(t) or 0)
    if d < 90 then return "just now" end
    if d < 3600 then return string.format("%dm ago", math.floor(d / 60)) end
    if d < 86400 then return string.format("%dh ago", math.floor(d / 3600)) end
    return string.format("%dd ago", math.floor(d / 86400))
end

local function ShortName(char)
    return (char or "?"):match("^[^-]+") or char
end

local function ClassColor(class)
    local c = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
    if c then return c.r, c.g, c.b end
    return 1, 1, 1
end

---------------------------------------------------------------------------
-- rows
---------------------------------------------------------------------------
local function ShowTooltip(row)
    local r = row.record
    if not r then return end
    GameTooltip:SetOwner(row, "ANCHOR_RIGHT")
    GameTooltip:AddLine(ShortName(r.char), ClassColor(r.class))
    GameTooltip:AddDoubleLine("SaltyBet name", r.salty or "unknown", 0.7, 0.7, 0.7, 1, 1, 1)
    GameTooltip:AddDoubleLine("Balance", Board.Short(r.bal), 0.7, 0.7, 0.7, 1, 0.82, 0)
    GameTooltip:AddDoubleLine("Peak", Board.Short(r.peak), 0.7, 0.7, 0.7, 1, 0.82, 0)
    GameTooltip:AddDoubleLine("Biggest win", Board.Short(r.win), 0.7, 0.7, 0.7, 1, 0.82, 0)
    GameTooltip:AddLine("Updated " .. Board.Ago(r.t), 0.5, 0.5, 0.5)
    GameTooltip:Show()
end

local function MakeRow()
    local row = CreateFrame("Button", nil, panel)
    row:SetHeight(ROW_H)
    row.hl = row:CreateTexture(nil, "BACKGROUND")
    row.hl:SetAllPoints()
    row.hl:SetColorTexture(1, 0.82, 0, 0.10) -- your own row
    row.icon = row:CreateTexture(nil, "ARTWORK")
    row.icon:SetSize(13, 13)
    row.icon:SetPoint("LEFT", 2, 0)
    row.rank = row:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    row.rank:SetPoint("LEFT", 0, 0)
    row.value = row:CreateFontString(nil, "ARTWORK", "GameFontNormal")
    row.value:SetPoint("RIGHT", -2, 0)
    row.value:SetJustifyH("RIGHT")
    row.name = row:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
    row.name:SetPoint("LEFT", 20, 0)
    row.name:SetPoint("RIGHT", row.value, "LEFT", -6, 0)
    row.name:SetJustifyH("LEFT")
    row:SetScript("OnEnter", ShowTooltip)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)
    return row
end

-- gold, silver, copper coin for 1st, 2nd, 3rd (dimmed while nobody holds that spot)
local function SetCoin(row, rank, taken)
    row.icon:SetTexture(COINS[rank])
    row.icon:SetDesaturated(not taken)
    row.icon:SetAlpha(taken and 1 or 0.35)
    row.icon:Show()
    row.rank:SetText("")
end

local function FillRow(row, r, rank, field, myId)
    row.record = r
    row:Show()
    SetCoin(row, rank, true)
    row.name:SetText(ShortName(r.char))
    row.name:SetTextColor(ClassColor(r.class))
    row.value:SetText(Board.Short(r[field]))
    row.value:SetTextColor(1, 0.82, 0)
    row.hl:SetShown(r.id == myId)
end

local function EmptyRow(row, rank, text)
    row.record = nil
    row:Show()
    SetCoin(row, rank, false)
    row.name:SetText(text)
    row.name:SetTextColor(0.5, 0.5, 0.5)
    row.value:SetText("")
    row.hl:Hide()
end

---------------------------------------------------------------------------
-- panel
---------------------------------------------------------------------------
local function Anchor()
    if not panel then return end
    panel:ClearAllPoints()
    local right, screen = tv:GetRight(), UIParent:GetRight()
    if right and screen and right + WIDTH + 6 > screen then
        panel:SetPoint("TOPRIGHT", tv, "TOPLEFT", -4, 0) -- no room on the right
        panel.side = "left"
    else
        panel:SetPoint("TOPLEFT", tv, "TOPRIGHT", 4, 0)
        panel.side = "right"
    end
end

local function Build()
    panel = CreateFrame("Frame", "SaltyTVBoard", tv, "BackdropTemplate")
    panel:SetWidth(WIDTH)
    panel:SetHeight(200)
    panel:EnableMouse(true)
    panel:SetBackdrop({
        bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
        edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 14,
        insets = { left = 3, right = 3, top = 3, bottom = 3 },
    })
    panel:SetBackdropColor(0.04, 0.04, 0.06, 0.94)
    panel:SetBackdropBorderColor(0.45, 0.45, 0.5, 1)

    local icon = panel:CreateTexture(nil, "ARTWORK")
    icon:SetSize(20, 20)
    icon:SetPoint("TOPLEFT", PAD, -PAD + 2)
    icon:SetTexture(ICON)
    panel.title = panel:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
    panel.title:SetPoint("LEFT", icon, "RIGHT", 6, 0)
    panel.title:SetText("Guild records")

    local close = CreateFrame("Button", nil, panel, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", 0, 0)
    close:SetScript("OnClick", function() Board.Toggle(false) end)

    for _, sec in ipairs(SECTIONS) do
        sec.header = panel:CreateFontString(nil, "ARTWORK", "GameFontNormal")
        sec.header:SetText(sec.title)
        sec.header:SetTextColor(1, 0.5, 0.1)
        sec.rows = {}
        for i = 1, 3 do sec.rows[i] = MakeRow() end -- top 3: gold, silver, copper
    end
    for _, sec in ipairs(SECTIONS) do -- "You: 5th" next to the title when you're below the top 3
        sec.mine = panel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
        sec.mine:SetJustifyH("RIGHT")
    end

    footer = panel:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
    footer:SetJustifyH("LEFT")
    footer:SetWidth(WIDTH - 2 * PAD)
    panel:Hide()
end

local function Ordinal(n)
    local last2, last = n % 100, n % 10
    local suffix = (last2 >= 11 and last2 <= 13) and "th" or ({ "st", "nd", "rd" })[last] or "th"
    return n .. suffix
end

function Board.Refresh()
    if not panel or not panel:IsShown() then return end
    local Sync = ns.Sync
    local list, myId = Sync.Records(), Sync.MyId()
    local y = -(PAD + 28)

    for _, sec in ipairs(SECTIONS) do
        sec.header:ClearAllPoints()
        sec.header:SetPoint("TOPLEFT", PAD, y)
        sec.mine:ClearAllPoints()
        sec.mine:SetPoint("TOPRIGHT", -PAD - 2, y - 1)
        y = y - 16

        local ranked = Sync.Ranked(list, sec.field)
        local myRank
        for i, r in ipairs(ranked) do
            if r.id == myId then myRank = i break end
        end

        sec.mine:SetText(myRank and myRank > 3 and ("You: " .. Ordinal(myRank)) or "")

        for i, row in ipairs(sec.rows) do
            if ranked[i] then
                FillRow(row, ranked[i], i, sec.field, myId)
            else
                EmptyRow(row, i, (i == 1 and #ranked == 0) and "No records yet" or "\226\128\148") -- an em dash
            end
            row:ClearAllPoints()
            row:SetPoint("TOPLEFT", PAD, y)
            row:SetPoint("TOPRIGHT", -PAD, y)
            y = y - ROW_H
        end
        y = y - GAP
    end

    footer:ClearAllPoints()
    footer:SetPoint("TOPLEFT", PAD, y - 2)
    footer:SetText(FOOTER[Sync.Status()] or FOOTER.ok)
    panel:SetHeight(-y + (footer:GetStringHeight() or 12) + PAD + 2)
end

function Board.Toggle(show)
    if not panel then return end
    if show == nil then show = not panel:IsShown() end
    SaltyTVDB.boardShown = show and true or false
    panel:SetShown(show)
    if show then
        Anchor()
        Board.Refresh()
    end
end

function Board.Side()
    return panel and panel:IsShown() and panel.side or nil
end

--- Called by SaltyTV.lua once the TV exists.
function ns.OnTVBuilt(tvFrame, header)
    tv = tvFrame

    local btn = CreateFrame("Button", "SaltyTVBoardButton", header)
    btn:SetSize(14, 14)
    btn:SetPoint("RIGHT", header, "RIGHT", -22, 0) -- just left of the resize grip
    btn:SetNormalTexture(ICON)
    btn:SetHighlightTexture("Interface\\Buttons\\ButtonHilight-Square", "ADD")
    btn:SetScript("OnClick", function() Board.Toggle() end)
    btn:SetScript("OnEnter", function(self)
        GameTooltip:SetOwner(self, "ANCHOR_TOP")
        GameTooltip:AddLine("Guild records")
        GameTooltip:AddLine("Your guild's SaltyBet leaderboard", 1, 1, 1)
        GameTooltip:Show()
    end)
    btn:SetScript("OnLeave", function() GameTooltip:Hide() end)

    Build()
    -- re-pick the side after the TV moves or changes size
    header:HookScript("OnDragStop", function() if panel:IsShown() then Anchor() end end)
    tv:HookScript("OnSizeChanged", function() if panel:IsShown() then Anchor() end end)
    if SaltyTVDB.boardShown then Board.Toggle(true) end
end
