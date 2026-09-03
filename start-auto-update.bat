@echo off
chcp 65001 >nul
title Content Map Auto Update - Do NOT close this window
cd /d "%~dp0"
echo.
echo ==========================================================
echo    ระบบอัปเดต Content Map อัตโนมัติ
echo ==========================================================
echo.
echo    เปิดหน้าต่างนี้ค้างไว้ แล้วไปกดปุ่ม "อัปเดตข้อมูลตอนนี้"
echo    ในหน้าเว็บ greenprokspth.github.io/seo-dashboard
echo.
echo    ปิดหน้าต่างนี้ = หยุดทำงาน
echo.
echo ==========================================================
echo.
node watch-refresh.js
echo.
echo [STOPPED] Press any key to close.
pause >nul
