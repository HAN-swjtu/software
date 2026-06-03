@echo off
chcp 65001 >nul
cd /d "%~dp0"
call "%~dp0启动测试环境.bat" nopause
set MVN=%~dp0tools\apache-maven-3.9.6\bin\mvn.cmd
echo 正在执行 JUnit + Selenium 测试...
"%MVN%" -f "%~dp0ems-selenium-test\pom.xml" test
echo.
echo 测试报告: ems-selenium-test\target\surefire-reports
pause
