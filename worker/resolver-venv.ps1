# resolver-venv.ps1
#
# Descobre onde fica o ambiente Python do worker. Ponto unico de verdade,
# dot-sourced pelos scripts setup/start/stop/status.
#
# POR QUE ISTO EXISTE: ate esta correcao os scripts assumiam
# "$PSScriptRoot\.venv-digital-twin". Isso NAO FUNCIONA quando o repositorio
# esta num caminho profundo - por exemplo dentro do OneDrive:
#
#   C:\Users\<voce>\OneDrive\Area de Trabalho\...\patrono-seller-ia\worker\.venv-digital-twin
#
# O Windows limita caminhos a 260 caracteres. O PyTorch instala cabecalhos
# com nomes de 100+ caracteres em torch\include\ATen\ops\, e a instalacao
# morre no meio com "OSError: [Errno 2] No such file or directory".
# Verificado de verdade na maquina da proprietaria: falhou aos 1,6 GB.
#
# As duas saidas seriam habilitar Long Paths no registro (alteracao de
# sistema, exige administrador) ou por o venv num caminho curto. A segunda
# e a suportada aqui - e de quebra tira o venv de dentro do OneDrive, que
# senao tentaria sincronizar ~2 GB de arquivos para a nuvem.
#
# Ordem de resolucao:
#   1. parametro -VenvPath do script chamador
#   2. variavel de ambiente DIGITAL_TWIN_VENV
#   3. C:\patrono-venv                        (padrao recomendado no Windows)
#   4. <repo>\worker\.venv-digital-twin       (padrao historico; so funciona
#                                              em caminho curto)

function Get-CaminhoVenvDigitalTwin {
    param(
        [string]$VenvPath,
        [string]$RaizWorker
    )

    if (-not $RaizWorker) { $RaizWorker = $PSScriptRoot }

    $candidatos = @()
    if ($VenvPath)                      { $candidatos += $VenvPath }
    if ($env:DIGITAL_TWIN_VENV)         { $candidatos += $env:DIGITAL_TWIN_VENV }
    $candidatos += "C:\patrono-venv"
    $candidatos += (Join-Path $RaizWorker ".venv-digital-twin")

    foreach ($c in $candidatos) {
        if (Test-Path (Join-Path $c "Scripts\python.exe")) { return $c }
    }
    return $null
}

# Caminho que DEVE ser usado para criar um venv novo (o primeiro candidato
# explicito, ou o padrao curto). Separado da busca acima de proposito:
# procurar aceita o que existe, criar escolhe o melhor lugar.
function Get-CaminhoVenvParaCriar {
    param(
        [string]$VenvPath,
        [string]$RaizWorker
    )

    if ($VenvPath)              { return $VenvPath }
    if ($env:DIGITAL_TWIN_VENV) { return $env:DIGITAL_TWIN_VENV }

    if (-not $RaizWorker) { $RaizWorker = $PSScriptRoot }
    $dentroDoRepo = Join-Path $RaizWorker ".venv-digital-twin"

    # Estima o caminho mais longo que o PyTorch vai criar. O nome abaixo e
    # real (existe no torch 2.6.0) - nao e uma margem inventada.
    $piorCaso = Join-Path $dentroDoRepo "Lib\site-packages\torch\include\ATen\ops\special_shifted_chebyshev_polynomial_w_compositeexplicitautogradnonfunctional_dispatch.h"
    if ($piorCaso.Length -lt 255) { return $dentroDoRepo }

    Write-Host "Caminho do repositorio e longo demais para o venv ($($piorCaso.Length) caracteres, limite 260)." -ForegroundColor Yellow
    Write-Host "Usando C:\patrono-venv. Para escolher outro lugar: defina DIGITAL_TWIN_VENV ou passe -VenvPath." -ForegroundColor Yellow
    return "C:\patrono-venv"
}
