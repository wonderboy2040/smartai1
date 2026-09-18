Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c node --env-file=.env server\index.js", 0, False
