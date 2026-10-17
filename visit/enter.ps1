# Opens a visit: starts the relay and the dev server if they are not running, opens the visit page,
# then starts Root in this terminal with the door as its ONLY tools (no built-in tools, no other MCP).
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

function Test-Listening($port) {
  [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Listening 7796)) {
  Start-Process node -ArgumentList "`"$PSScriptRoot\relay.mjs`"" -WindowStyle Minimized
}
if (-not (Test-Listening 5173)) {
  Start-Process npm.cmd -ArgumentList 'run', 'dev' -WorkingDirectory $repo -WindowStyle Minimized
}
$deadline = (Get-Date).AddSeconds(30)
while (-not ((Test-Listening 7796) -and (Test-Listening 5173))) {
  if ((Get-Date) -gt $deadline) { throw 'The relay (7796) or the dev server (5173) did not start within 30s.' }
  Start-Sleep -Milliseconds 500
}
Start-Process 'http://localhost:5173/worldbuilder/?visit'

# The door's MCP config. Written without a BOM: Windows PowerShell's utf8 encoding adds one.
$cfg = Join-Path $env:TEMP 'root-door-mcp.json'
$json = @{ mcpServers = @{ door = @{ command = 'node'; args = @("$PSScriptRoot\door.mjs") } } } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($cfg, $json, (New-Object Text.UTF8Encoding $false))

# Run from Root's own visits folder, not the repo: no project CLAUDE.md, nothing of the codebase in reach.
$visits = Join-Path $env:USERPROFILE 'root\visits'
New-Item -ItemType Directory -Force $visits | Out-Null
Push-Location $visits
try {
  # --allowedTools is variadic: keep a single-value flag between it and the prompt, or it eats the prompt.
  claude --mcp-config $cfg --strict-mcp-config --tools= --allowedTools mcp__door `
    --append-system-prompt-file "$PSScriptRoot\visit-prompt.md" 'The door is in front of you.'
} finally { Pop-Location }
