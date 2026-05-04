#Requires -Version 5.1
<#
  CO-CEO — arranque completo (install, .env, seed, backend + Vite).
  Executar na pasta coceo_software_template:  .\iniciar-coceo.ps1
  Parâmetros são repassados ao script Node, ex.: .\iniciar-coceo.ps1 --no-seed
#>
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js não está no PATH. Instale Node 18+ e tente de novo."
    exit 1
}
node .\scripts\init-coceo.mjs @args
exit $LASTEXITCODE
