// Teste de carga da loja-api com k6 (Desafio MCD).
//
// Roda em container, sem instalar nada além do Docker:
//   Get-Content carga/teste-carga.js | docker run --rm -i -e TAXA=200 grafana/k6:1.3.0 run -
//
// Usa TAXA FIXA de requisições (constant-arrival-rate): o k6 dispara TAXA
// requisições por segundo, chova ou faça sol. Se a API não der conta, as
// respostas atrasam ou dão erro, e o teste reprova. Assim "aguenta ou não
// aguenta" vira uma pergunta objetiva para cada configuração.
//
// Variáveis (todas opcionais):
//   BASE_URL  endereço da API    (padrão http://host.docker.internal:30080 = NodePort visto de dentro de um container)
//   TAXA      requisições por segundo         (padrão 200)
//   DURACAO   tempo de teste                  (padrão 60s)
//
// Critério de "aguentou" (thresholds): menos de 1% de erro e p95 abaixo de 500 ms.
// Se algum threshold falhar, o k6 termina com código 99.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:30080';
const TAXA = Number(__ENV.TAXA || 200);
const DURACAO = __ENV.DURACAO || '60s';

export const options = {
  scenarios: {
    taxa_fixa: {
      executor: 'constant-arrival-rate',
      rate: TAXA,
      timeUnit: '1s',
      duration: DURACAO,
      preAllocatedVUs: Math.max(20, Math.ceil(TAXA / 5)),
      maxVUs: Math.max(100, TAXA * 2),
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'max'],
};

// Mistura de tráfego parecida com o uso real da loja:
// 50% lista de produtos (Redis/MySQL), 30% página inicial (contador no Redis),
// 20% produto por id (MySQL).
export default function () {
  const sorteio = Math.random();
  let res;
  if (sorteio < 0.5) res = http.get(`${BASE}/produtos`, { tags: { rota: '/produtos' }, timeout: '5s' });
  else if (sorteio < 0.8) res = http.get(`${BASE}/`, { tags: { rota: '/' }, timeout: '5s' });
  else res = http.get(`${BASE}/produtos/${1 + Math.floor(Math.random() * 3)}`, { tags: { rota: '/produtos/:id' }, timeout: '5s' });
  check(res, { 'status 200': (r) => r.status === 200 });
}
