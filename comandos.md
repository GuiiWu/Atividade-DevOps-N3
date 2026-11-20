# Comandos da Parte 4 (na ordem em que executei)

Ambiente: Windows 11 + PowerShell 5.1, Docker Desktop 4.99 com Kubernetes v1.36.1 (kubeadm), nó único `docker-desktop`.
Namespace: **`n3-guilherme`**. Data da execução: 20/11/2026.

Cada comando abaixo foi executado em **uma linha só**. As saídas completas, com horário, estão em:

- [`evidencias/parte4-operacao.txt`](evidencias/parte4-operacao.txt): itens 0 a 5
- [`evidencias/parte4-hpa.txt`](evidencias/parte4-hpa.txt) e [`evidencias/parte4-hpa-watch.txt`](evidencias/parte4-hpa-watch.txt): teste de carga do HPA
- [`evidencias/parte4-node.txt`](evidencias/parte4-node.txt): item 6
- [`evidencias/bonus.txt`](evidencias/bonus.txt): canary e Ingress

Antes da Parte 4, a Parte 3 já estava aplicada (`kubectl apply -f k8s/`, ver [`evidencias/parte3-k8s.txt`](evidencias/parte3-k8s.txt)).

---

## 0. Preparação: metrics-server

O HPA e o `kubectl top` precisam do metrics-server, que o Docker Desktop não traz. Instalei pelo manifesto oficial e adicionei `--kubelet-insecure-tls`, porque o certificado do kubelet do Docker Desktop não é assinado pela CA do cluster.

```powershell
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch deployment metrics-server -n kube-system --type=json --patch-file k8s-extras/metrics-server-patch.json
kubectl rollout status deployment/metrics-server -n kube-system --timeout=180s
```

> Usei `--patch-file` porque o PowerShell 5 remove as aspas internas de um JSON passado direto em `-p '...'`, e o servidor rejeita o patch. Essa primeira tentativa falhou exatamente por isso.

## 1. Escalar na mão (2 → 4 → 2)

```powershell
kubectl get deployment loja-api -n n3-guilherme
kubectl scale deployment loja-api --replicas=4 -n n3-guilherme
kubectl rollout status deployment/loja-api -n n3-guilherme --timeout=180s
kubectl get deployment loja-api -n n3-guilherme
kubectl get pods -n n3-guilherme -l app=loja-api -o wide
kubectl scale deployment loja-api --replicas=2 -n n3-guilherme
kubectl get pods -n n3-guilherme -l app=loja-api
kubectl get deployment loja-api -n n3-guilherme
```

**Resultado:** foi de `2/2` para `4/4`, com 2 pods novos criados em ~9 s, e voltou para `2/2`. O Kubernetes removeu os 2 pods mais novos e manteve os originais.

## 2. Atualizar sem derrubar (1.0 → 2.0)

A mudança visível da 2.0 é o campo `versao` na resposta da API e o cabeçalho `X-App-Version`, vindos do `--build-arg APP_VERSION=2.0`.

```powershell
docker build -t loja-api:2.0 --build-arg APP_VERSION=2.0 ./app
docker images loja-api
kubectl set image deployment/loja-api api=loja-api:2.0 -n n3-guilherme
kubectl annotate deployment/loja-api -n n3-guilherme kubernetes.io/change-cause="atualiza para 2.0 (kubectl set image)" --overwrite
kubectl rollout status deployment/loja-api -n n3-guilherme --timeout=180s
kubectl rollout history deployment/loja-api -n n3-guilherme
kubectl get pods -n n3-guilherme -l app=loja-api
curl.exe -s http://localhost:30080/
```

Durante o rollout, deixei um laço em paralelo chamando `/health` a cada 200 ms por 45 s:

```powershell
$res=@(); $fim=(Get-Date).AddSeconds(45); while ((Get-Date) -lt $fim) { try { $res += (Invoke-RestMethod http://localhost:30080/health -TimeoutSec 3).versao } catch { $res += 'ERRO' }; Start-Sleep -Milliseconds 200 }; $res | Group-Object | Select Name,Count
```

**Resultado:** `1.0=112, 2.0=106`, **nenhum ERRO**. A troca não derrubou a API, por causa de `maxSurge: 1`, `maxUnavailable: 0`, readinessProbe e `preStop: sleep 5`.

## 3. Falha proposital e recuperação

```powershell
kubectl set image deployment/loja-api api=loja-api:9.9-nao-existe -n n3-guilherme
kubectl annotate deployment/loja-api -n n3-guilherme kubernetes.io/change-cause="falha proposital: imagem 9.9-nao-existe" --overwrite
kubectl rollout status deployment/loja-api -n n3-guilherme --timeout=40s
kubectl get pods -n n3-guilherme -l app=loja-api
kubectl describe pod loja-api-7fbbb68db7-7cvlh -n n3-guilherme
kubectl get events -n n3-guilherme --field-selector type=Warning --sort-by=.lastTimestamp
curl.exe -s http://localhost:30080/health
kubectl rollout history deployment/loja-api -n n3-guilherme
kubectl rollout undo deployment/loja-api -n n3-guilherme
kubectl rollout status deployment/loja-api -n n3-guilherme --timeout=120s
kubectl get pods -n n3-guilherme -l app=loja-api
kubectl rollout history deployment/loja-api -n n3-guilherme
curl.exe -s http://localhost:30080/health
```

**Resultado:**

- `rollout status` estourou o tempo (`timed out waiting for the condition`), e o pod novo ficou `0/1 ImagePullBackOff`.
- O `describe pod`, na seção **Events**, mostrou a causa: `Failed to pull image "loja-api:9.9-nao-existe": pull access denied for loja-api, repository does not exist`. Os estados foram `ErrImagePull`, depois `ImagePullBackOff`, com novas tentativas cada vez mais espaçadas.
- Enquanto isso, os 2 pods da 2.0 continuaram atendendo (`/health` → `versao 2.0`), porque com `maxUnavailable: 0` o Kubernetes não derruba os pods antigos antes de o novo ficar pronto.
- O `rollout undo` voltou para a 2.0. No histórico, a revisão 2 virou a **4**, porque o undo cria uma revisão nova com o template anterior.

## 4. Limitar recursos

```powershell
kubectl set resources deployment loja-api -c api --requests=cpu=100m,memory=128Mi --limits=cpu=400m,memory=256Mi -n n3-guilherme
kubectl annotate deployment/loja-api -n n3-guilherme kubernetes.io/change-cause="set resources: requests 100m/128Mi, limits 400m/256Mi" --overwrite
kubectl rollout status deployment/loja-api -n n3-guilherme --timeout=120s
kubectl describe pod <pod-da-api> -n n3-guilherme
kubectl get pods -n n3-guilherme -l app=loja-api -o custom-columns=POD:.metadata.name,REQ_CPU:.spec.containers[0].resources.requests.cpu,REQ_MEM:.spec.containers[0].resources.requests.memory,LIM_CPU:.spec.containers[0].resources.limits.cpu,LIM_MEM:.spec.containers[0].resources.limits.memory,QOS:.status.qosClass
```

**Resultado:** o `describe pod` mostra `Limits: cpu 400m, memory 256Mi` e `Requests: cpu 100m, memory 128Mi`, com QoS `Burstable`. Mudar o template gerou um novo rollout, e os pods foram recriados com os novos valores.

## 5. Autoscaling (HPA)

```powershell
kubectl top nodes
kubectl top pods -n n3-guilherme
kubectl autoscale deployment loja-api --min=2 --max=6 --cpu=50% -n n3-guilherme
kubectl patch hpa loja-api -n n3-guilherme --type=merge --patch-file k8s-extras/hpa-behavior-patch.json
kubectl get hpa loja-api -n n3-guilherme -w
```

> Na primeira vez usei `--cpu-percent=50`, que o kubectl 1.36 avisou estar obsoleto (`Use --cpu with percentage`). Apaguei o HPA e recriei com `--cpu=50%`.
> O patch `hpa-behavior-patch.json` reduz a janela de estabilização da descida de 300 s (padrão) para 60 s, só para a demonstração caber no tempo da aula.

Em outro terminal, a carga **dentro do cluster** (3 pods busybox com `wget` em loop no Service `loja-api`):

```powershell
kubectl apply -f k8s-extras/gerador-carga.yaml
kubectl top pods -n n3-guilherme
kubectl get pods -n n3-guilherme -l app=loja-api
kubectl describe hpa loja-api -n n3-guilherme
kubectl delete -f k8s-extras/gerador-carga.yaml
kubectl get hpa -n n3-guilherme
kubectl top pods -n n3-guilherme
```

**Resultado** (ver [`evidencias/parte4-hpa-watch.txt`](evidencias/parte4-hpa-watch.txt)):

| Fase | Horário | CPU (média ÷ alvo) | Réplicas |
|---|---|---|---|
| Antes | 10:33–10:34 | 1% / 50% | 2 |
| Durante (gerador ligado às 10:34:09) | 10:34:39 | 311% / 50% | 2 → **6** (máximo) |
| Durante | 10:35–10:38 | ~207–214% / 50% | 6 |
| Depois (gerador apagado às 10:38:11) | 10:39:43 | 2% / 50% | 6 (janela de 60 s) |
| Depois | 10:40:44 | 1% / 50% | **2** (mínimo) |

O `kubectl describe hpa` registrou os dois eventos: `New size: 6; reason: cpu resource utilization (percentage of request) above target` e `New size: 2; reason: All metrics below target`.

## 6. Nó

```powershell
kubectl describe node docker-desktop
```

**Resultado:** `Capacity` = 12 CPUs e 8104720Ki (~7,7 GiB) de memória, que é o que o WSL 2 entrega à VM do Docker. `Allocatable` = 12 CPUs e 8002320Ki, ou seja, a capacidade menos o que fica reservado para o sistema e o kubelet. `Allocated resources` = soma das requests e limits de todos os pods do nó (1450m de CPU = 12%, 1272Mi de memória = 16% de requests no momento). A explicação completa está no relatório.

---

## Bônus

### Canary (versão 3.0 para ~1/3 do tráfego)

```powershell
docker build -t loja-api:3.0 --build-arg APP_VERSION=3.0 ./app
kubectl apply -f k8s-extras/canary.yaml
kubectl rollout status deployment/loja-api-canary -n n3-guilherme --timeout=120s
kubectl get pods -n n3-guilherme -l app=loja-api -L track
kubectl get endpointslices -n n3-guilherme -l kubernetes.io/service-name=loja-api
1..90 | ForEach-Object { (curl.exe -s http://localhost:30080/health | ConvertFrom-Json).versao } | Group-Object | ForEach-Object { "versao $($_.Name): $($_.Count) de 90 requisicoes" }
```

**Resultado:** com 2 pods stable (2.0) e 1 canary (3.0) atrás do mesmo Service, `versao 2.0: 65` e `versao 3.0: 25` de 90 requisições (28% no canary). Depois promovi a versão:

```powershell
kubectl set image deployment/loja-api api=loja-api:3.0 -n n3-guilherme
kubectl annotate deployment/loja-api -n n3-guilherme kubernetes.io/change-cause="promove canary: 3.0 para todos" --overwrite
kubectl rollout status deployment/loja-api -n n3-guilherme --timeout=180s
kubectl delete -f k8s-extras/canary.yaml
```

Resultado: 30 de 30 requisições na 3.0.

### Ingress

```powershell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/cloud/deploy.yaml
kubectl wait --namespace ingress-nginx --for=condition=Ready pod --selector=app.kubernetes.io/component=controller --timeout=240s
kubectl apply -f k8s-extras/ingress.yaml
kubectl get ingress -n n3-guilherme
curl.exe -s -H "Host: loja.localhost" http://localhost/
curl.exe -s http://loja.localhost/health
```

Resultado: a API responde na porta 80 pelo host `loja.localhost`; um host fora das regras recebe 404.

## Evidências finais (estado ao terminar)

```powershell
kubectl get all -n n3-guilherme
kubectl describe deployment loja-api -n n3-guilherme
kubectl rollout history deployment/loja-api -n n3-guilherme
kubectl get hpa -n n3-guilherme
kubectl top pods -n n3-guilherme
```

Saídas em [`evidencias/final.txt`](evidencias/final.txt).
