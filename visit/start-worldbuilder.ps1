# Keepalive for the local Worldbuilder (http://localhost:5173/worldbuilder/) with "Call Root" ready:
# the Vite dev server, which starts the visit relay (127.0.0.1:7796) beside itself. Same shape as
# ~/holodeck/start-holodeck.ps1: a Startup-folder launcher (worldbuilder.vbs) starts this loop at logon,
# and the loop relaunches whatever stopped answering. Owner ruling 2026-10-17: always available.
$ErrorActionPreference = 'Continue'
$dir = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $dir '.local'
$INTERVAL_S = 30
$PAGE_PORT = 5173
$RELAY_PORT = 7796

$mutex = New-Object System.Threading.Mutex($false, 'Global\WorldbuilderKeepalive')
try {
  $acquired = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $acquired = $true
}
if (-not $acquired) { exit 0 }

function Test-Port {
  param([int]$Port)
  try {
    $c = New-Object Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(500)
    if ($ok -and $c.Connected) { $c.EndConnect($iar); $c.Close(); return $true }
    $c.Close(); return $false
  } catch { return $false }
}

function Start-Hidden {
  param([string]$Name, [string[]]$NodeArgs)
  $out = Join-Path $logDir "$Name.log"; $err = Join-Path $logDir "$Name.err.log"
  foreach ($f in @($out, $err)) {
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt 2MB)) { Move-Item $f "$f.1" -Force }
  }
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if ($node) {
    Start-Process -FilePath $node -ArgumentList $NodeArgs -WorkingDirectory $dir `
      -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  }
}

try {
  New-Item -ItemType Directory -Force $logDir | Out-Null
  while ($true) {
    if (-not (Test-Port $PAGE_PORT)) {
      # The dev server also starts the relay (vite.config.js); a relay already running makes the new one bow out.
      Start-Hidden 'dev-server' @('node_modules\vite\bin\vite.js', '--host', '127.0.0.1', '--port', "$PAGE_PORT", '--strictPort')
      Start-Sleep -Seconds 10
    } elseif (-not (Test-Port $RELAY_PORT)) {
      Start-Hidden 'relay' @('visit\relay.mjs')
    }
    Start-Sleep -Seconds $INTERVAL_S
  }
} finally {
  $mutex.ReleaseMutex()
}
