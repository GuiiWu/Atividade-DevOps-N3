// Toda a configuração da API vem de variáveis de ambiente.
// Assim a MESMA imagem roda no Docker, no Compose e no Kubernetes:
// só muda quem injeta as variáveis (-e, arquivo .env, ConfigMap/Secret).

function numero(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

const config = {
  porta: numero(process.env.PORT, 3000),
  // Versão "assada" na imagem pelo Dockerfile (ARG APP_VERSION). É o que
  // muda de forma visível entre a imagem 1.0 e a 2.0.
  versao: process.env.APP_VERSION || 'dev',
  mensagem: process.env.APP_MESSAGE || 'Bem-vindo à Loja',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: numero(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'loja',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'loja',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: numero(process.env.REDIS_PORT, 6379),
  },

  // Quanto tempo (segundos) a lista de produtos fica no cache do Redis.
  cacheTtl: numero(process.env.CACHE_TTL, 30),
};

module.exports = config;
