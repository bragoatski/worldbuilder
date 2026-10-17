' Launches the local Worldbuilder keepalive (dev server + Root's visit relay) with no visible window.
' A copy of this file lives in the Startup folder, so it runs at every logon.
CreateObject("WScript.Shell").Run _
  "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""C:\Users\KevinReilly\worldbuilder\visit\start-worldbuilder.ps1""", _
  0, False
