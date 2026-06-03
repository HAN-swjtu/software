@echo off
chcp 65001 >nul
title 员工管理系统 - 测试环境启动
cd /d "%~dp0.."

echo [1/2] 检查后端 API (端口 3001)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/departments/list' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorlevel% neq 0 (
  echo 后端未运行，正在启动 server.js ...
  start "EMS-API" cmd /k "cd /d "%~dp0..\server" && node server.js"
  timeout /t 3 /nobreak >nul
) else (
  echo 后端已在运行。
)

echo [2/2] 启动前端静态服务 (端口 8080，供 Selenium 访问)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8080/login.html' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }"
if %errorlevel% neq 0 (
  start "EMS-Web" cmd /k "npx --yes http-server "%~dp0.." -p 8080 -c-1"
  timeout /t 5 /nobreak >nul
) else (
  echo 静态服务已在运行。
)

echo.
echo 环境就绪：
echo   登录页: http://localhost:8080/login.html
echo   API:    http://localhost:3001
echo   管理员: root / 123456
echo.
if not "%1"=="nopause" pause
