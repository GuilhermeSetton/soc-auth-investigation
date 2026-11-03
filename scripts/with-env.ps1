param([Parameter(Mandatory=$true, Position=0)][string]$Executable,
      [Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$environmentFile = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $environmentFile)) { throw 'Run scripts/setup-db.ps1 first.' }
foreach ($entry in Get-Content -LiteralPath $environmentFile) {
    if ($entry -match '^(DATABASE_URL|TEST_DATABASE_URL)=(.+)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
Push-Location $projectRoot
try {
    & $Executable @Arguments
    exit $LASTEXITCODE
} finally { Pop-Location }
