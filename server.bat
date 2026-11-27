@echo off
REM PixiJS Studio x Tripo3D AI Studio - Local Server
REM v21.0 - CRLF + ASCII only. cmd.exe expects CRLF line endings;
REM a UTF-8 / LF-only .bat can be misparsed, so the window flashes
REM and closes without showing the error. Keep this file ASCII + CRLF.
REM
REM Cach dung: double-click server.bat
REM   (mac dinh cong 8080; truyen cong khac: server.bat 9000)
REM Khi server san sang, cua so nay HIEN RO CONG KET NOI
REM (vi du: http://localhost:8080) - mo link do tren trinh duyet.
REM Neu cong ban, server tu +1 (8080 -> 8081 -> ...) va hien cong that.
setlocal EnableDelayedExpansion
title PixiJS Studio x Tripo3D AI Studio v21.0 - Local Server
cd /d "%~dp0"

echo ============================================================
echo   PixiJS Studio x Tripo3D AI Studio v21.0
echo   Local Development Server
echo ============================================================
echo.

REM --- Cong mac dinh 8080 (co the truyen: server.bat 9000) ---
if "%~1"=="" (set PORT=8080) else (set PORT=%~1)

REM ============================================================
REM Uu tien 1: Node.js + server.js
REM   - Co API studio can: /api/fbx-list, /api/models,
REM     /api/meshopt-encode, /api/meshopt-simplify, /api/rig-analyze
REM   - Tu +1 neu cong ban, va IN RA CONG THAT khi san sang.
REM ============================================================
where node >nul 2>nul
if %errorlevel%==0 (
    if exist server.js (
        echo  [1/3] Tim thay Node.js - khoi dong server.js ...
        echo.
        echo  ------------------------------------------------------------
        echo   Mo trinh duyet tai dia chi HIEN DUOI DAY khi server bao
        echo   "Server chay tai" (cong co the +1 neu %PORT% dang ban):
        echo  ------------------------------------------------------------
        echo.
        node server.js %PORT%
        echo.
        echo  Server da dung. Nhan phim bat ky de dong cua so.
        pause >nul
        goto :eof
    )
)

REM ============================================================
REM Uu tien 2: Python http.server (khong co API server.js)
REM   Tim cong trong truoc (8080..8099), HIEN CONG THAT roi moi chay.
REM ============================================================
where python >nul 2>nul
if %errorlevel%==0 (set PY=python & goto :pyfound)
where py >nul 2>nul
if %errorlevel%==0 (set PY=py & goto :pyfound)
goto :trynpx

:pyfound
set STARTPORT=%PORT%
:findport
netstat -ano 2>nul | findstr /R /C:":%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
    set /a PORT+=1
    if !PORT! GTR 8099 goto :portfail
    goto :findport
)
if not "%PORT%"=="%STARTPORT%" (
    echo  [Luu y] Cong %STARTPORT% dang ban - doi sang cong %PORT%.
)
echo  [2/3] Khoi dong Python http.server ...
echo.
echo  ============================================================
echo   CONG KET NOI: http://localhost:%PORT%
echo   Mo link tren tren trinh duyet de mo Studio.
echo   (Nhan Ctrl+C de dung server)
echo  ============================================================
echo.
start "" http://localhost:%PORT%
%PY% -m http.server %PORT%
echo.
echo  Server da dung. Nhan phim bat ky de dong cua so.
pause >nul
goto :eof

REM ============================================================
REM Uu tien 3: npx serve (can Node.js, khong co API server.js)
REM ============================================================
:trynpx
where npx >nul 2>nul
if %errorlevel%==0 (
    echo  [3/3] Khoi dong npx serve ...
    echo.
    echo  ============================================================
    echo   CONG KET NOI: http://localhost:%PORT%
    echo   (neu cong ban, serve se bao loi - thu server.bat 8081)
    echo   Mo link tren tren trinh duyet de mo Studio.
    echo   (Nhan Ctrl+C de dung server)
    echo  ============================================================
    echo.
    start "" http://localhost:%PORT%
    npx --yes serve -l %PORT% .
    echo.
    echo  Server da dung. Nhan phim bat ky de dong cua so.
    pause >nul
    goto :eof
)

echo [LOI] Khong tim thay Python hoac Node.js trong PATH.
echo Cai dat Python (python.org) hoac Node.js (nodejs.org) roi thu lai,
echo hoac mo file index.html truc tiep (GLB load can server moi hoat dong).
echo.
pause
goto :eof

:portfail
echo [LOI] Khong tim duoc cong trong (da thu %STARTPORT%..8099).
echo Dong bot chuong trinh dang dung cong 8080..8099 roi thu lai,
echo hoac chay: server.bat 9000
echo.
pause
goto :eof
