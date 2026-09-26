@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   三角洲行动 · 本地服务器
echo   默认地址: http://localhost:8080
echo   控制台管理: 见 server/README.md
echo ============================================
echo.
"C:\Users\admin\.workbuddy\binaries\node\versions\22.22.2\node.exe" server.js
echo.
echo 服务器已停止。按任意键退出。
pause >nul
