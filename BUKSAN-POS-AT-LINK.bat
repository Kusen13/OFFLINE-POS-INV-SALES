@echo off
chcp 65001 >nul
title POS Connection Helper - AngeloDelacruz
cls

for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like '*Wi-Fi*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress"') do set WIFI_IP=%%i
if "%WIFI_IP%"=="" (
    for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress"') do set WIFI_IP=%%i
)
if "%WIFI_IP%"=="" set WIFI_IP=192.168.100.36
set HOST_NAME=%COMPUTERNAME%

:MENU
cls
color 0B
echo ==============================================================================
echo              OFFLINE POS ^& INVENTORY - CONNECTION FINDER
echo ==============================================================================
echo.
echo   [1] KUNG SA PC / LAPTOP MISMO MAGTITINDA:
echo       --^> http://localhost:8080
echo       (Laging ito ang gamit sa PC - kahit walang internet o walang WiFi)
echo.
echo   [2] KUNG SA CELLPHONE O TABLET (Home WiFi man o Phone Hotspot):
echo       --^> http://%HOST_NAME%.local:8080   [PINAKAMADALI - HINDI NAGBABAGO]
echo       --^> http://%WIFI_IP%:8080          [DIRECT IP ADDRESS]
echo.
echo ==============================================================================
echo   MGA PAGPIPILIAN:
echo ==============================================================================
echo   [1] Buksan ang POS sa PC Browser (localhost:8080)
echo   [2] Kopyahin ang Cellphone Link sa Clipboard (para ma-paste o ma-send)
echo   [3] Buksan ang QR Code Page (Para i-scan na lang ng Phone Camera)
echo   [4] I-refresh ang koneksyon / IP Address
echo   [5] Isara itong window
echo ==============================================================================
echo.
set /p CHOICE="Pumili ng numero (1-5) tapos pindutin ang ENTER: "

if "%CHOICE%"=="1" (
    start http://localhost:8080
    goto MENU
)
if "%CHOICE%"=="2" (
    echo http://%HOST_NAME%.local:8080 | clip
    echo.
    echo   [OK] Na-kopya na ang link sa Clipboard: http://%HOST_NAME%.local:8080
    timeout /t 2 >nul
    goto MENU
)
if "%CHOICE%"=="3" (
    start http://localhost:8080/connect.html
    goto MENU
)
if "%CHOICE%"=="4" (
    goto :REFRESH
)
if "%CHOICE%"=="5" (
    exit
)
goto MENU

:REFRESH
echo Nagre-refresh...
for /f "tokens=*" %%i in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like '*Wi-Fi*' -and $_.IPAddress -notlike '169.254*' } | Select-Object -First 1).IPAddress"') do set WIFI_IP=%%i
goto MENU
