# On-demand launcher for the local Worldbuilder (http://localhost:5173/worldbuilder/) with "Call Root"
# ready: the Vite dev server, which starts the visit relay (127.0.0.1:7796) beside itself.
#
# Owner ruling 2026-11-15: "I dont think I want the workldbuilder game always running. Only when it is
# open" (reverses the 2026-10-17 always-on ruling). So nothing starts this at logon any more. The ops
# dashboard's Worldbuilder link starts it (GET /worldbuilder/open runs worldbuilder.vbs, waits for the
# port, then redirects), and this loop stops both servers and exits once no tab has been open for
# $IDLE_MIN minutes. While it runs it still relaunches whatever stopped answering.
#
# "A tab is open" = an ESTABLISHED connection to the page or relay port: an open page holds Vite's
# hot-reload socket for as long as it is open (and the relay socket during a visit). Measured, not
# assumed: see the 2026-11-15 note in ~/.claude/projects/C--Users-KevinReilly-worldbuilder/memory/.
$ErrorActionPreference = 'Continue'
$dir = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $dir '.local'
$INTERVAL_S = 10          # seconds between checks
$PAGE_PORT = 5173
$RELAY_PORT = 7796
$IDLE_MIN = 10          # minutes with no open tab before both servers stop
$FIRST_GRACE_MIN = 3    # the page must connect within this long of a start, or it stops

$mutex = New-Object System.Threading.Mutex($false, 'Global\WorldbuilderKeepalive')
try {
  $acquired = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
  $acquired = $true
}
if (-not $acquired) { exit 0 }

function Log($m) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ssK'), $m
  try { [System.IO.File]::AppendAllText((Join-Path $logDir 'launcher.log'), $line + "`r`n", (New-Object System.Text.UTF8Encoding($false))) } catch { }
}

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

# Connections a browser holds TO our ports (local end on the port), not our own outbound ones.
function Test-TabOpen {
  $n = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
         Where-Object { $_.LocalPort -eq $PAGE_PORT -or $_.LocalPort -eq $RELAY_PORT }).Count
  return $n -gt 0
}

function Stop-Servers {
  foreach ($port in @($PAGE_PORT, $RELAY_PORT)) {
    $owners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($procId in $owners) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue
      # Only our own node servers, never whatever else might hold the port.
      if ($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'vite[\\/]bin[\\/]vite\.js|visit[\\/]relay\.mjs') {   # Vite spawns the relay as visit/relay.mjs
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Log "stopped $port (PID $procId)"
      }
    }
  }
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
  Log "start"
  # Before any tab has connected, allow the first-load grace; after, the idle window.
  $lastSeen = (Get-Date).AddMinutes($FIRST_GRACE_MIN - $IDLE_MIN)
  while ($true) {
    if (-not (Test-Port $PAGE_PORT)) {
      # The dev server also starts the relay (vite.config.js); a relay already running makes the new one bow out.
      Start-Hidden 'dev-server' @('node_modules\vite\bin\vite.js', '--host', '127.0.0.1', '--port', "$PAGE_PORT", '--strictPort')
      Start-Sleep -Seconds 10
    } elseif (-not (Test-Port $RELAY_PORT)) {
      Start-Hidden 'relay' @('visit\relay.mjs')
    }
    if (Test-TabOpen) { $lastSeen = Get-Date }
    elseif (((Get-Date) - $lastSeen).TotalMinutes -ge $IDLE_MIN) {
      Log "no tab open for $IDLE_MIN min: stopping"
      Stop-Servers
      break
    }
    Start-Sleep -Seconds $INTERVAL_S
  }
} finally {
  Log "exit"
  $mutex.ReleaseMutex()
}
