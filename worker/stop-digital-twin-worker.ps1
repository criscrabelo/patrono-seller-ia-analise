# stop-digital-twin-worker.ps1 (Rodada 9, corrigido na 15.1)
#
# Para o Patrono Generation Worker e, se solicitado, remove o agendamento de
# inicio automatico. Nunca apaga jobs em andamento - o worker offline eh
# tratado normalmente pela fila (heartbeat expira, outro worker retoma).

param(
    [switch]$RemoverInicioAutomatico
)

. (Join-Path $PSScriptRoot "patrono-comum.ps1")

# Remover a tarefa exige o mesmo privilegio que criar. Auto-eleva so quando
# o -RemoverInicioAutomatico for pedido; parar o processo nao precisa disso.
if ($RemoverInicioAutomatico) {
    Invoke-PatronoAutoElevacao -CaminhoScript $PSCommandPath -Parametros @{
        RemoverInicioAutomatico = $RemoverInicioAutomatico
    } | Out-Null
}

# PARADA INTENCIONAL x WATCHDOG (Rodada 15.1)
#
# A tarefa reinicia a acao que termina em erro. Matar o worker e, para o
# Agendador, uma falha - e cada kill gera outro reinicio enfileirado.
# Desabilitar a tarefa nao resolve: medido ao vivo, o reinicio ja enfileirado
# executa mesmo com ela Disabled.
#
# Em vez de brigar com o Agendador, avisamos o wrapper: este flag faz
# start-digital-twin-worker.ps1 encerrar com codigo 0 depois que o worker
# morre. O Windows entende SUCESSO e nao reinicia. O watchdog segue intacto
# para quedas reais, quando o flag nao existe.
$flagParada = Get-PatronoFlagParada
New-Item -ItemType Directory -Path (Split-Path $flagParada -Parent) -Force | Out-Null
Set-Content -Path $flagParada -Value (Get-Date).ToString("o") -Encoding UTF8
Write-PatronoLog "Parada intencional sinalizada - o wrapper vai encerrar com codigo 0." "AVISO"

# NAO chamamos Stop-ScheduledTask aqui, e isso e deliberado.
#
# Medido ao vivo: Stop-ScheduledTask mata o PROPRIO wrapper PowerShell, que
# entao nunca chega a ler o flag nem a encerrar com 0 - e o Agendador ainda
# enfileira um reinicio (visto reaparecer 6s depois, tres vezes seguidas).
#
# Encerrando so o processo node, o wrapper CONTINUA VIVO, percebe a saida do
# worker, ve o flag e encerra com codigo 0. O Windows entende sucesso e nao
# reinicia nada. O watchdog fica intacto para quedas reais.

# Encerra o processo node do worker. O wrapper PowerShell da tarefa sobrevive
# de proposito - e ele quem encerra com 0 e evita o reinicio.
$processo = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*digital-twin-worker.ts*" }

if ($processo) {
    foreach ($p in $processo) {
        Write-Host "Parando worker (PID $($p.ProcessId))..." -ForegroundColor Cyan
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-PatronoLog "Worker parado manualmente (PID $($p.ProcessId))." "AVISO"
    }
    Write-Host "Worker parado." -ForegroundColor Green
    # Da tempo ao wrapper de perceber a saida, ler o flag e encerrar com 0.
    Start-Sleep -Seconds 6
} else {
    Write-Host "Nenhum processo de worker em execucao." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "O worker vai permanecer PARADO ate:" -ForegroundColor Cyan
Write-Host "  - voce rodar .\start-digital-twin-worker.ps1; ou"
Write-Host "  - o proximo logon no Windows; ou"
Write-Host "  - Start-ScheduledTask -TaskName PatronoDigitalTwinWorker"

if ($RemoverInicioAutomatico) {
    $tarefaParaRemover = Get-ScheduledTask -TaskName "PatronoDigitalTwinWorker" -ErrorAction SilentlyContinue
    if ($tarefaParaRemover) {
        Unregister-ScheduledTask -TaskName "PatronoDigitalTwinWorker" -Confirm:$false
        Write-PatronoLog "Inicio automatico REMOVIDO a pedido do usuario." "AVISO"
        Write-Host "Inicio automatico removido (nao inicia mais sozinho no logon)." -ForegroundColor Green
    } else {
        Write-Host "Nenhum agendamento de inicio automatico encontrado." -ForegroundColor Yellow
    }
} else {
    Write-Host "Inicio automatico PRESERVADO e ATIVO (use -RemoverInicioAutomatico para remover)." -ForegroundColor Green
}
