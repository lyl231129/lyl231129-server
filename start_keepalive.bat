@echo off
cd /d %~dp0

REM 优先用本机已装的 node，回退到 WorkBuddy 管理的 node
set NODE=node
if exist "C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2\node.exe" (
  set NODE="C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2\node.exe"
)

REM 地址优先级：命令行参数 > 环境变量 KEEPALIVE_URL
set URL=%1
if "%URL%"=="" set URL=%KEEPALIVE_URL%
if "%URL%"=="" (
  echo 用法: start_keepalive.bat https://你的.onrender.com
  echo 或者先设置: set KEEPALIVE_URL=https://你的.onrender.com
  pause
  exit /b 1
)

echo 保活目标: %URL%  (每 5 分钟 ping 一次 /health)
%NODE% keepalive.js %URL% 300
