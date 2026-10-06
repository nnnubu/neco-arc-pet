' Neco Arc Pet launcher - starts the pet WITHOUT a console window
' Path-independent: resolves its own folder, so it works wherever this file lives.
Dim fso, petPath, exePath
Set fso = CreateObject("Scripting.FileSystemObject")
petPath = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = petPath & "\node_modules\electron\dist\electron.exe"
Dim ws
Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = petPath
ws.Run """" & exePath & """ .", 0, False
