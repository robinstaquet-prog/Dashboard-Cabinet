' Lance le Dashboard Cabinet sans fenêtre de console.
' Double-cliquer sur ce fichier ou l'épingler à la barre des tâches.

Dim scriptDir
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

Dim ps1
ps1 = scriptDir & "lancer.ps1"

Dim WshShell
Set WshShell = CreateObject("WScript.Shell")

' WindowStyle 0 = fenêtre cachée (pas de console visible)
WshShell.Run "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
