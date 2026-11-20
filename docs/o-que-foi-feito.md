# O que foi feito e os extras

Este documento resume as decisões do trabalho e o que foi além do mínimo pedido no enunciado.
O relatório formal (capa, evidências e as 8 respostas) está em [`relatorio.pdf`](relatorio.pdf).

## Checklist do enunciado

| Item do enunciado | Onde está | Situação |
|---|---|---|
| Dockerfile enxuto (base, dependências, usuário, comando) | `app/Dockerfile` | feito e testado |
| Imagem com tag 1.0 rodando | `evidencias/parte1-docker.txt` | feito |
| `.dockerignore` | `app/.dockerignore` | feito |
| Compose com API + MySQL + Redis | `docker-compose.yml` | feito |
| Volume, `.env`, healthcheck, depends_on | `docker-compose.yml`, `.env.example` | feito |
| Dado sobrevive a `down` + `up` | `evidencias/parte2-compose.txt` | provado |
| Namespace `n3-guilherme` | `k8s/00-namespace.yaml` | feito |
| ConfigMap e Secret | `k8s/01-configmap.yaml`, `k8s/02-secret.yaml` | feito |
| API: 2 réplicas, readiness/liveness, requests/limits | `k8s/30-api.yaml` | feito |
| Service da API com acesso demonstrado | NodePort 30080 | feito |
| MySQL: Deployment + Service + PVC | `k8s/10-mysql.yaml` | feito |
| Redis: Deployment + Service | `k8s/20-redis.yaml` | feito |
| Persistência no Kubernetes (apagar pod do MySQL) | `evidencias/parte3-k8s.txt` | provado |
| Parte 4: os 6 itens | `comandos.md`, `evidencias/parte4-*.txt` | executados |
| Relatório PDF com capa, 6 evidências e 8 respostas | `docs/relatorio.pdf` | feito |
| `kubectl apply -f k8s/` sobe tudo | `evidencias/parte3-k8s.txt` | testado |
| Sem senhas reais no repositório | `.env` no `.gitignore` | ok |

## Decisões importantes

- **API própria "Loja"**, no lugar do projeto da aula: mesma ideia (Node + MySQL + Redis), escrita do zero e comentada em português para eu conseguir explicar cada parte.
- **`/health` separado de `/ready`.** A liveness não consulta o banco: se o MySQL cair, não faz sentido o Kubernetes reiniciar a API, ele só deve parar de mandar tráfego (readiness). Para isso a API abre a porta HTTP *antes* de o banco estar pronto.
- **MySQL como Deployment + Recreate**, e não StatefulSet: é uma instância só. O Recreate evita dois pods disputando o mesmo volume `ReadWriteOnce` durante uma atualização.
- **initContainer `espera-mysql`**, além da readinessProbe, para mostrar as duas formas de "esperar o banco" no Kubernetes.
- **Rolling update sem queda**: `maxSurge: 1`, `maxUnavailable: 0`, `preStop: sleep 5` e desligamento gracioso no `server.js` (SIGTERM). Foi medido: 0 erros em 218 requisições durante a troca 1.0 → 2.0.
- **Rota `/carga`** gasta CPU de propósito, para o HPA reagir de forma previsível com o gerador busybox.
- **`imagePullPolicy: IfNotPresent`**: no Docker Desktop com kubeadm o cluster usa as imagens do Docker local, sem precisar de registry.

## Extras ("ir além")

1. **Bônus do enunciado:**
   - Dockerfile **multi-stage**;
   - **canary** com um segundo Deployment (`track: canary`) atrás do mesmo Service, com a divisão de tráfego medida;
   - **Ingress NGINX** com justificativa.
2. Testes automatizados da API (`npm test`, sem precisar de banco).
3. Teste de disponibilidade durante o rolling update.
4. HPA com `behavior.scaleDown` ajustado e `kubectl describe hpa` mostrando os eventos de escala.
5. Cache Redis visível (`"origem": "mysql"` / `"cache"`) e contador de visitas compartilhado entre réplicas.
6. Cabeçalhos `X-App-Version` e `X-Pod` em toda resposta.

## Problemas reais encontrados (e como resolvi)

- **`/ready` travava** quando o Redis estava fora: o cliente Redis enfileirava o `ping`. Resolvi com `disableOfflineQueue` e um tempo limite de 2 s em cada verificação.
- **JSON quebrado no PowerShell 5**: `curl.exe -d '{"a":1}'` perde as aspas internas. Passei a usar `Invoke-RestMethod` para o POST e `--patch-file` no `kubectl patch`. A API também passou a responder 400 (e não 500) para JSON inválido.
- **`--cpu-percent` obsoleto** no kubectl 1.36: recriei o HPA com `--cpu=50%`.
- **metrics-server no Docker Desktop**: precisou de `--kubelet-insecure-tls`.

## O que depende de você (aluno)

- Revisar o relatório e as respostas, e ajustar com suas palavras o que achar necessário: o professor avalia a explicação "com suas palavras".
- Conferir nome e turma na capa.
- Enviar o PDF e o link do repositório no portal.
