// Cliente do Redis. Usado para duas coisas:
//  1) cache da lista de produtos (evita ir ao MySQL a cada requisição);
//  2) contador de visitas compartilhado entre todas as réplicas da API.
const { createClient } = require('redis');
const config = require('./config');

const redis = createClient({
  socket: {
    host: config.redis.host,
    port: config.redis.port,
    connectTimeout: 2000,
    // Se o Redis cair, tenta reconectar sozinho (até 3 s entre tentativas).
    reconnectStrategy: (tentativa) => Math.min(tentativa * 200, 3000),
  },
  // Sem fila offline: com o Redis fora, os comandos falham na hora em vez de
  // ficarem esperando (senão a rota /ready travaria).
  disableOfflineQueue: true,
});

// Loga só quando o tipo de erro muda, para não poluir o log a cada tentativa.
let ultimoErro = '';
redis.on('error', (erro) => {
  const texto = erro.code || erro.message || erro.constructor.name;
  if (texto !== ultimoErro) console.log(`[redis] indisponível: ${texto}`);
  ultimoErro = texto;
});
redis.on('ready', () => { ultimoErro = ''; console.log('[redis] conectado'); });

const CHAVE_PRODUTOS = 'loja:produtos';
const CHAVE_VISITAS = 'loja:visitas';

module.exports = { redis, CHAVE_PRODUTOS, CHAVE_VISITAS };
