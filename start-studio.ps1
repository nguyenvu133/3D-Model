# start-studio.ps1 — Mở PixiJS Studio trong Windows Terminal
# Cách dùng (chạy từ Windows Terminal, tại thư mục project):
#   .\start-studio.ps1            # server ở port 8080 (tự +1 nếu bận)
#   .\start-studio.ps1 8090       # server ở port chỉ định
#   .\start-studio.ps1 -NoServe   # chỉ mở browser (server đã chạy sẵn)
param(
  [Parameter(Position = 0)][int]$Port = 8080,
  [switch]$NoServe
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not $NoServe) {
  # 1) Cài dependency nếu còn thiếu
  if (-not (Test-Path (Join-Path $root 'node_modules\meshoptimizer'))) {
    Write-Host 'Cai dat dependencies (npm install)...' -ForegroundColor Cyan
    npm install --no-audit --no-fund
  }

  # 2) Chạy server trong 1 tab riêng trong Windows Terminal
  $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
  if ($wt) {
    Start-Process wt.exe -ArgumentList @(
      'new-tab', '--title', 'Studio Server',
      '-d', "`"$root`"",
      'powershell', '-NoExit', '-Command', "node server.js $Port"
    )
  } else {
    Start-Process -FilePath 'node' -ArgumentList 'server.js', $Port -WorkingDirectory $root
  }

  # 3) Đợi server lên (tối đa ~20s) rồi mở browser
  Write-Host "Dang cho server tren http://localhost:$Port ..." -ForegroundColor Cyan
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $r = Invoke-RestMethod "http://localhost:$Port/api/meshopt-ping" -TimeoutSec 1
      if ($r.ok) { $ok = $true; break }
    } catch { }
  }
  if (-not $ok) { Write-Host 'Server chua phan hoi — mo tab Studio Server de xem log.' -ForegroundColor Yellow }
}

Start-Process "http://localhost:$Port/"
Write-Host "Da mo http://localhost:$Port/" -ForegroundColor Green
