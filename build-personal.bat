@echo off
rem Builds the personal SaltyTV installer, with the "Try to skip Twitch ads" switch.
rem Meant for you and your friends: share the file directly, don't upload it to
rem GitHub Releases or CurseForge. Needs Node.js (nodejs.org, the LTS version).
title SaltyTV personal build
cd /d "%~dp0companion"

where npm >nul 2>nul || (echo Node.js isn't installed. Get the LTS version from https://nodejs.org and try again. & goto :fail)

echo Getting the build tools ready (the first time takes a few minutes)...
call npm install --no-audit --no-fund || goto :fail

echo.
echo Building SaltyTV-Personal-Setup...
call npm run dist:personal || goto :fail

echo.
echo Done! Opening the folder with the installer.
start "" explorer "%cd%\dist"
pause
exit /b 0

:fail
echo.
echo The build didn't finish. Copy the messages above if you need help.
pause
exit /b 1
