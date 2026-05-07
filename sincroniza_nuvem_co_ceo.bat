@echo off
setlocal
color 0A

echo ====================================================
echo     ROBO DE SINCRONIZACAO CO-CEO (NUVEM)
echo ====================================================
echo.

set WINSCP="C:\Program Files (x86)\WinSCP\WinSCP.com"
set SERVER_IP=69.62.99.34
set USER=root

:: Pede a senha pro Augusto (assim nao deixamos a senha salva no script por seguranca)
set /p SENHA="Digite a senha root do servidor (%SERVER_IP%): "

echo.
echo [1/2] Conectando ao servidor e comparando os arquivos...
echo (Apenas as diferencas serao enviadas - sincronizacao incremental)
echo.

:: WinSCP scripting:
::  - "option batch abort" + "option confirm off" garantem execucao nao-interativa
::    (sem prompt Abortar/Repetir/Pular caso algo falhe).
::  - "call mkdir -p" roda o comando shell remoto idempotente, evitando o erro
::    quando /root/dados_stockspin ja existe (motivo do bug anterior).
::  - "synchronize remote" envia somente o que mudou na arvore C:\co_ceo\data.
%WINSCP% /command ^
  "option batch abort" ^
  "option confirm off" ^
  "open sftp://%USER%:%SENHA%@%SERVER_IP%/ -hostkey=""*""" ^
  "call mkdir -p /root/dados_stockspin" ^
  "synchronize remote C:\co_ceo\data /root/dados_stockspin" ^
  "exit"

set RC=%ERRORLEVEL%

echo.
if %RC% NEQ 0 (
  color 0C
  echo ====================================================
  echo [ERRO] Sincronizacao FALHOU. Codigo de retorno do WinSCP: %RC%
  echo ----------------------------------------------------
  echo Causas comuns: senha errada, sem internet, disco cheio, etc.
  echo Veja as linhas acima para o erro especifico.
  echo ====================================================
) else (
  echo ====================================================
  echo [2/2] Sincronizacao Finalizada com Sucesso!
  echo ====================================================
)
pause
