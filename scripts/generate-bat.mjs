import fs from 'node:fs';

const batContent = `@echo off
cd /d "%~dp0"
title Zhanshuang TCG Launcher

echo ========================================================
echo   Zhanshuang TCG Platform Launcher
echo ========================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found in PATH!
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo [1/2] Node.js environment detected.
echo [2/2] Launching platform services...
echo.

node "%~dp0scripts\\start.mjs"

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Process exited with code %errorlevel%.
    pause
)
`;

fs.writeFileSync('start.bat', batContent.replace(/\r?\n/g, '\r\n'), 'ascii');
console.log('start.bat successfully generated with CRLF and ASCII!');
