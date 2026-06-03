@echo off
chcp 65001 >nul
title 员工管理系统 - 后端服务
echo.
echo  ========================================
echo   员工管理系统 后端API服务
echo   地址: http://localhost:3001
echo   关闭此窗口将停止服务
echo  ========================================
echo.
cd /d "%~dp0server"
node server.js
pause
