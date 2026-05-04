# CO-CEO — Decisão e estoque

Aplicação de tomada de decisão e operações de estoque (módulo STOCKSPIN), desenvolvida pela FOCCUS Gestão.

## 📋 Versão Atual

**v1.0.0** - Em desenvolvimento

## 🎯 Objetivo

O CO-CEO reúne telas analíticas, compras/CD e controle multi-cliente, com acesso por perfil.

## 🏗️ Arquitetura

O CO-CEO utiliza a mesma arquitetura base do ecossistema FOCCUS, com componentes reutilizáveis quando aplicável via **FOCCUS-SHARED**.

### Stack Tecnológica

**Frontend:**
- Vite (build tool)
- Vanilla JavaScript (ES6+)
- CSS3 com variáveis customizadas
- Socket.io Client (real-time)

**Backend:**
- Node.js + Express
- MySQL
- Socket.io (WebSockets)
- JWT (autenticação)

## 📦 Módulos (v1.0)

- ✅ **Autenticação** — Login, gestão de usuários e clientes (tenants)
- ✅ **RBAC** — Controle de acesso por perfil
- ✅ **STOCKSPIN** — Telas CO-CEO (relatórios, grade, saúde de estoque, etc.)

## 🎨 Branding FOCCUS

O CO-CEO utiliza a identidade visual da FOCCUS:

**Cores:**
- Azul Escuro: `#00425F`
- Azul Médio: `#2F6C81`
- Dourado: `#DAB177`
- Roxo Escuro: `#202451`

**Fontes:**
- Principal: Montserrat
- Secundária: Poppins

## 📁 Estrutura do Projeto

```
coceo_software_template/
├── backend/
│   ├── controllers/      # Lógica de negócio
│   ├── routes/           # Rotas da API
│   ├── services/         # Serviços auxiliares
│   ├── middleware/       # Middleware customizado
│   ├── migrations/       # Migrações de banco
│   ├── config/           # Configurações
│   ├── uploads/          # Arquivos enviados
│   ├── server.js         # Servidor Express
│   └── package.json      # Dependências backend
├── src/
│   ├── components/       # Componentes UI
│   ├── services/         # Serviços frontend
│   ├── utils/            # Utilitários
│   ├── styles/           # Estilos adicionais
│   ├── main.js           # Entry point
│   └── style.css         # Estilos globais
├── database/
│   └── init.sql          # Schema inicial
├── index.html            # HTML principal
├── vite.config.js        # Configuração Vite
└── package.json          # Dependências frontend
```

## 🔧 Biblioteca Compartilhada (FOCCUS-SHARED)

O projeto pode utilizar componentes da biblioteca **FOCCUS-SHARED**, localizada em:
```
../FOCCUS-SHARED/
```

**Componentes Compartilhados:**
- SharedTable.js - Tabela com filtros e ordenação
- Dialogs.js - Sistema de modais
- dateUtils.js - Utilitários de data
- currencyMask.js - Formatação monetária
- ExcelExporter.js - Exportação Excel
- auth.js - Middleware de autenticação
- errorMiddleware.js - Tratamento de erros
- E mais...

## 🚀 Como Rodar

### Pré-requisitos

- Node.js 18+
- MySQL 8+
- npm ou yarn

### Instalação

1. **Clone o repositório**
```bash
cd "c:/co_ceo/coceo_software_template"
```

2. **Instale dependências do frontend**
```bash
npm install
```

3. **Instale dependências do backend**
```bash
cd backend
npm install
```

4. **Configure o banco de dados**
```bash
# Na raiz do projeto (onde está a pasta database/): cria o schema co_ceo_db, tabelas e seed mínimo
mysql -u root -p < database/init_co_ceo_db.sql
# Se a base já existir só com o cliente de demonstração e faltar a SARON + vínculo ao legado:
# mysql -u root -p co_ceo_db < database/patch_insert_saron_tenant_complete.sql
```

5. **Configure variáveis de ambiente**
```bash
cd backend
cp .env.example .env
# Edite o .env com suas configurações
```

6. **Inicie o backend**
```bash
cd backend
npm start
# Servidor rodará em http://localhost:3001
```

7. **Inicie o frontend** (em outro terminal)
```bash
npm run dev
# Aplicação abrirá em http://localhost:5173
```

## 📊 Status do Desenvolvimento

### ✅ Concluído
- [x] Estrutura base do projeto
- [x] Biblioteca compartilhada FOCCUS-SHARED
- [x] Configuração frontend (Vite)
- [x] Configuração backend (Express)
- [x] Design system com branding FOCCUS
- [x] Servidor base com Socket.io

### 🔄 Em Desenvolvimento
- [ ] Sistema de autenticação
- [ ] RBAC granular
- [ ] Módulo de Produtos
- [ ] Módulo de Fornecedores
- [ ] Módulo de Produção
- [ ] Módulo de Estoque

### 📅 Próximas Versões
- [ ] Módulos de IA e análise preditiva
- [ ] Sistema de precificação inteligente
- [ ] Análise ABC de produtos
- [ ] Dashboards analíticos

## 🔐 Controle de Acesso (RBAC)

O CO-CEO implementa controle de acesso em **3 níveis**:

1. **Nível de Módulo** - Acesso à tela
2. **Nível de Ação** - Criar, Ler, Editar, Excluir
3. **Nível de Campo** - Visualizar/editar campos específicos

**Exemplo:**
- Operador pode ver produtos mas não o preço de custo
- Gerente pode editar preços mas não excluir produtos
- Admin tem acesso total

## 📝 Licença

Propriedade de **FOCCUS Gestão**

## 👥 Equipe

Desenvolvido pela equipe FOCCUS Gestão

---

**CO-CEO v1.0.0** — Decisão e estoque
