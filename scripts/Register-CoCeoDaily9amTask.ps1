# Regista na Agenda do Windows uma tarefa DIÁRIA às 9:00, uma instância de cada vez.
# Execute uma vez (normalmente não precisa de administrador — tarefa do utilizador atual):
#   powershell -ExecutionPolicy Bypass -File .\scripts\Register-CoCeoDaily9amTask.ps1
#
# Para remover:
#   powershell -ExecutionPolicy Bypass -File .\scripts\Unregister-CoCeoDaily9amTask.ps1

$ErrorActionPreference = "Stop"
$TaskName = "CoCEO Diario 9h"
$RunScript = Join-Path $PSScriptRoot "daily_9am_run.ps1"
if (-not (Test-Path -LiteralPath $RunScript)) {
  throw "Script nao encontrado: $RunScript"
}

$arg = "-NoProfile -ExecutionPolicy Bypass -File `"$RunScript`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg
# Uma vez por dia às 9:00 (relógio local)
$trigger = New-ScheduledTaskTrigger -Daily -At "09:00"
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
  -MultipleInstances IgnoreNew `
  -DontStopOnIdleEnd

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description "Co-CEO: job diario (npm run job:daily-9am por padrao). Pipeline completo a partir do legado: npm run job:daily-from-legacy." -Force

# Garante que a tarefa fica ATIVA (executa sozinha todos os dias às 9h).
Enable-ScheduledTask -TaskName $TaskName

Write-Host "Tarefa registada e ATIVADA: $TaskName"
Write-Host "  - Diaria as 09:00 (relogio local)"
Write-Host "  - Se perder o horario (PC desligado), corre assim que possivel (StartWhenAvailable)"
Write-Host "  - Sem nova instancia em paralelo se a anterior ainda estiver a correr (IgnoreNew)"
Write-Host "Ver / testar: taskschd.msc -> $TaskName -> Executar"
