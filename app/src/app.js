// Rotas da API da Loja. Fica separado do server.js para poder ser testado
// sem abrir conexão com banco/Redis (ver test/app.test.js).
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { redis, CHAVE_PRODUTOS, CHAVE_VISITAS } = require('./cache');

const app = express();
app.disable('x-powered-by'); // não anuncia que é Express (menos informação para atacantes)
app.use(express.json());

// Todas as respostas carregam a versão e o nome do container/pod que
// atendeu. Isso deixa visível o balanceamento entre réplicas, o rolling
// update (1.0 -> 2.0) e o canary.
app.use((req, res, next) => {
  res.set('X-App-Version', config.versao);
  res.set('X-Pod', os.hostname());
  next();
});

// Validação simples do corpo do POST /produtos.
function validarProduto(corpo) {
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim() : '';
  const preco = Number(corpo?.preco);
  const erros = [];
  if (!nome || nome.length > 100) erros.push('nome é obrigatório (até 100 caracteres)');
  if (!Number.isFinite(preco) || preco < 0) erros.push('preco deve ser um número >= 0');
  return { nome, preco, erros };
}

app.get('/', async (req, res) => {
  let visitas = null;
  if (redis.isReady) visitas = await redis.incr(CHAVE_VISITAS);
  res.json({
    app: 'loja-api',
    versao: config.versao,
    mensagem: config.mensagem,
    pod: os.hostname(),
    visitas,
    rotas: ['/health', '/ready', '/produtos', '/produtos/:id', '/carga'],
  });
});

// LIVENESS: só responde "estou vivo". Não consulta banco de propósito:
// se o MySQL cair, não queremos que o Kubernetes reinicie a API à toa.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', versao: config.versao, uptime_s: Math.round(process.uptime()) });
});

// READINESS: só fica "pronta" quando banco E Redis respondem.
// Enquanto falhar, o Service não manda tráfego para este pod.
// Cada verificação tem tempo limite de 2 s: a probe nunca pode ficar pendurada.
function comTempoLimite(promessa, ms = 2000) {
  return Promise.race([
    promessa,
    new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('timeout')), ms)),
  ]);
}

app.get('/ready', async (req, res) => {
  const estado = { mysql: 'ok', redis: 'ok' };
  try { await comTempoLimite(db.pingBanco()); } catch { estado.mysql = 'falhou'; }
  try {
    if (!redis.isReady) throw new Error('desconectado');
    await comTempoLimite(redis.ping());
  } catch { estado.redis = 'falhou'; }
  const pronto = estado.mysql === 'ok' && estado.redis === 'ok';
  res.status(pronto ? 200 : 503).json({ pronto, ...estado });
});

// Lista de produtos com cache no Redis (campo "origem" mostra de onde veio).
app.get('/produtos', async (req, res, next) => {
  try {
    if (redis.isReady) {
      const emCache = await redis.get(CHAVE_PRODUTOS);
      if (emCache) return res.json({ origem: 'cache', produtos: JSON.parse(emCache) });
    }
    const produtos = await db.listarProdutos();
    if (redis.isReady) await redis.set(CHAVE_PRODUTOS, JSON.stringify(produtos), { EX: config.cacheTtl });
    res.json({ origem: 'mysql', produtos });
  } catch (erro) { next(erro); }
});

app.get('/produtos/:id', async (req, res, next) => {
  try {
    const produto = await db.buscarProduto(Number(req.params.id));
    if (!produto) return res.status(404).json({ erro: 'produto não encontrado' });
    res.json(produto);
  } catch (erro) { next(erro); }
});

app.post('/produtos', async (req, res, next) => {
  try {
    const { nome, preco, erros } = validarProduto(req.body);
    if (erros.length) return res.status(400).json({ erros });
    const produto = await db.criarProduto(nome, preco);
    if (redis.isReady) await redis.del(CHAVE_PRODUTOS); // invalida o cache
    res.status(201).json(produto);
  } catch (erro) { next(erro); }
});

app.delete('/produtos/:id', async (req, res, next) => {
  try {
    const removido = await db.removerProduto(Number(req.params.id));
    if (!removido) return res.status(404).json({ erro: 'produto não encontrado' });
    if (redis.isReady) await redis.del(CHAVE_PRODUTOS);
    res.status(204).end();
  } catch (erro) { next(erro); }
});

// Rota que gasta CPU de propósito (calcula hashes por ~N ms).
// Serve para o teste de autoscaling (HPA) subir as réplicas com poucas
// requisições, sem depender de quantos wget o gerador de carga consegue fazer.
app.get('/carga', (req, res) => {
  const ms = Math.min(Number(req.query.ms) || 100, 1000);
  const fim = Date.now() + ms;
  let hash = 'loja';
  while (Date.now() < fim) hash = crypto.createHash('sha256').update(hash).digest('hex');
  res.json({ pod: os.hostname(), ms, hash: hash.slice(0, 12) });
});

// Tratamento de erro centralizado: loga e devolve 500 sem vazar detalhes.
app.use((erro, req, res, next) => { // eslint-disable-line no-unused-vars
  // JSON mal formado no corpo é erro do cliente (400), não do servidor.
  if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
  console.error('[erro]', erro.message);
  res.status(500).json({ erro: 'erro interno' });
});

module.exports = { app, validarProduto };
