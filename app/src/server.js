// Ponto de entrada: conecta no Redis, prepara o banco e abre a porta HTTP.
const config = require('./config');
const db = require('./db');
const { redis } = require('./cache');
const { app } = require('./app');

async function iniciar() {
  // O Redis conecta em segundo plano (com reconexão automática);
  // a API não precisa esperar por ele para subir.
  redis.connect().catch((erro) => console.log(`[redis] ${erro.message}`));

  // A porta HTTP abre ANTES do banco estar pronto: assim /health (liveness)
  // já responde, enquanto /ready (readiness) devolve 503 até MySQL e Redis
  // responderem. Quem decide mandar tráfego é a readinessProbe.
  const servidor = app.listen(config.porta, () => {
    console.log(`[api] loja-api ${config.versao} ouvindo na porta ${config.porta}`);
  });

  // Se o banco não aparecer depois de todas as tentativas, iniciarBanco
  // lança erro e o processo sai com código 1 (o Docker/Kubernetes reinicia).
  await db.iniciarBanco();

  // Desligamento gracioso: no rolling update o Kubernetes manda SIGTERM.
  // Paramos de aceitar conexões, terminamos as que estão em andamento e
  // fechamos banco e Redis antes de sair.
  const desligar = (sinal) => {
    console.log(`[api] ${sinal} recebido, encerrando...`);
    servidor.close(async () => {
      await Promise.allSettled([db.pool.end(), redis.quit()]);
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', desligar);
  process.on('SIGINT', desligar);
}

iniciar().catch((erro) => {
  console.error(`[api] falha ao iniciar: ${erro.message}`);
  process.exit(1);
});
