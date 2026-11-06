# setup-digital-twin-worker.ps1 (Rodada 8, atualizado na Rodada 9)
#
# Instalacao assistida do Patrono Generation Worker no Windows. Objetivo:
# a proprietaria nunca precisa digitar comandos manualmente todo dia -
# este script roda UMA VEZ para preparar o ambiente.
#
# REGRA DE SEGURANCA: este script DETECTA o que falta, mas NUNCA instala/
# altera driver de GPU (NVIDIA) automaticamente. Se o driver nao estiver
# presente ou o CUDA nao for compativel, o script para e mostra
# instrucoes - nunca faz uma alteracao de sistema arriscada sozinho.
#
# Rode primeiro diagnose-digital-twin-worker.ps1 para ver o diagnostico
# completo antes de instalar (regra 5 da Rodada 9).

param(
    [switch]$PularInicioAutomatico,
    [string]$VenvPath,
    # Passados adiante para a tarefa agendada (Rodada 15.1). Sem -EnvFile, a
    # tarefa sobe o worker sem DATABASE_URL: ele sai com codigo 1 e o
    # watchdog o reinicia em laco a cada 2 minutos - verificado ao vivo.
    [string]$EnvFile,
    [string]$ExigirRef
)

. (Join-Path $PSScriptRoot "resolver-venv.ps1")
. (Join-Path $PSScriptRoot "patrono-comum.ps1")

Write-Host "=== Patrono Generation Worker - instalacao ===" -ForegroundColor Cyan

# O processo ELEVADO comeca noutro diretorio de trabalho (normalmente
# System32), entao um caminho relativo passado pela linha de comando deixaria
# de resolver depois da elevacao - verificado ao vivo. Resolvemos aqui, antes,
# e repassamos absoluto.
if ($EnvFile -and -not [System.IO.Path]::IsPathRooted($EnvFile)) {
    $tentativa = Resolve-Path $EnvFile -ErrorAction SilentlyContinue
    if (-not $tentativa) { $tentativa = Resolve-Path (Join-Path $PSScriptRoot $EnvFile) -ErrorAction SilentlyContinue }
    if ($tentativa) { $EnvFile = $tentativa.Path }
}

# AUTO-ELEVACAO (Rodada 15). Registrar tarefa agendada exige privilegio
# administrativo nesta maquina - verificado em teste: mesmo uma tarefa nova,
# so com AtLogOn e na pasta raiz, e recusada com 0x80070005 sem elevacao, e
# `schtasks /Create` idem. O usuario usuario-exemplo E administrador local; com UAC, a
# sessao normal apenas nao esta elevada.
#
# Em vez de exigir "abra o PowerShell como administrador" toda vez, o script
# se reergue sozinho e continua. Nada de politica do Windows, GPO, UAC,
# Defender ou firewall e alterado - so este processo pede o privilegio que
# ja pertence ao usuario.
if (-not $PularInicioAutomatico) {
    Invoke-PatronoAutoElevacao -CaminhoScript $PSCommandPath -Parametros @{
        VenvPath = $VenvPath
        EnvFile = $EnvFile
        ExigirRef = $ExigirRef
        PularInicioAutomatico = $PularInicioAutomatico
    } | Out-Null
}

Write-PatronoLog "Setup iniciado (elevado=$(Test-PatronoElevado))." "INFO" "setup.log" 

function Test-Command($nome) {
    return [bool](Get-Command $nome -ErrorAction SilentlyContinue)
}

# Descobre um Python REAL. `Get-Command python` sozinho nao serve no Windows:
# ele encontra o atalho da Microsoft Store em WindowsApps, que nao e um
# interpretador - responde "Python was not found" e faz o venv falhar.
# Verificado na maquina da proprietaria: o diagnostico chegou a reportar
# "pythonDisponivel: true" por causa desse atalho, sem haver Python algum.
function Get-PythonReal {
    $candidatos = @()
    if ($env:DIGITAL_TWIN_PYTHON) { $candidatos += $env:DIGITAL_TWIN_PYTHON }
    $candidatos += "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
    $candidatos += (Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Directory -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "python.exe" })
    $doPath = (Get-Command python -ErrorAction SilentlyContinue).Source
    if ($doPath -and $doPath -notlike "*\WindowsApps\*") { $candidatos += $doPath }

    foreach ($c in $candidatos) {
        if (-not $c -or -not (Test-Path $c)) { continue }
        $v = & $c --version 2>&1
        if ($LASTEXITCODE -eq 0 -and "$v" -match "^Python 3") { return @{ Caminho = $c; Versao = "$v" } }
    }
    return $null
}

# 1. Detectar Python
$python = Get-PythonReal
if (-not $python) {
    Write-Host "Python 3 nao encontrado." -ForegroundColor Yellow
    Write-Host "Instale com:  winget install --id Python.Python.3.11 --scope user" -ForegroundColor Yellow
    Write-Host "(ou baixe em https://www.python.org/downloads/) e rode este script de novo." -ForegroundColor Yellow
    exit 1
}
$pythonBin = $python.Caminho
Write-Host "Python detectado: $($python.Versao)  ($pythonBin)"

# 2. Detectar FFmpeg (o projeto ja usa ffmpeg-static via npm, mas o worker
#    Python pode precisar de um ffmpeg no PATH para pos-processamento).
if (-not (Test-Command "ffmpeg")) {
    Write-Host "FFmpeg nao encontrado no PATH. O renderer principal do Patrono ja traz o proprio (ffmpeg-static)." -ForegroundColor Yellow
} else {
    Write-Host "FFmpeg detectado no PATH."
}

# 3. Detectar GPU NVIDIA / CUDA - SO DETECTA, nunca instala driver.
$temNvidia = Test-Command "nvidia-smi"
if ($temNvidia) {
    Write-Host "GPU NVIDIA detectada (nvidia-smi encontrado)." -ForegroundColor Green
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
} else {
    Write-Host "Nenhuma GPU NVIDIA detectada. O worker vai rodar em modo CPU (fallback: voz + motion graphics)." -ForegroundColor Yellow
}

# 4. Criar ambiente virtual Python ISOLADO (nunca polui o Python do sistema).
#    O local NAO e fixo dentro do repositorio: em caminho profundo (OneDrive)
#    a instalacao do PyTorch estoura o limite de 260 caracteres do Windows.
#    Ver worker/resolver-venv.ps1 para o porque e a ordem de resolucao.
$venvPath = Get-CaminhoVenvDigitalTwin -VenvPath $VenvPath -RaizWorker $PSScriptRoot
if (-not $venvPath) {
    $venvPath = Get-CaminhoVenvParaCriar -VenvPath $VenvPath -RaizWorker $PSScriptRoot
    Write-Host "Criando ambiente virtual isolado em $venvPath ..."
    & $pythonBin -m venv $venvPath
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Falha ao criar o ambiente virtual." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Ambiente virtual ja existe em $venvPath"
}

# 5. Instalar dependencias fixas (requirements-chatterbox.txt) - versoes
#    pinadas, sem poluir o runtime principal do Patrono.
$requirements = Join-Path $PSScriptRoot "requirements-chatterbox.txt"
& "$venvPath\Scripts\pip.exe" install --quiet --upgrade pip
& "$venvPath\Scripts\pip.exe" install -r $requirements

Write-Host ""
Write-Host "Instalacao concluida. Os pesos do modelo (Chatterbox/MuseTalk) sao" -ForegroundColor Cyan
Write-Host "baixados automaticamente na primeira execucao real, a partir do" -ForegroundColor Cyan
Write-Host "Hugging Face Hub - NUNCA versionados neste repositorio." -ForegroundColor Cyan

# 6. Inicio automatico (regra 24) - mecanismo NATIVO do Windows (Task
#    Scheduler), sem instalar nada de terceiros. Sempre pede confirmacao -
#    nunca se auto-registra silenciosamente.
if (-not $PularInicioAutomatico) {
    Write-Host ""
    $resposta = Read-Host "Quer que o processador de videos inicie sozinho quando voce entrar no Windows? (s/n)"
    if ($resposta -eq 's') {
        # O -VenvPath e passado explicitamente: a tarefa agendada roda numa
        # sessao propria, sem as variaveis de ambiente desta janela, e nao
        # teria como descobrir um venv fora do local padrao.
        # O worker precisa do ambiente para achar o banco. A tarefa agendada
        # NAO herda variaveis de nenhum terminal, entao o -EnvFile e repassado
        # explicitamente; sem ele o worker sai com codigo 1 e o watchdog entra
        # em laco de reinicio.
        $argumentosStart = "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\start-digital-twin-worker.ps1`" -VenvPath `"$venvPath`""
        if ($EnvFile) {
            $envAbsoluto = (Resolve-Path $EnvFile -ErrorAction SilentlyContinue)
            if (-not $envAbsoluto) {
                Write-Host "Arquivo de ambiente nao encontrado: $EnvFile" -ForegroundColor Red
                Write-PatronoLog "EnvFile informado nao existe: $EnvFile" "ERRO" "setup.log"
                throw "Arquivo de ambiente nao encontrado: $EnvFile"
            }
            $argumentosStart += " -EnvFile `"$($envAbsoluto.Path)`""
        } else {
            Write-Host "AVISO: nenhum -EnvFile informado. A tarefa vai subir o worker sem" -ForegroundColor Yellow
            Write-Host "       variaveis de ambiente, e ele encerrara com erro por falta de banco." -ForegroundColor Yellow
            Write-Host "       Rode novamente com -EnvFile para um inicio automatico funcional." -ForegroundColor Yellow
            Write-PatronoLog "Tarefa registrada SEM EnvFile - o worker vai falhar no logon." "AVISO" "setup.log"
        }
        if ($ExigirRef) { $argumentosStart += " -ExigirRef `"$ExigirRef`"" }

        $acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentosStart

        # GATILHO: SOMENTE AtLogOn (Rodada 15).
        #
        # O -AtStartup foi REMOVIDO. Ele nao e tecnicamente necessario aqui: o
        # worker depende do perfil do usuario (projeto dentro do OneDrive,
        # Node/npm do perfil, venv em C:\patrono-venv, variaveis do usuario).
        # Rodar antes do logon exigiria conta de servico/SYSTEM, que nao teria
        # esse ambiente - e ainda elevaria o privilegio sem necessidade.
        #
        # Como ha um unico usuario nesta maquina e ele faz logon apos qualquer
        # reinicializacao, AtLogOn cobre o cenario de reboot por completo.
        $gatilhos = @( New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME" )

        # PRINCIPAL EXPLICITO, com o MENOR privilegio que funciona.
        #
        # RunLevel Limited de proposito: o worker nao precisa de privilegio
        # elevado para rodar - so o REGISTRO da tarefa precisava. Registrar
        # elevado e executar limitado e o par correto.
        $principal = New-ScheduledTaskPrincipal `
            -UserId "$env:USERDOMAIN\$env:USERNAME" `
            -LogonType Interactive `
            -RunLevel Limited

        $configuracoes = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -RestartCount 999 `
            -RestartInterval (New-TimeSpan -Minutes 2) `
            -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
            -MultipleInstances IgnoreNew

        # IDEMPOTENCIA: se a tarefa ja existe, o -Force a substitui. Rodar o
        # setup de novo atualiza a mesma tarefa, sem duplicar e sem erro.
        $existente = Get-ScheduledTask -TaskName "PatronoDigitalTwinWorker" -ErrorAction SilentlyContinue
        if ($existente) {
            Write-Host "Tarefa ja existe - sera atualizada (sem duplicar)." -ForegroundColor Yellow
            Write-PatronoLog "Tarefa existente encontrada; atualizando." "INFO" "setup.log"
        }

        $registrada = $null
        try {
            $registrada = Register-ScheduledTask `
                -TaskName "PatronoDigitalTwinWorker" `
                -Action $acao `
                -Trigger $gatilhos `
                -Principal $principal `
                -Settings $configuracoes `
                -Description "Patrono Generation Worker - processa videos do Digital Twin localmente (reinicia sozinho se cair)" `
                -Force `
                -ErrorAction Stop
        } catch {
            # DIAGNOSTICO COMPLETO no lugar de "provavelmente e politica do TI".
            Write-Host ""
            Write-Host "FALHA AO REGISTRAR A TAREFA" -ForegroundColor Red
            Write-Host "  etapa           : Register-ScheduledTask" -ForegroundColor Red
            Write-Host "  excecao         : $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "  tipo            : $($_.Exception.GetType().FullName)" -ForegroundColor Red
            Write-Host "  usuario atual   : $env:USERDOMAIN\$env:USERNAME" -ForegroundColor Red
            Write-Host "  elevado         : $(Test-PatronoElevado)" -ForegroundColor Red
            Write-Host "  admin local     : $(Test-PatronoAdministradorLocal)" -ForegroundColor Red
            if ($existente) {
                Write-Host "  tarefa existente: SIM" -ForegroundColor Red
                Write-Host "  principal atual : $($existente.Principal.UserId) / RunLevel $($existente.Principal.RunLevel)" -ForegroundColor Red
            } else {
                Write-Host "  tarefa existente: NAO" -ForegroundColor Red
            }
            Write-PatronoLog "Falha ao registrar tarefa: $($_.Exception.Message)" "ERRO" "setup.log"
            throw
        }

        # VALIDACAO: le de volta do Windows o que realmente ficou gravado.
        # A versao anterior deste script imprimia "configurado" mesmo quando o
        # registro falhava, porque nao conferia o resultado.
        $conferida = Get-ScheduledTask -TaskName "PatronoDigitalTwinWorker" -ErrorAction SilentlyContinue
        if (-not $conferida) {
            Write-PatronoLog "Registro retornou sem erro, mas a tarefa nao foi encontrada." "ERRO" "setup.log"
            throw "A tarefa nao foi encontrada apos o registro."
        }

        Write-Host ""
        Write-Host "TAREFA REGISTRADA COM SUCESSO" -ForegroundColor Green
        Write-Host "  nome            : $($conferida.TaskName)"
        Write-Host "  estado          : $($conferida.State)"
        Write-Host "  principal       : $($conferida.Principal.UserId)"
        Write-Host "  tipo de logon   : $($conferida.Principal.LogonType)"
        Write-Host "  nivel           : $($conferida.Principal.RunLevel)"
        Write-Host "  gatilhos        : $($conferida.Triggers.Count) (AtLogOn)"
        Write-Host "  reinicio        : ate $($conferida.Settings.RestartCount)x a cada $($conferida.Settings.RestartInterval)"
        Write-Host "  multiplas inst. : $($conferida.Settings.MultipleInstances)"
        Write-Host "  limite de tempo : $($conferida.Settings.ExecutionTimeLimit) (0 = sem limite)"
        Write-Host "  comando         : powershell.exe $argumentosStart"
        Write-PatronoLog "Tarefa registrada: principal=$($conferida.Principal.UserId) gatilhos=$($conferida.Triggers.Count) restart=$($conferida.Settings.RestartCount)" "INFO" "setup.log"
        Write-Host ""
        Write-Host "Para desativar depois: .\stop-digital-twin-worker.ps1 -RemoverInicioAutomatico" -ForegroundColor Green
    } else {
        Write-Host "Ok, o inicio automatico nao foi configurado. Use start-digital-twin-worker.ps1 quando quiser processar." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Para iniciar o worker agora: .\start-digital-twin-worker.ps1" -ForegroundColor Green
Write-Host "Para ver o status a qualquer momento: .\status-digital-twin-worker.ps1" -ForegroundColor Green
