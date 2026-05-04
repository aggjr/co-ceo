# Script de Backup Automático STOCKSPIN
# Origem: C:\STOCKSPIN_PROJ
# Destino: Google Drive (Unidade G:)

$source = "C:\STOCKSPIN_PROJ"
$destination = "G:\Meu Drive\01 - Nova Estrutura\Trabalhos\FOCCUS\Softwares\STOCKSPIN"

# Garantir que o destino existe (embora já devesse existir)
if (!(Test-Path -Path $destination)) {
    New-Item -ItemType Directory -Path $destination -Force
}

Write-Output "Iniciando Backup STOCKSPIN: $source -> $destination"

# Copia tudo, sobrescrevendo os arquivos existentes para que o Google Drive gere novas versões
# Ignora arquivos de sistema temporários se houver
Copy-Item -Path "$source\*" -Destination "$destination\" -Recurse -Force -ErrorAction SilentlyContinue

Write-Output "Backup concluído com sucesso às $(Get-Date)."
