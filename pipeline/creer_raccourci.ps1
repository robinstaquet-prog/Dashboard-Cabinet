# Crée le raccourci "Cabinet Dashboard" sur le bureau.
# À exécuter UNE SEULE FOIS.
# Clic-droit sur le raccourci créé → "Épingler à la barre des tâches".

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath    = Join-Path $scriptDir "Cabinet Dashboard.vbs"
$desktopDir = [System.Environment]::GetFolderPath("Desktop")
$lnkPath    = Join-Path $desktopDir "Cabinet Dashboard.lnk"

$wsh      = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($lnkPath)

# wscript.exe lance le .vbs sans console
$shortcut.TargetPath       = "wscript.exe"
$shortcut.Arguments        = "`"$vbsPath`""
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description      = "Ouvre le Dashboard Cabinet (acupuncture)"

# Icône médicale/document depuis shell32.dll (icône n°166 = stéthoscope/médical)
# Changer le numéro si l'icône ne convient pas (0..300 disponibles dans shell32.dll)
$shortcut.IconLocation = "%SystemRoot%\system32\shell32.dll, 166"

$shortcut.Save()

Write-Host ""
Write-Host "Raccourci cree sur le bureau : Cabinet Dashboard.lnk"
Write-Host ""
Write-Host "Pour epingler a la barre des taches :"
Write-Host "  1. Faites un clic-droit sur le raccourci bureau"
Write-Host "  2. Selectionnez 'Epingler a la barre des taches'"
Write-Host ""
Read-Host "Appuyez sur Entree pour fermer"
