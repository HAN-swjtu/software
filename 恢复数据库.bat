@echo off
chcp 65001 >nul
title 恢复数据库中文 + 扩展字段
echo.
echo  ========================================
echo   正在恢复数据库中文数据...
echo  ========================================
echo.

set SQL_BACKUP=D:\ems_database.sql
if not exist "%SQL_BACKUP%" set SQL_BACKUP=%~dp0ems_database.sql

echo [1/3] 重新导入数据库（请使用 CMD 方式，避免乱码）...
cmd /c "mysql -u root -p123456 --default-character-set=utf8mb4 < \"%SQL_BACKUP%\""
if %errorlevel% neq 0 (
    echo 导入失败，请检查 MySQL 密码和 SQL 文件路径
    pause
    exit /b 1
)

echo [2/3] 恢复部门/角色中文名称...
cd /d "%~dp0server"
node restore-chinese.js

echo [3/4] 应用功能扩展字段...
copy /Y "%~dp0server\migrate.sql" D:\ems_migrate.sql >nul
cmd /c "mysql -u root -p123456 --default-character-set=utf8mb4 < D:\ems_migrate.sql"

echo [4/4] 移除职位字段，统一使用角色...
node remove-position.js

echo.
echo  ========================================
echo   恢复完成！请重启后端服务并刷新浏览器
echo  ========================================
pause
