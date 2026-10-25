@echo off
chcp 65001 >nul
cd /d "%~dp0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8788 ^| findstr LISTENING') do taskkill /PID %%a /F >nul 2>&1
echo 已停止。
timeout /t 2 >nul
