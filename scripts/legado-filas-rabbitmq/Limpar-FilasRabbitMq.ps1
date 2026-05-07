<#
.SYNOPSIS
    Purga mensagens das filas RabbitMQ cujo nome coincide com um prefixo/padrão (ex.: reprocessamento).

.DESCRIPTION
    Usa a HTTP Management API (/api/queues) e DELETE .../contents por fila.
    Credenciais: ficheiro .env na mesma pasta (KEY=VAL) ou variáveis de ambiente já definidas.

.PARAMETER WhatIf
    Lista filas que seriam purgadas sem apagar.

.EXAMPLE
    .\Limpar-FilasRabbitMq.ps1 -WhatIf
    .\Limpar-FilasRabbitMq.ps1
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $here ".env"

function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $i = $line.IndexOf("=")
        if ($i -lt 1) { return }
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim()
        if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
        if ($k) { Set-Item -Path "Env:$k" -Value $v }
    }
}

Import-DotEnv $envFile

$hostMq = $env:RABBITMQ_HOST
$port = if ($env:RABBITMQ_MGMT_PORT) { $env:RABBITMQ_MGMT_PORT } else { "15672" }
$user = $env:RABBITMQ_USER
$pass = $env:RABBITMQ_PASS
$vhost = if ($env:RABBITMQ_VHOST) { $env:RABBITMQ_VHOST } else { "%2F" }
$prefix = $env:RABBITMQ_QUEUE_NAME_PREFIX

if (-not $hostMq -or -not $user -or -not $pass) {
    Write-Error "Defina RABBITMQ_HOST, RABBITMQ_USER, RABBITMQ_PASS (e opcionalmente .env nesta pasta). Ver .env.example"
}

$pair = "${user}:${pass}"
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
$headers = @{ Authorization = "Basic $b64" }
$base = "http://${hostMq}:${port}/api"

Write-Host "Listando filas (vhost=$vhost)..."
$queuesUri = "$base/queues/$vhost"
$queues = @(Invoke-RestMethod -Uri $queuesUri -Headers $headers -Method Get)

$targets = foreach ($q in $queues) {
    $name = [string]$q.name
    if (-not $prefix) { $name }
    elseif ($name -like "*$prefix*") { $name }
}

if (-not $targets -or $targets.Count -eq 0) {
    Write-Host "Nenhuma fila corresponde ao critério (prefixo: '$prefix'). Total filas no vhost: $($queues.Count)"
    exit 0
}

Write-Host "Filas a purgar: $($targets.Count)"
foreach ($n in $targets) {
    $enc = [Uri]::EscapeDataString($n)
    $purgeUri = "$base/queues/$vhost/$enc/contents"
    if ($PSCmdlet.ShouldProcess($n, "Purge queue messages")) {
        try {
            Invoke-RestMethod -Uri $purgeUri -Headers $headers -Method Delete | Out-Null
            Write-Host "  OK purgada: $n"
        } catch {
            Write-Warning "  Falhou: $n — $($_.Exception.Message)"
        }
    } else {
        Write-Host "  [WhatIf] $n"
    }
}

Write-Host "Concluído."
