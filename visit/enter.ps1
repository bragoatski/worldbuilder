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
# Its own dev-server port, so another project's server on Vite's default 5173 is never mistaken for this one.
# The relay only accepts the page from this port (VISIT_PAGE_PORT).
if (-not (Test-Listening 5181)) {
  Start-Process npx.cmd -ArgumentList 'vite', '--port', '5181', '--strictPort' -WorkingDirectory $repo -WindowStyle Minimized
}
$deadline = (Get-Date).AddSeconds(30)
while (-not ((Test-Listening 7796) -and (Test-Listening 5181))) {
  if ((Get-Date) -gt $deadline) { throw 'The relay (7796) or the dev server (5181) did not start within 30s.' }
  Start-Sleep -Milliseconds 500
}
Start-Process 'http://localhost:5181/worldbuilder/?visit'

# The door's MCP config. Written without a BOM: Windows PowerShell's utf8 encoding adds one.
$cfg = Join-Path $env:TEMP 'root-door-mcp.json'
$json = @{ mcpServers = @{ door = @{ command = 'node'; args = @("$PSScriptRoot\door.mjs") } } } | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($cfg, $json, (New-Object Text.UTF8Encoding $false))

# Run from Root's own visits folder, not the repo. --setting-sources user loads Root's own global layer (identity,
# memory) but not ~/CLAUDE.md, the phone bridge's rules, which would otherwise load as an ancestor of this folder.
$visits = Join-Path $env:USERPROFILE 'root\visits'
New-Item -ItemType Directory -Force $visits | Out-Null
Push-Location $visits
try {
  # --allowedTools is variadic: keep a single-value flag between it and the prompt, or it eats the prompt.
  claude --setting-sources user --mcp-config $cfg --strict-mcp-config --tools= --allowedTools mcp__door `
    --append-system-prompt-file "$PSScriptRoot\visit-prompt.md" 'The door is in front of you.'
} finally { Pop-Location }
