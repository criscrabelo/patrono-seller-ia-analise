# P2.46.1 — Diagnóstico de MEMÓRIA do Windows (SOMENTE LEITURA: não fecha, não altera, não instala nada).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\desempenho\diagnostico-memoria.ps1 [-Amostra 60]
# Gera %LOCALAPPDATA%\PatronoSeller\desempenho\diagnostico-AAAA-MM-DD_HHmm.md com: RAM e memória comprometida,
# 10 maiores processos, agrupamento por aplicativo (duplicidades), crescimento em N segundos (possível vazamento),
# processos do Patrono Seller e itens antigos (abertos há mais de 3 dias). Não registra argumentos de linha de comando
# (podem conter caminhos ou segredos) nem dados corporativos.
param([int]$Amostra = 60)
$ErrorActionPreference = 'SilentlyContinue'
$dir = Join-Path $env:LOCALAPPDATA 'PatronoSeller\desempenho'; New-Item -ItemType Directory -Force $dir | Out-Null
$arq = Join-Path $dir ("diagnostico-{0}.md" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$os = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem
$tot = $cs.TotalPhysicalMemory / 1GB; $livre = $os.FreePhysicalMemory / 1MB
$L = New-Object System.Collections.Generic.List[string]
$L.Add("# Diagnóstico de memória — $(Get-Date -Format 'dd/MM/yyyy HH:mm')`n")
$L.Add(("- RAM: **{0:N1} GB**, disponível **{1:N1} GB** ({2:P0} em uso)" -f $tot, $livre, (1 - $livre / $tot)))
$L.Add(("- Memória comprometida: {0:N1} GB de {1:N1} GB" -f (($os.TotalVirtualMemorySize - $os.FreeVirtualMemory) / 1MB), ($os.TotalVirtualMemorySize / 1MB)))
$L.Add(("- Windows ligado desde {0:dd/MM HH:mm} ({1:N1} dias)" -f $os.LastBootUpTime, ((Get-Date) - $os.LastBootUpTime).TotalDays))
$p = Get-Process | Where-Object { $_.Id -ne 0 }
$L.Add("`n## 10 maiores processos (memória privada)`n`n| Processo | PID | MB | aberto desde |`n|---|---|---|---|")
foreach ($x in ($p | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 10)) { $L.Add(("| {0} | {1} | {2:N0} | {3} |" -f $x.ProcessName, $x.Id, ($x.PrivateMemorySize64 / 1MB), $(try { $x.StartTime.ToString('dd/MM HH:mm') } catch { '-' }))) }
$L.Add("`n## Por aplicativo (soma; muitas instâncias = abas/janelas/duplicidades)`n`n| Aplicativo | instâncias | MB |`n|---|---|---|")
foreach ($g in ($p | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ N = $_.Name; Q = $_.Count; MB = ($_.Group | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB } } | Sort-Object MB -Descending | Select-Object -First 12)) { $L.Add(("| {0} | {1} | {2:N0} |" -f $g.N, $g.Q, $g.MB)) }
# Crescimento: amostra dos 8 maiores
$top = $p | Sort-Object PrivateMemorySize64 -Descending | Select-Object -First 8
$a = @{}; foreach ($x in $top) { $a[$x.Id] = $x.PrivateMemorySize64 }
Start-Sleep -Seconds $Amostra
$L.Add("`n## Crescimento em $Amostra s (crescimento contínuo pode indicar vazamento)`n`n| Processo | PID | variação MB |`n|---|---|---|")
foreach ($x in $top) { $n = Get-Process -Id $x.Id; if ($n) { $L.Add(("| {0} | {1} | {2:+0;-0;0} |" -f $n.ProcessName, $x.Id, (($n.PrivateMemorySize64 - $a[$x.Id]) / 1MB))) } }
$L.Add("`n## Patrono Seller (processos locais)`n")
foreach ($w in (Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|python|ffmpeg)\.exe$' })) {
  $tipo = if ($w.CommandLine -match 'com-banco-de-producao') { 'invólucro do banco' } elseif ($w.CommandLine -match 'next[\\/]dist[\\/]bin[\\/]next') { 'Operação local (servidor)' } elseif ($w.CommandLine -match 'operacao-local-supervisor') { 'supervisor da Operação' } elseif ($w.CommandLine -match 'narracao_voz|gerar_tomadas') { 'SÍNTESE DE VOZ' } elseif ($w.CommandLine -match 'verificar_pronuncia') { 'conferência de pronúncia' } elseif ($w.Name -eq 'ffmpeg.exe') { 'FFmpeg (vídeo)' } else { 'outro node/python' }
  $pr = Get-Process -Id $w.ProcessId; $L.Add(("- {0}: PID {1}, {2:N0} MB" -f $tipo, $w.ProcessId, ($pr.PrivateMemorySize64 / 1MB))) }
$L.Add("`n## Abertos há mais de 3 dias (candidatos a revisar — NADA foi fechado)`n")
foreach ($x in ($p | Where-Object { try { ((Get-Date) - $_.StartTime).TotalDays -gt 3 -and $_.PrivateMemorySize64 -gt 150MB } catch { $false } } | Sort-Object PrivateMemorySize64 -Descending)) { $L.Add(("- {0} (PID {1}): {2:N0} MB, desde {3:dd/MM}" -f $x.ProcessName, $x.Id, ($x.PrivateMemorySize64 / 1MB), $x.StartTime)) }
$L | Set-Content -Encoding UTF8 $arq
Write-Output $arq
