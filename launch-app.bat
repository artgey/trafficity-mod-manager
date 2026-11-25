@echo off
setlocal enableextensions
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [Trafficity Mod Manager] Node.js is required for patching and mod installation.
    echo Download it from https://nodejs.org/ and re-run this launcher.
    pause
    exit /b 1
)

if not exist "%~dp0node_modules" (
    echo Installing Node dependencies...
    call npm install
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

if exist "%~dp0bin\trafficity-mod-manager.exe" (
    start "" "%~dp0bin\trafficity-mod-manager.exe" %*
    exit /b 0
)

:menu
cls
echo ==========================================
echo   Trafficity Mod Manager (Windows CLI)
echo ==========================================
echo Note: bin\trafficity-mod-manager.exe is not bundled yet
echo       (the pre-compiled binary in bin\ is for Linux).
echo.
echo   [1] Patch Game (npm run patch)
echo   [2] Restore Stock (npm run restore)
echo   [3] Check Status (npm run status)
echo   [4] Health Check (npm run health)
echo   [5] Scaffold New Mod (npm run new-mod)
echo   [6] Open API Docs (docs\api.html)
echo   [7] Exit
echo.
set /p CHOICE="Select an option (1-7): "

if "%CHOICE%"=="1" (
    call npm run patch
    pause
    goto menu
)
if "%CHOICE%"=="2" (
    call npm run restore
    pause
    goto menu
)
if "%CHOICE%"=="3" (
    call npm run status
    pause
    goto menu
)
if "%CHOICE%"=="4" (
    call npm run health
    pause
    goto menu
)
if "%CHOICE%"=="5" (
    set /p MOD_ID="Enter new mod ID (e.g. my-cool-mod): "
    if not "%MOD_ID%"=="" call npm run new-mod -- "%MOD_ID%"
    pause
    goto menu
)
if "%CHOICE%"=="6" (
    start "" "%~dp0docs\api.html"
    goto menu
)
if "%CHOICE%"=="7" exit /b 0
goto menu
