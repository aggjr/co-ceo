# Runbook: filas RabbitMQ cheias e batches do legado (STOCKSPIN)

Processo operacional para quando o **RabbitMQ** enche filas de reprocessamento e o **legado** trava o processamento das lojas. Baseado no manual *Reiniciar serviços batches de reprocessamento* (Google Drive).

> **Segurança:** não commite senhas, PDFs com credenciais nem ficheiros `.env` preenchidos. Use cofre (1Password, Azure Key Vault, etc.) ou variáveis de ambiente só na máquina do operador.

---

## Ordem recomendada (alto nível)

1. **SSH** no servidor de batches do legado (ex.: PuTTY / `ssh`).
2. **Parar** os serviços de batch de reprocessamento (systemd, docker compose ou o que a infraestrutura usar).
3. **MySQL (legado):** ajustar o estado de reprocessamento dos **ativos** conforme procedimento interno do DBA (o PDF aponta este passo; o SQL exato depende do schema e da política SARON — não automatizar sem validação).
4. **RabbitMQ:** purgar ou esvaziar as **filas de reprocessamento** (ver secção abaixo).
5. **Subir de novo** todos os serviços de reprocessamento e validar filas vazias / consumo normal.

---

## 1. SSH e serviços no Linux

- Ligue-se ao host indicado pela vossa infraestrutura.
- Troque para o utilizador da aplicação (ex.: `stockspin`), não root, para comandos da app.
- Localize unidades `systemctl` ou scripts em `/opt/...` / `docker compose` — **os nomes exatos dos serviços** devem constar da documentação interna; substitua nos exemplos.

Exemplos (ajustar nomes):

```bash
# Parar
sudo systemctl stop stockspin-batch-reprocessamento.service
# … ou vários serviços / compose down

# Arrancar
sudo systemctl start stockspin-batch-reprocessamento.service
```

---

## 2. RabbitMQ — limpeza das filas

Defina no ambiente (nunca no Git):

| Variável | Exemplo | Uso |
|----------|---------|-----|
| `RABBITMQ_HOST` | `rabbitmq.exemplo.com` | Host do management API |
| `RABBITMQ_MGMT_PORT` | `15672` | Porta HTTP da API de gestão |
| `RABBITMQ_USER` / `RABBITMQ_PASS` | — | Utilizador com permissão de gestão |
| `RABBITMQ_VHOST` | `%2F` ou nome codificado | Virtual host (na URL, `/` → `%2F`) |
| `RABBITMQ_QUEUE_NAME_PREFIX` | `reprocess` | Opcional: só filas cujo nome contém este texto |

### Opção A — script PowerShell (Windows)

Na pasta deste README:

```powershell
Set-Location "c:\co_ceo\scripts\legado-filas-rabbitmq"
Copy-Item .env.example .env   # preencher à mão, .env está no .gitignore da raiz se aplicável
.\Limpar-FilasRabbitMq.ps1 -WhatIf   # simula
.\Limpar-FilasRabbitMq.ps1           # executa purga
```

### Opção B — UI

Abrir **RabbitMQ Management** → *Queues* → para cada fila de reprocessamento: **Purge** (ou delete queue se forem recriadas ao subir o consumer).

---

## 3. MySQL

O manual indica ligar ao MySQL de produção e **alterar o status de reprocessamento dos ativos**. Isto é sensível a negócio; confirme com o DBA:

- quais tabelas/colunas (`ativo`, `StatusReprocessamento`, filas internas, etc.);
- se há transação segura (backup / janela de manutenção);
- se há SKUs que não devem ser resetados.

Não incluímos SQL fixo neste repositório sem revisão da equipa.

---

## 4. Checklist pós-execução

- [ ] Filas RabbitMQ sem backlog anómalo.
- [ ] Serviços de batch em `active (running)`.
- [ ] Uma loja de teste processa movimento / reprocessamento sem erro.
- [ ] Registar data/hora, operador e filas purgadas no livro de ocorrências.

---

## 5. Automatizar como “serviço” no Windows

- **Execução manual:** atalho para `Limpar-FilasRabbitMq.ps1` (com `-WhatIf` primeiro).
- **Agendamento raro:** *Agendador de Tarefas* só se a política de segurança permitir credenciais em cofre — evitar tarefa agendada com password em claro.

Para integração contínua com o ecossistema **CO-CEO** (Node), pode chamar-se o mesmo script por `powershell -File ...` a partir de um job interno; mantenha segredos fora do repositório.
