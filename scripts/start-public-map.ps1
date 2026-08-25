[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDirectory = Join-Path $ProjectRoot 'data\local'
$StateFile = Join-Path $RuntimeDirectory 'public-map-server.json'
$StdoutLog = Join-Path $RuntimeDirectory 'public-map-server.stdout.log'
$StderrLog = Join-Path $RuntimeDirectory 'public-map-server.stderr.log'

function Get-UserEnvironmentValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, 'User')
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    return $value
}

function Get-BrowserUrl {
    param([string]$HostName, [int]$Port)

    $browserHost = if ($HostName -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $HostName }
    return "http://${browserHost}:${Port}/"
}

function Test-PublicMapServer {
    param([Parameter(Mandatory)][string]$Url)

    try {
        $response = Invoke-WebRequest -Uri ($Url.TrimEnd('/') + '/runtime-config.js') -TimeoutSec 2 -SkipHttpErrorCheck
        return $response.StatusCode -eq 200 -and $response.Content -like '*public-amap-runtime*' -and $response.Content -notlike '*AMAP_JS_SECURITY_CODE*'
    }
    catch {
        return $false
    }
}

$apiKey = Get-UserEnvironmentValue -Name 'AMAP_JS_API_KEY'
$securityCode = Get-UserEnvironmentValue -Name 'AMAP_JS_SECURITY_CODE'
if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($securityCode)) {
    throw '公开高德地图需要 AMAP_JS_API_KEY 和 AMAP_JS_SECURITY_CODE；只从当前环境读取，不把凭据写入项目。'
}

$hostName = Get-UserEnvironmentValue -Name 'PUBLIC_AMAP_HOST'
if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = '127.0.0.1' }
$portText = Get-UserEnvironmentValue -Name 'PUBLIC_AMAP_PORT'
if ([string]::IsNullOrWhiteSpace($portText)) { $portText = '4173' }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { throw "PUBLIC_AMAP_PORT 无效：$portText" }
$url = Get-BrowserUrl -HostName $hostName -Port $port

Set-Location -LiteralPath $ProjectRoot
New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

Write-Host '正在刷新公开高德运行包…' -ForegroundColor Cyan
& node 'scripts/build-public-release.mjs'
if ($LASTEXITCODE -ne 0) { throw '公开高德运行包构建失败。' }

if (Test-PublicMapServer -Url $url) {
    Write-Host "服务已经运行：$url" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
}

$childEnvironment = @{
    AMAP_JS_API_KEY = $apiKey
    AMAP_JS_SECURITY_CODE = $securityCode
    PUBLIC_AMAP_HOST = $hostName
    PUBLIC_AMAP_PORT = [string]$port
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$serverProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('scripts/public-amap-server.mjs') `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -Environment $childEnvironment `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru

$started = $false
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    Start-Sleep -Milliseconds 250
    if ($serverProcess.HasExited) { break }
    if (Test-PublicMapServer -Url $url) {
        $started = $true
        break
    }
}

if (-not $started) {
    if (-not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
    $errorTail = if (Test-Path -LiteralPath $StderrLog) { (Get-Content -LiteralPath $StderrLog -Tail 20) -join [Environment]::NewLine } else { '' }
    throw "公开地图服务启动失败。$([Environment]::NewLine)$errorTail"
}

$state = [ordered]@{
    schemaVersion = 1
    project = 'china-imax-map'
    projectRoot = $ProjectRoot
    pid = $serverProcess.Id
    url = $url
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$state | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding utf8

$apiKey = $null
$securityCode = $null

Write-Host "公开高德地图已启动：$url" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $url }
