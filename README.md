# Loja N3: Docker, Docker Compose e Kubernetes

Atividade Avaliativa N3 de **DevOps & Cloud Computing** (ADS, 4º semestre, UNIFASIPE).
Aluno: **Guilherme Bastian** · Namespace: **`n3-guilherme`**

Uma API "Loja" em **Node.js** (Express) com **MySQL** (produtos) e **Redis** (cache e contador de visitas):

1. empacotada com **Docker** (Dockerfile multi-stage, usuário sem root);
2. orquestrada com **Docker Compose** (volume, `.env`, healthcheck, depends_on);
3. publicada no **Kubernetes** com manifestos YAML (ConfigMap, Secret, PVC, probes, requests/limits);
4. operada por linha de comando (escala, rolling update, rollback, recursos, HPA).

Tudo foi executado de verdade no Docker Desktop 4.99 com Kubernetes v1.36.1 (kubeadm). As saídas estão em [`evidencias/`](evidencias/) e os comandos, na ordem em que rodei, em [`comandos.md`](comandos.md).

**Desafio MCD:** teste de carga com k6 e regulagem da menor configuração que aguenta as requisições em [`carga/README-MCD.md`](carga/README-MCD.md).

## Início rápido (máquina limpa, ex.: laboratório da FASIPE)

Precisa só do Git e do Docker Desktop com o Kubernetes ligado (Settings → Kubernetes → Enable, modo kubeadm).

```powershell
git clone https://github.com/GuiiWu/Atividade-DevOps-N3.git
cd Atividade-DevOps-N3

# 1. metrics-server (HPA e kubectl top)
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file k8s-extras/metrics-server-patch.json

# 2. imagem da API (o cluster do Docker Desktop usa as imagens locais)
docker build -t loja-api:1.0 --build-arg APP_VERSION=1.0 ./app

# 3. sobe tudo: namespace, configmap, secret, mysql, redis, api e HPA
kubectl apply -f k8s/
kubectl get pods,hpa -n n3-guilherme -w      # Ctrl+C quando tudo estiver Running/1/1

# 4. confere e roda o teste de carga
curl.exe http://localhost:30080/produtos
Get-Content carga/teste-carga.js -Raw | docker run --rm -i -e TAXA=200 grafana/k6:1.3.0 run -
```

O MySQL leva cerca de 1 minuto na primeira subida. Até lá a API fica `0/1` (esperando no initContainer), e isso é normal.

## Estrutura

```
.
├── app/                    código da API, Dockerfile, .dockerignore, testes
│   ├── src/                config.js, db.js (MySQL), cache.js (Redis), app.js (rotas), server.js
│   └── test/               testes que rodam sem banco (npm test)
├── docker-compose.yml      API + MySQL + Redis
├── .env.example            variáveis do Compose (senhas só de exemplo)
├── k8s/                    manifestos da Parte 3 (kubectl apply -f k8s/)
├── k8s-extras/             gerador de carga, canary, Ingress e patches (Parte 4 e bônus)
├── carga/                  Desafio MCD: script k6, script de varredura e resultados
├── comandos.md             comandos da Parte 4, na ordem em que executei
├── evidencias/             saídas reais de cada comando
└── docs/                   relatório (PDF e HTML) e explicação do que foi feito
```

## Rotas da API

| Rota | O que faz |
|---|---|
| `GET /` | versão, mensagem, nome do pod que respondeu e contador de visitas (Redis) |
| `GET /health` | **liveness**: o processo está vivo (não consulta o banco de propósito) |
| `GET /ready` | **readiness**: 200 só quando MySQL e Redis respondem; senão 503 |
| `GET /produtos` | lista de produtos; o campo `origem` mostra se veio do `mysql` ou do `cache` |
| `GET /produtos/:id` | um produto (lido direto do MySQL) |
| `POST /produtos` | cria produto `{"nome": "...", "preco": 10.5}` e limpa o cache |
| `DELETE /produtos/:id` | remove produto |
| `GET /carga?ms=50` | gasta CPU por N ms (usado no teste do HPA) |

Toda resposta traz os cabeçalhos `X-App-Version` e `X-Pod`.

## Pré-requisitos

- Docker Desktop com **Kubernetes ligado no modo kubeadm** (Settings → Kubernetes). No modo kubeadm o cluster enxerga as imagens do Docker local, então não é preciso registry.
- PowerShell (os comandos abaixo foram testados no Windows PowerShell 5.1).

## 1. Docker: imagem da API

```powershell
docker build -t loja-api:1.0 --build-arg APP_VERSION=1.0 ./app
docker run -d --name loja-teste -p 3001:3000 loja-api:1.0
curl.exe http://localhost:3001/health
docker rm -f loja-teste
```

Sem banco, `/health` responde 200 e `/ready` responde 503. É o comportamento esperado.

## 2. Docker Compose

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
curl.exe http://localhost:3000/
curl.exe http://localhost:3000/produtos
```

Para criar um produto no PowerShell (o `curl.exe` com JSON no PowerShell 5 quebra as aspas):

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/produtos -ContentType "application/json; charset=utf-8" -Body '{"nome":"Teste","preco":10}'
```

Para provar a persistência: `docker compose down`, depois `docker compose up -d`, e o produto continua lá. Os dados só somem com `docker compose down -v`, que apaga os volumes.

## 3. Kubernetes

```powershell
# metrics-server (necessário para kubectl top e HPA); o patch libera o TLS do kubelet do Docker Desktop
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file k8s-extras/metrics-server-patch.json

# imagem que o Deployment usa
docker build -t loja-api:1.0 --build-arg APP_VERSION=1.0 ./app

# sobe tudo (namespace, configmap, secret, mysql+pvc, redis, api)
kubectl apply -f k8s/
kubectl get all -n n3-guilherme
curl.exe http://localhost:30080/
```

> **Atenção:** o Deployment usa a imagem `loja-api:1.0` construída localmente (`imagePullPolicy: IfNotPresent`), sem registry. Por isso o `docker build` precisa rodar na mesma máquina do cluster (Docker Desktop com kubeadm). No Killercoda ou em outro cluster, rode o build no próprio nó ou publique a imagem num registry e troque o campo `image` em `k8s/30-api.yaml`.

A API fica em **http://localhost:30080** (Service NodePort). O namespace `n3-guilherme` é criado pelo próprio `k8s/00-namespace.yaml`.

| Arquivo | Recursos |
|---|---|
| `k8s/00-namespace.yaml` | Namespace `n3-guilherme` |
| `k8s/01-configmap.yaml` | ConfigMap `loja-api-config` (host do banco/Redis, porta, mensagem...) |
| `k8s/02-secret.yaml` | Secret `loja-db-secret` (senhas de exemplo em base64) |
| `k8s/10-mysql.yaml` | PVC `mysql-pvc` (1Gi) + Deployment `mysql` (Recreate) + Service `mysql` |
| `k8s/20-redis.yaml` | Deployment `redis` + Service `redis` |
| `k8s/30-api.yaml` | Deployment `loja-api` (1 réplica, initContainer, probes, requests/limits, RollingUpdate) + Service NodePort `loja-api` |
| `k8s/40-hpa.yaml` | HPA `loja-api` (1 a 4 réplicas, 70% de CPU) |

Na N3 o YAML guardava o estado inicial (2 réplicas, requests 100m/96Mi), e o HPA foi criado por comando (`comandos.md`). Para o **Desafio MCD**, réplicas, requests/limits e HPA foram regulados pelo teste de carga, e o HPA virou YAML. Os detalhes estão em [`carga/README-MCD.md`](carga/README-MCD.md).

## 4. Operação (Parte 4) e bônus

Veja [`comandos.md`](comandos.md). Resumo do que foi demonstrado:

- escala manual 2 → 4 → 2;
- rolling update 1.0 → 2.0 com **0 erros** em 218 requisições durante a troca;
- imagem inexistente (`ImagePullBackOff`), diagnóstico com `describe pod`/`get events` e `rollout undo`;
- `kubectl set resources` e conferência no `describe pod`;
- HPA (mín. 2, máx. 6, 50% de CPU) subindo e descendo com carga gerada dentro do cluster;
- `kubectl describe node` explicado no relatório.

**Bônus:** Dockerfile multi-stage, **canary** (`k8s-extras/canary.yaml`) e **Ingress** (`k8s-extras/ingress.yaml`) com justificativa.

## Testes da API

```powershell
cd app
npm install
npm test
```

## Limpeza

```powershell
docker compose down -v
kubectl delete namespace n3-guilherme
```

## Segurança

As senhas do `.env.example` e do `k8s/02-secret.yaml` são **de exemplo, só para laboratório**. O `.env` real está no `.gitignore`.
