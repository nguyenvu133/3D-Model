@echo off
title PixiJS Studio x Tripo3D AI Studio v5.0 - Local Server
echo ============================================================
echo   PixiJS Studio x Tripo3D AI Studio v5.0
echo   Local Development Server
echo ============================================================
echo.
echo  Dang khoi dong server tai: http://localhost:8080
echo  (Nhan Ctrl+C de dung server)
echo.

REM Thu cac cach chay server theo thu tu uu tien
where python >nul 2>nul
if %errorlevel%==0 (
    python -m http.server 8080
    goto :eof
)

where py >nul 2>nul
if %errorlevel%==0 (
    py -m http.server 8080
    goto :eof
)

where npx >nul 2>nul
if %errorlevel%==0 (
    npx --yes serve -l 8080 .
    goto :eof
)

echo [LOI] Khong tim thay Python hoac Node.js trong PATH.
echo Cai dat Python (python.org) hoac Node.js (nodejs.org) roi thu lai,
echo hoac mo file index.html truc tiep (GLB load can server moi hoat dong).
pause
