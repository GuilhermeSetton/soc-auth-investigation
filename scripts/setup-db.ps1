$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath '.env')) {
        $secretBytes = New-Object byte[] 32
        $randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $randomGenerator.GetBytes($secretBytes) } finally { $randomGenerator.Dispose() }
        $databasePassword = [BitConverter]::ToString($secretBytes).Replace('-', '').ToLowerInvariant()
        @(
            "POSTGRES_PASSWORD=$databasePassword"
            "DATABASE_URL=postgresql://soc_auth:${databasePassword}@127.0.0.1:5432/soc_auth"
            "TEST_DATABASE_URL=postgresql://soc_auth:${databasePassword}@127.0.0.1:5432/soc_auth_test"
        ) | Set-Content -LiteralPath '.env' -Encoding utf8
    }
    & docker compose up -d --wait
    if ($LASTEXITCODE -ne 0) { throw 'Database startup failed.' }
    $testDatabaseExists = & docker compose exec -T db psql -U soc_auth -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'soc_auth_test'"
    if ($LASTEXITCODE -ne 0) { throw 'Database availability check failed.' }
    if (($testDatabaseExists -join '').Trim() -ne '1') {
        & docker compose exec -T db createdb -U soc_auth soc_auth_test
        if ($LASTEXITCODE -ne 0) { throw 'Test database creation failed.' }
    }
    Write-Output 'Local PostgreSQL and isolated test database are ready. Credentials remain in ignored .env.'
} finally { Pop-Location }
