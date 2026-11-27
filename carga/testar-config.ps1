# Testa UMA configuração da loja-api contra uma taxa fixa de requisições.
#
# Uso (na raiz do projeto):
#   .\carga\testar-config.ps1 -Cpu 100m -Memoria 128Mi -Replicas 1 -Taxa 200
#
# O que faz:
#   1. tira o HPA (senão ele muda o número de réplicas no meio do teste);
#   2. aplica requests = limits = Cpu/Memoria e escala para N réplicas;
#   3. espera o rollout e roda o k6 (carga/teste-carga.js) em container;
#   4. mostra p95, taxa de erro, req/s e reinícios, e grava em carga/resultados.csv.
# No fim, para voltar ao normal: kubectl apply -f k8s/
param(
  [string]$Cpu = "100m",
  [string]$Memoria = "128Mi",
  [int]$Replicas = 1,
  [int]$Taxa = 200,
  [string]$Duracao = "60s",
  [string]$Ns = "n3-guilherme"
)
$ErrorActionPreference = "Stop"
$raiz = Split-Path -Parent $PSScriptRoot

kubectl delete hpa loja-api -n $Ns --ignore-not-found | Out-Null
kubectl set resources deployment/loja-api -n $Ns -c api `
  --requests="cpu=$Cpu,memory=$Memoria" --limits="cpu=$Cpu,memory=$Memoria" | Out-Null
kubectl scale deployment/loja-api -n $Ns --replicas=$Replicas | Out-Null
kubectl rollout status deployment/loja-api -n $Ns --timeout=180s | Out-Null
Start-Sleep -Seconds 5   # deixa os pods novos esquentarem

$resumo = Join-Path $env:TEMP "k6-resumo.json"
Get-Content (Join-Path $PSScriptRoot "teste-carga.js") -Raw |
  docker run --rm -i -e TAXA=$Taxa -e DURACAO=$Duracao -v "$($env:TEMP):/out" grafana/k6:1.3.0 `
    run --quiet --log-output=none --summary-export=/out/k6-resumo.json - | Out-Null

$r = Get-Content $resumo -Raw | ConvertFrom-Json
$p95 = [math]::Round($r.metrics.http_req_duration.'p(95)', 1)
$erro = [math]::Round($r.metrics.http_req_failed.value * 100, 2)
$rps = [math]::Round($r.metrics.http_reqs.rate, 0)
$reinicios = (kubectl get pods -n $Ns -l app=loja-api -o jsonpath='{.items[*].status.containerStatuses[0].restartCount}').Split(' ') |
  Measure-Object -Sum | Select-Object -ExpandProperty Sum
$ok = if ($erro -lt 1 -and $p95 -lt 500) { "AGUENTOU" } else { "NAO AGUENTOU" }

# InvariantCulture: decimal com ponto, para a vírgula do pt-BR não quebrar as colunas do CSV.
$linha = [string]::Format([cultureinfo]::InvariantCulture, "{0},{1},{2},{3},{4},{5},{6},{7}", $Cpu, $Memoria, $Replicas, $Taxa, $rps, $p95, $erro, $ok)
$csv = Join-Path $PSScriptRoot "resultados.csv"
if (-not (Test-Path $csv)) { "cpu,memoria,replicas,taxa_alvo,req_s,p95_ms,erro_pct,resultado" | Out-File $csv -Encoding utf8 }
$linha | Out-File $csv -Append -Encoding utf8
"cpu=$Cpu mem=$Memoria replicas=$Replicas taxa=$Taxa -> req/s=$rps p95=${p95}ms erro=${erro}% reinicios=$reinicios => $ok"
