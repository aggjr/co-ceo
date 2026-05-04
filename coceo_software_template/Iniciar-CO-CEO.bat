@echo off
chcp 65001 >nul
title CO-CEO — arranque
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo Node.js nao foi encontrado no PATH.
    echo Instale Node.js 18+ e volte a executar este ficheiro.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo npm nao foi encontrado no PATH.
    pause
    exit /b 1
)

echo.
echo  ========================================
echo    CO-CEO — a instalar e a subir servicos
echo    API: http://localhost:3001
echo    Web: http://localhost:5173
echo    Feche esta janela ou Ctrl+C para parar.
echo  ========================================
echo.

call npm run coceo:init
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
    echo Terminou com codigo %ERR%.
    pause
)
exit /b %ERR%
