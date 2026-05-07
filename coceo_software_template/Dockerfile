# Estágio de Build (Frontend e Backend)
FROM node:20-alpine AS builder

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependências primeiro (otimiza o cache do Docker)
COPY package*.json ./
COPY backend/package*.json ./backend/

# Instala as dependências do frontend e do backend
RUN npm install
RUN cd backend && npm install

# Copia o restante do código da aplicação
COPY . .

# Compila o frontend (o Vite vai gerar a pasta dist)
RUN npm run build

# Prepara a pasta public do backend movendo os arquivos compilados para lá
RUN rm -rf backend/public && mv dist backend/public

# Estágio de Produção
FROM node:20-alpine

# Define o diretório de trabalho da imagem final
WORKDIR /app

# Copia apenas a pasta backend (que agora já contém as dependências e a pasta public com o frontend)
COPY --from=builder /app/backend ./

# Define as variáveis de ambiente necessárias
ENV NODE_ENV=production
ENV PORT=3001
ENV STOCKSPIN_DATA_DIR=/dados_stockspin

# Cria o diretório de dados do STOCKSPIN (será sobrescrito pelo volume do Easypanel)
RUN mkdir -p /dados_stockspin

# Expõe a porta que a aplicação vai rodar
EXPOSE 3001

# Inicia o servidor Node
CMD ["npm", "start"]
