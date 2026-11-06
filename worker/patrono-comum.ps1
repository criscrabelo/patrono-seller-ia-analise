# patrono-comum.ps1 (Rodada 15)
#
# Funcoes compartilhadas pelos scripts do worker: elevacao, logging e
# resolucao de executaveis por caminho ABSOLUTO.
#
# POR QUE ESTE ARQUIVO EXISTE
#
# O Agendador de Tarefas NAO roda com o ambiente de um terminal interativo.
# O PATH e outras variaveis podem ser diferentes, e o diretorio de trabalho
# costuma ser System32. Depender de "npx" estar no PATH funciona quando voce
# testa na mao e falha silenciosamente as 7h da manha, no logon.
#
# Resolver por caminho absoluto, uma vez, num lugar so, elimina essa classe
# inteira de problema.

Set-StrictMode -Version Latest

#  Logging 

function Get-PatronoLogDir {
    $dir = Join-Path $env:LOCALAPPDATA "Patrono\logs"
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Write-PatronoLog {
    param(
        [Parameter(Mandatory = $true)][string]$Mensagem,
        [string]$Nivel = "INFO",
        [string]$Arquivo = "worker.log"
    )
    $carimbo = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $usuario = "$env:USERDOMAIN\$env:USERNAME"
    $linha = "[$carimbo] [$Nivel] [$usuario] $Mensagem"
    try {
        Add-Content -Path (Join-Path (Get-PatronoLogDir) $Arquivo) -Value $linha -Encoding UTF8
    } catch {
        # Log nunca pode derrubar o worker.
    }
    if ($Nivel -eq "ERRO") { Write-Host $linha -ForegroundColor Red }
    elseif ($Nivel -eq "AVISO") { Write-Host $linha -ForegroundColor Yellow }
    else { Write-Host $linha }
}

#  Elevacao 

function Test-PatronoElevado {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-PatronoAdministradorLocal {
    # Pertencer ao grupo NAO significa estar elevado: com UAC ligado, a sessao
    # normal de um administrador roda sem privilegio ate ser elevada. E
    # exatamente essa a diferenca que causava o "Acesso negado" no registro da
    # tarefa - nao havia politica do TI bloqueando coisa nenhuma.
    # ATENCAO (verificado nesta maquina): com o token FILTRADO pelo UAC, o
    # SID de Administradores (S-1-5-32-544) NAO aparece em
    # WindowsIdentity.Groups - so S-1-5-32-545 (Usuarios). O `whoami /groups`
    # mostra o grupo porque lista tambem as entradas "deny-only", que a API
    # omite. Por isso esta funcao e apenas INFORMATIVA e NUNCA deve ser usada
    # para impedir a tentativa de elevacao: ela produz falso negativo para um
    # administrador legitimo.
    try {
        $membros = Get-LocalGroupMember -SID "S-1-5-32-544" -ErrorAction Stop
        $eu = "$env:USERDOMAIN\$env:USERNAME"
        foreach ($m in $membros) { if ($m.Name -eq $eu) { return $true } }
        return $false
    } catch {
        # Sem permissao para ler o grupo: "nao sei" - e nao saber nunca pode
        # virar "nao tente".
        return $null
    }
}

<#
.SYNOPSIS
Relanca o script atual elevado, preservando os parametros recebidos.

.DESCRIPTION
Criar tarefa agendada exige privilegio administrativo nesta maquina -
confirmado em teste: mesmo uma tarefa nova, so com gatilho AtLogOn e na pasta
raiz, e recusada com 0x80070005 sem elevacao; `schtasks /Create` idem.

Em vez de exigir que a proprietaria abra um PowerShell como administrador
toda vez, o proprio script se reergue via UAC e continua sozinho.
#>
function Invoke-PatronoAutoElevacao {
    param(
        [Parameter(Mandatory = $true)][string]$CaminhoScript,
        [hashtable]$Parametros = @{}
    )

    if (Test-PatronoElevado) { return $false }

    # NAO bloqueamos por checagem de grupo: com o token filtrado pelo UAC ela
    # da falso negativo para administrador legitimo. Tentamos elevar e
    # tratamos a recusa - o proprio Windows e a autoridade aqui.

    $argumentos = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$CaminhoScript`"")
    foreach ($chave in $Parametros.Keys) {
        $valor = $Parametros[$chave]
        if ($valor -is [switch]) {
            if ($valor.IsPresent) { $argumentos += "-$chave" }
        } elseif ($null -ne $valor -and "$valor" -ne "") {
            $argumentos += "-$chave"
            $argumentos += "`"$valor`""
        }
    }

    Write-PatronoLog "Elevando privilegio (UAC) e continuando automaticamente..." "AVISO"
    Write-Host ""
    Write-Host "Uma janela de confirmacao do Windows vai aparecer. Aceite para continuar." -ForegroundColor Yellow
    Write-Host ""

    try {
        $processo = Start-Process -FilePath "powershell.exe" -ArgumentList $argumentos -Verb RunAs -PassThru -Wait -ErrorAction Stop
    } catch {
        # Codigo 1223 = operacao cancelada pelo usuario (clicou Nao no UAC).
        Write-PatronoLog "Elevacao recusada ou cancelada: $($_.Exception.Message)" "ERRO"
        Write-Host ""
        Write-Host "A elevacao foi cancelada. O registro da tarefa agendada precisa dela." -ForegroundColor Yellow
        Write-Host "Rode de novo e aceite a confirmacao do Windows." -ForegroundColor Yellow
        exit 1
    }
    Write-PatronoLog "Execucao elevada terminou com codigo $($processo.ExitCode)."
    exit $processo.ExitCode
}

#  Resolucao de executaveis por caminho ABSOLUTO 

function Resolve-PatronoExecutavel {
    param(
        [Parameter(Mandatory = $true)][string]$Nome,
        [string[]]$CaminhosProvaveis = @()
    )
    foreach ($c in $CaminhosProvaveis) {
        if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
    }
    $doPath = (Get-Command $Nome -ErrorAction SilentlyContinue)
    if ($doPath -and $doPath.Source) { return $doPath.Source }
    return $null
}

function Get-PatronoNode {
    return Resolve-PatronoExecutavel -Nome "node.exe" -CaminhosProvaveis @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )
}

<#
.SYNOPSIS
Caminho do `tsx` DENTRO do repositorio, sem depender de npx.

.DESCRIPTION
`npx` resolve subindo a arvore de node_modules a partir do diretorio atual.
Numa tarefa agendada o diretorio atual e System32 - npx nao acharia o pacote
e tentaria BAIXA-LO da internet, o que e lento, depende de rede e pode
instalar versao diferente da fixada. Chamar o cli.mjs por caminho absoluto
elimina os tres riscos de uma vez.
#>
function Get-PatronoTsxCli {
    param([Parameter(Mandatory = $true)][string]$RaizRepo)
    $cli = Join-Path $RaizRepo "node_modules\tsx\dist\cli.mjs"
    if (Test-Path $cli) { return $cli }
    return $null
}

function Get-PatronoNpm {
    return Resolve-PatronoExecutavel -Nome "npm.cmd" -CaminhosProvaveis @(
        "$env:ProgramFiles\nodejs\npm.cmd",
        "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd"
    )
}

<#
.SYNOPSIS
Arquivo-sinal de parada intencional.

.DESCRIPTION
O Agendador reinicia a tarefa quando a ACAO termina em erro. Matar o worker
faz exatamente isso - e cada nova tentativa de matar gera outra falha, num
gato e rato sem fim (medido ao vivo na Rodada 15.1: o worker reaparecia de 6
a 9 segundos depois, inclusive com a tarefa desabilitada).

A saida e nao brigar com o Agendador: quando a parada e INTENCIONAL, o
wrapper PowerShell encerra com codigo 0. O Windows entende sucesso e nao
reinicia nada. O watchdog continua valendo para quedas REAIS, em que o flag
nao existe.
#>
function Get-PatronoFlagParada {
    return Join-Path (Join-Path $env:LOCALAPPDATA "Patrono") "parada-solicitada.flag"
}
