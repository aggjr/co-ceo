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
::  - "option batch abort" + "option confirm off" garantem execucao nao-interativa.
::  - "call mkdir -p" cria a estrutura /root/dados_stockspin/data (idempotente).
::  - DESTINO IMPORTANTE: sincronizamos para /root/dados_stockspin/DATA (e nao
::    para a raiz), porque o frontend resolve URLs como
::    https://data.co-ceo.com.br/data/client/<arquivo>. Sem o sufixo "/data" o
::    Nginx servia /data/X de uma copia antiga e os ficheiros novos ficavam
::    fora do alcance do frontend.
:: Telas HTML que sao abertas em link direto (ex.: detalhe do produto a partir
:: do "Mix de Produtos" -> ceo_product_detail_layout.html). Precisam estar na
:: raiz do volume /root/dados_stockspin para que data.co-ceo.com.br resolva.
%WINSCP% /command ^
  "option batch abort" ^
  "option confirm off" ^
  "open sftp://%USER%:%SENHA%@%SERVER_IP%/ -hostkey=""*""" ^
  "call mkdir -p /root/dados_stockspin/data" ^
  "synchronize remote C:\co_ceo\data /root/dados_stockspin/data" ^
  "put -neweronly C:\co_ceo\ceo_product_detail_layout.html /root/dados_stockspin/" ^
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
