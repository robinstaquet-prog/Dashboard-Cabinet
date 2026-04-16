Add-Type -AssemblyName System.Windows.Forms

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# --- 1. Charge config.env ---

$configFile = Join-Path $scriptDir "config.env"

if (-not (Test-Path $configFile)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Fichier config.env introuvable dans :`n$scriptDir`n`nCopiez config.env.example en config.env et remplissez vos informations.",
        "Cabinet Dashboard",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    exit 1
}

Get-Content $configFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line -match "^([^=]+)=(.+)$") {
        $name  = $Matches[1].Trim()
        $value = $Matches[2].Trim()
        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

if (-not $env:PIPELINE_PASSWORD) {
    [System.Windows.Forms.MessageBox]::Show(
        "PIPELINE_PASSWORD est vide dans config.env.",
        "Cabinet Dashboard",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
    exit 1
}

# --- 2. Verifie si le serveur tourne deja ---

$url = "http://127.0.0.1:8000"
$alreadyRunning = $false

try {
    $r = Invoke-WebRequest -Uri "$url/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    if ($r.StatusCode -eq 200) { $alreadyRunning = $true }
} catch {}

# --- 3. Demarre uvicorn si necessaire ---

if (-not $alreadyRunning) {
    Start-Process -FilePath "python" `
        -ArgumentList "-m uvicorn backend.main:app --host 127.0.0.1 --port 8000" `
        -WorkingDirectory $scriptDir `
        -WindowStyle Hidden

    $ready = $false
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 1
        try {
            $r = Invoke-WebRequest -Uri "$url/health" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
    }

    if (-not $ready) {
        [System.Windows.Forms.MessageBox]::Show(
            "Le serveur n'a pas demarre apres 20 secondes.`n`nVerifiez que Python est installe et que les dependances sont presentes :`n  cd pipeline`n  pip install -r requirements.txt",
            "Cabinet Dashboard - Erreur",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        )
        exit 1
    }
}

# --- 4. Ouvre le navigateur sur le dashboard ---

Start-Process $url
