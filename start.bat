@echo off
chcp 65001 >nul
title 小红书工作台
cd /d "%~dp0"
echo 正在启动...
python launcher.py
echo.
pause >nul
