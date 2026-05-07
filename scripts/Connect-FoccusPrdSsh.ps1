<#
.SYNOPSIS
  Abre ligação SSH ao servidor de produção (Passo 1 do runbook) sem guardar passwords no Git.

.DESCRIPTION
  - Usa o cliente OpenSSH do Windows (ssh.exe), normalmente já instalado.
  - Palavra-passe: introduza quando o ssh pedir (ou configure chave SSH — recomendado).
  - Host e utilizador vêm de variáveis de ambiente OU parâmetros (não hardcodar IP/credenciais no ficheiro).

  Exemplos:
    $env:FOCCUS_SSH_HOST = "x.x.x.x"
    $env:FOCCUS_SSH_USER = "root"
    .\Connect-FoccusPrdSsh.ps1

    .\Connect-FoccusPrdSsh.ps1 -HostName "x.x.x.x" -User "root"

  PuTTY em vez de ssh (se tiver instalado no caminho típico):
    .\Connect-FoccusPrdSsh.ps1 -UsePutty
#>
[CmdletBinding()]
param(
  [string] $HostName = $env:FOCCUS_SSH_HOST,
  [string] $User = $(if ($env:FOCCUS_SSH_USER) { $env:FOCCUS_SSH_USER } else { "root" }),
  [int] $Port = $(if ($env:FOCCUS_SSH_PORT) { [int]$env:FOCCUS_SSH_PORT } else { 22 }),
  [switch] $UsePutty
)

$ErrorActionPreference = "Stop"

if (-not $HostName -or $HostName.Trim() -eq "") {
  Write-Host "Defina o host, por exemplo:" -ForegroundColor Yellow
  Write-Host '  $env:FOCCUS_SSH_HOST = "IP_ou_hostname"' -ForegroundColor Gray
  Write-Host "  .\Connect-FoccusPrdSsh.ps1" -ForegroundColor Gray
  Write-Host "Ou: .\Connect-FoccusPrdSsh.ps1 -HostName IP -User root" -ForegroundColor Gray
  exit 1
}

$target = "${User}@${HostName}"

if ($UsePutty) {
  $putty = @(
    "${env:ProgramFiles}\PuTTY\putty.exe",
    "${env:ProgramFiles(x86)}\PuTTY\putty.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if (-not $putty) {
    Write-Error "PuTTY não encontrado em Program Files. Instale PuTTY ou use sem -UsePutty (OpenSSH)."
  }

  Write-Host "A abrir PuTTY: $target (porta $Port) ..." -ForegroundColor Cyan
  Start-Process -FilePath $putty -ArgumentList @("-ssh", $target, "-P", "$Port")
  exit 0
}

$ssh = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $ssh) {
  Write-Error "ssh.exe não encontrado. Instale 'OpenSSH Client' (Definições > Apps > Funcionalidades opcionais) ou use -UsePutty."
}

Write-Host "Ligação SSH (interativa): $target porta $Port" -ForegroundColor Cyan
Write-Host "Se já usa chave: ssh-copy-id / authorized_keys. Caso contrário, introduza a password quando pedido." -ForegroundColor DarkGray
& $ssh.Source -p $Port $target
