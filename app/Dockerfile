# syntax=docker/dockerfile:1
# Dockerfile multi-stage da loja-api (bônus: build multi-stage).
#   Estágio 1 (deps):    instala só as dependências de produção.
#   Estágio 2 (runtime): copia o resultado para uma imagem limpa, sem npm
#                        cache nem arquivos de build, e roda como usuário comum.

# ---------- Estágio 1: dependências ----------
FROM node:22-alpine AS deps
WORKDIR /app
# Copia primeiro só os manifestos: se o código mudar e as dependências não,
# o Docker reaproveita esta camada do cache e o build fica bem mais rápido.
COPY package.json package-lock.json ./
# npm ci = instalação exata do package-lock; --omit=dev deixa de fora o que
# só serve para desenvolvimento.
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Estágio 2: imagem final ----------
FROM node:22-alpine AS runtime
# Versão passada no build (docker build --build-arg APP_VERSION=2.0).
# Vira variável de ambiente e aparece na resposta da API: é a mudança visível
# entre as imagens 1.0 e 2.0.
ARG APP_VERSION=1.0
ENV NODE_ENV=production \
    PORT=3000 \
    APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.title="loja-api" \
      org.opencontainers.image.version="${APP_VERSION}"
WORKDIR /app
# Traz do estágio 1 apenas a pasta node_modules pronta.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
# A imagem oficial do Node já tem o usuário "node" (sem privilégios de root).
USER node
# Documenta a porta em que a API escuta (quem publica é o -p / Service).
EXPOSE 3000
# Healthcheck da própria imagem (usado pelo "docker run" e pelo Compose).
# Usa o Node que já está na imagem, sem instalar curl/wget.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Forma "exec" (JSON): o node vira o PID 1 e recebe o SIGTERM direto,
# permitindo o desligamento gracioso implementado no server.js.
CMD ["node", "src/server.js"]
