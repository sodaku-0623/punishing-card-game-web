@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 推送到 GitHub

echo ========================================================
echo   《战双帕弥什 卡牌对战》GitHub 快捷推送助手
echo ========================================================
echo.
echo 当前项目目录: %cd%
echo.

set /p REPO_URL="请输入你的 GitHub 仓库地址 (例如 https://github.com/username/repo.git): "

if "%REPO_URL%"=="" (
    echo.
    echo [错误] 未输入仓库地址！
    pause
    exit /b 1
)

echo.
echo [1/2] 正在绑定远程仓库: %REPO_URL%
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo.
echo [2/2] 正在推送至 main 分支 (如首次推送，请在弹出的浏览器窗口中授权 GitHub 登录)...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   🎉 推送圆满成功！代码已成功同步至 GitHub！
    echo ========================================================
) else (
    echo.
    echo [提示] 推送未完成，请检查网络连接或 GitHub 账号权限。
)

echo.
pause
