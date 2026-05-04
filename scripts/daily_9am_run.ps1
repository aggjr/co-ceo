# Execução diária Co-CEO (chamada pela Tarefa Agendada às 9h).
# Por padrão: só matriz + demandas + plano CD (rápido).
# Para recalcular tudo a partir do legado no mesmo horário: altere para "npm run job:daily-from-legacy"
# (sync:apollo-full demora mais — catálogo + miner + engine + grid + matriz + demandas + plano CD).
$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location -LiteralPath $RepoRoot

$logDir = Join-Path $RepoRoot "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("daily_9am_{0:yyyyMMdd_HHmmss}.log" -f (Get-Date))

function Write-Log([string]$msg) {
  $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg
  $line | Out-File -FilePath $logFile -Append -Encoding utf8
  Write-Host $line
}

Write-Log "Início | cwd=$RepoRoot"
try {
  $out = npm run job:daily-9am 2>&1
  $code = $LASTEXITCODE
  foreach ($line in $out) { Write-Log $line }
  if ($code -ne 0) {
    Write-Log "Falha: npm saiu com código $code"
    exit $code
  }
  Write-Log "Concluído com sucesso."
  exit 0
} catch {
  Write-Log ("Erro: " + $_.Exception.Message)
  exit 1
}
