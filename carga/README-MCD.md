# Desafio MCD: menor configuração disponível

Objetivo: descobrir a **menor configuração do Kubernetes** (CPU, memória e réplicas da `loja-api`) que aguenta a carga de requisições.

## Ferramenta

[k6](https://k6.io/) rodando em container (`grafana/k6:1.3.0`), sem instalar nada além do Docker. O script [`teste-carga.js`](teste-carga.js) dispara uma **taxa fixa** de requisições por segundo na API (NodePort `localhost:30080`):

- 50% `GET /produtos` (Redis com fallback no MySQL)
- 30% `GET /` (contador de visitas no Redis)
- 20% `GET /produtos/:id` (MySQL)

**Critério de "aguentou":** menos de 1% de erro **e** p95 abaixo de 500 ms.

## Como rodar

Teste rápido contra o que estiver no ar:

```powershell
Get-Content carga/teste-carga.js -Raw | docker run --rm -i -e TAXA=200 -e DURACAO=60s grafana/k6:1.3.0 run -
```

Testar uma configuração específica (tira o HPA, aplica requests = limits, escala, roda o k6 e grava em `resultados.csv`):

```powershell
.\carga\testar-config.ps1 -Cpu 200m -Memoria 64Mi -Replicas 1 -Taxa 200
```

Depois dos testes, para voltar à configuração regulada (com HPA): `kubectl apply -f k8s/`.

> Se o PowerShell bloquear o script (`execution policy`), rode antes, só nessa janela: `Set-ExecutionPolicy -Scope Process Bypass`.

## Resultados (Docker Desktop, Kubernetes v1.36.1, 30 s por teste)

Todos em [`resultados.csv`](resultados.csv). Requests = limits em cada teste.

| CPU | Memória | Réplicas | Taxa alvo | req/s reais | p95 | Erro | Resultado |
|---|---|---|---|---|---|---|---|
| 100m | 128Mi | 1 | 50 | 50 | 34 ms | 0,5% | ✅ aguentou |
| 100m | 128Mi | 1 | 100 | 98 | 516 ms | 0% | ❌ |
| 200m | 128Mi | 1 | 100 | 100 | 8 ms | 0% | ✅ |
| 100m | 128Mi | 1 | 200 | 160 | 5000 ms | 34% | ❌ (pod reiniciado) |
| 150m | 96Mi | 1 | 200 | 194 | 1022 ms | 0% | ❌ |
| **200m** | **64Mi** | **1** | **200** | 198 | 276 ms | 0% | ✅ **MCD** |
| 200m | 96Mi | 1 | 200 | 198 | 192 ms | 0% | ✅ |
| 100m | 96Mi | 2 | 200 | 197 | 308 ms | 0% | ✅ |
| 200m | 128Mi | 1 | 400 | 307 | 5000 ms | 42% | ❌ |
| 300m | 128Mi | 1 | 400 | 397 | 213 ms | 0% | ✅ |

**MCD para 200 req/s: 1 réplica com 200m de CPU e 64Mi de memória.** Com 64Mi o pod usou cerca de 41Mi, então a memória não é o gargalo: o que limita é a CPU. Abaixo de 200m o Node.js sofre throttling, as requisições enfileiram e o p95 passa de 500 ms.

2 réplicas de 100m também aguentam 200 req/s (mesma CPU total), mas gastam o dobro de memória e de pods. Por isso a menor configuração é 1 × 200m.

## Regulagem aplicada em `k8s/`

| Item | Antes (N3) | Agora | Por quê |
|---|---|---|---|
| Réplicas | 2 | 1 | o MCD aguenta 200 req/s com 1 pod |
| requests | 100m / 96Mi | **200m / 64Mi** | menor configuração que aguentou |
| limits | 500m / 192Mi | 300m / 128Mi | folga para pico (300m aguentou 400 req/s) |
| HPA | por comando, 2–6, 50% | **YAML** `k8s/40-hpa.yaml`, 1–4, 70% | sobe com um único `apply`, escala antes do throttling |
| livenessProbe | timeout 1 s | timeout 3 s | sob throttling o `/health` passava de 1 s e o pod era reiniciado à toa |

**Validação da configuração final** (com HPA): 400 req/s, o dobro do que 1 pod aguenta sozinho. O HPA viu 137% de CPU, subiu de 1 para 2 pods e o teste passou com **p95 de 2,8 ms e 0% de erro**.
