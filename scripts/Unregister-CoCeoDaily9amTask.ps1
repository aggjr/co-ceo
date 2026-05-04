$TaskName = "CoCEO Diario 9h"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Removido (se existia): $TaskName"
