# diagnose-digital-twin-worker.ps1 (Rodada 9)
#
# Diagnostico REAL do computador da proprietaria — SOMENTE LEITURA.
# Nao instala, nao atualiza driver, nao altera nada no sistema. O
# resultado decide (lib/digital-twin-machine-classification.ts) o que o
# Patrono pode tentar automaticamente.
#
# Saida: JSON no stdout, para o worker/instalador consumir.

$ErrorActionPreference = 'SilentlyContinue'

function Test-Cmd($nome) {
    return [bool](Get-Command $nome -ErrorAction SilentlyContinue)
}

function Test-Url($url) {
    try {
        $resp = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 8 -UseBasicParsing
        return @{ acessivel = ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400); statusCode = $resp.StatusCode }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        return @{ acessivel = $false; statusCode = $status; erro = $_.Exception.Message }
    }
}

# Windows version
$os = Get-CimInstance Win32_OperatingSystem
$windowsVersion = "$($os.Caption) (build $($os.BuildNumber))"

# CPU / RAM
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cpuCores = $cpu.NumberOfCores
$totalRamGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freeRamGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)

# GPU — so DETECTA, nunca instala/atualiza driver.
$gpuInfo = $null
$nvidiaSmi = Test-Cmd "nvidia-smi"
if ($nvidiaSmi) {
    $raw = nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits
    if ($raw) {
        $partes = $raw.Split(',').Trim()
        $gpuInfo = @{ nome = $partes[0]; vramMB = [int]$partes[1]; driverVersion = $partes[2] }
    }
}
$cudaDisponivel = $nvidiaSmi -and ($null -ne $gpuInfo)

# Python / FFmpeg
$pythonDisponivel = Test-Cmd "python"
$pythonVersion = if ($pythonDisponivel) { (python --version) } else { $null }
$ffmpegDisponivel = Test-Cmd "ffmpeg"

# Disco livre (drive do script)
$drive = (Get-Item $PSScriptRoot).PSDrive.Name
$discoLivreGB = [math]::Round((Get-PSDrive $drive).Free / 1GB, 1)

# Acesso a rede (leitura, nao altera nada)
$hf = Test-Url "https://huggingface.co"
$supabase = Test-Url "https://supabase.com"
$patrono = Test-Url $env:PATRONO_URL 2>$null
if (-not $env:PATRONO_URL) { $patrono = @{ acessivel = $null; statusCode = $null; erro = "PATRONO_URL nao configurada" } }

$resultado = @{
    windowsVersion = $windowsVersion
    cpuCores = $cpuCores
    totalRamGB = $totalRamGB
    freeRamGB = $freeRamGB
    gpu = $gpuInfo
    cudaDisponivel = $cudaDisponivel
    pythonDisponivel = $pythonDisponivel
    pythonVersion = $pythonVersion
    ffmpegDisponivel = $ffmpegDisponivel
    discoLivreGB = $discoLivreGB
    huggingFace = $hf
    supabase = $supabase
    patrono = $patrono
    verificadoEm = (Get-Date -Format "o")
}

$resultado | ConvertTo-Json -Depth 5
