@echo off
chcp 65001 >nul
title 导出员工管理系统数据库
echo.
echo  ========================================
echo   正在导出数据库...
echo  ========================================
echo.

REM 请根据实际情况修改以下参数
set MYSQL_USER=root
set MYSQL_PASSWORD=cpm041019
set DATABASE_NAME=ems
set OUTPUT_FILE=ems_database.sql

echo 导出数据库: %DATABASE_NAME%
echo 输出文件: %OUTPUT_FILE%
echo.

mysqldump -u%MYSQL_USER% -p%MYSQL_PASSWORD% --databases %DATABASE_NAME% --default-character-set=utf8mb4 --single-transaction --routines --triggers --events > "%OUTPUT_FILE%"

if %errorlevel% equ 0 (
    echo.
    echo  ========================================
    echo   导出成功！
    echo   文件位置: %CD%\%OUTPUT_FILE%
    echo  ========================================
) else (
    echo.
    echo  ========================================
    echo   导出失败！请检查MySQL是否已安装
    echo   以及用户名密码是否正确
    echo  ========================================
)

echo.
pause
