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
echo (A primeira vez vai demorar bastante porque sao 4.5GB)
echo (Da segunda vez em diante, enviara apenas as alteracoes!)
echo.

:: Executa o WinSCP chamando o comando de sincronizacao (synchronize)
%WINSCP% /command "open sftp://%USER%:%SENHA%@%SERVER_IP%/ -hostkey=""*""" "mkdir /root/dados_stockspin" "synchronize remote C:\co_ceo\data /root/dados_stockspin" "exit"

echo.
echo ====================================================
echo [2/2] Sincronizacao Finalizada com Sucesso!
echo ====================================================
pause
