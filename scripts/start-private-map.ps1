[CmdletBinding()]
param(
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDirectory = Join-Path $ProjectRoot 'data\local'
$StateFile = Join-Path $RuntimeDirectory 'private-map-server.json'
$StdoutLog = Join-Path $RuntimeDirectory 'private-map-server.stdout.log'
$StderrLog = Join-Path $RuntimeDirectory 'private-map-server.stderr.log'

function Get-UserEnvironmentValue {
    param([Parameter(Mandatory)][string]$Name)

    $value = [Environment]::GetEnvironmentVariable($Name, 'User')
    if ([string]::IsNullOrWhiteSpace($value)) {
        $value = [Environment]::GetEnvironmentVariable($Name, 'Process')
    }
    return $value
}

function Test-PrivateMapServer {
    param(
        [Parameter(Mandatory)][string]$Url,
        [string]$Username,
        [string]$Password
    )

    $headers = @{}
    if (-not [string]::IsNullOrEmpty($Username) -and -not [string]::IsNullOrEmpty($Password)) {
        $token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${Username}:${Password}"))
        $headers.Authorization = "Basic $token"
    }
    try {
        $response = Invoke-WebRequest -Uri $Url -Headers $headers -TimeoutSec 2 -SkipHttpErrorCheck
        return $response.StatusCode -eq 200 -and $response.Content -like '*PRIVATE AMAP VIEW*'
    }
    catch {
        return $false
    }
}

function Get-BrowserUrl {
    param([string]$HostName, [int]$Port)

    $browserHost = if ($HostName -in @('0.0.0.0', '::')) { '127.0.0.1' } else { $HostName }
    return "http://${browserHost}:${Port}/"
}

$apiKey = Get-UserEnvironmentValue -Name 'AMAP_JS_API_KEY'
$securityCode = Get-UserEnvironmentValue -Name 'AMAP_JS_SECURITY_CODE'

if ($apiKey -notmatch '^[a-fA-F0-9]{32}$' -or $securityCode -notmatch '^[a-fA-F0-9]{32}$') {
    Write-Host '尚未找到有效的高德 Web端（JS API）Key / 安全密钥，先进入本机安全设置。' -ForegroundColor Yellow
    & (Join-Path $PSScriptRoot 'setup-private-amap-secrets.ps1')
    $apiKey = Get-UserEnvironmentValue -Name 'AMAP_JS_API_KEY'
    $securityCode = Get-UserEnvironmentValue -Name 'AMAP_JS_SECURITY_CODE'
}

if ($apiKey -notmatch '^[a-fA-F0-9]{32}$' -or $securityCode -notmatch '^[a-fA-F0-9]{32}$') {
    throw '高德 Web端 Key 或安全密钥仍不可用。'
}

$hostName = Get-UserEnvironmentValue -Name 'PRIVATE_AMAP_HOST'
if ([string]::IsNullOrWhiteSpace($hostName)) { $hostName = '127.0.0.1' }
$portText = Get-UserEnvironmentValue -Name 'PRIVATE_AMAP_PORT'
if ([string]::IsNullOrWhiteSpace($portText)) { $portText = '8766' }
$port = 0
if (-not [int]::TryParse($portText, [ref]$port) -or $port -lt 1 -or $port -gt 65535) {
    throw "PRIVATE_AMAP_PORT 无效：$portText"
}
$username = Get-UserEnvironmentValue -Name 'PRIVATE_MAP_USERNAME'
$password = Get-UserEnvironmentValue -Name 'PRIVATE_MAP_PASSWORD'
$url = Get-BrowserUrl -HostName $hostName -Port $port

Set-Location -LiteralPath $ProjectRoot
New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

Write-Host '正在刷新本机私有高德运行包…' -ForegroundColor Cyan
& node 'scripts/build-private-amap-release.mjs'
if ($LASTEXITCODE -ne 0) { throw '私有高德运行包构建失败。' }

if (Test-PrivateMapServer -Url $url -Username $username -Password $password) {
    Write-Host "服务已经运行：$url" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process $url }
    exit 0
}

$childEnvironment = @{
    AMAP_JS_API_KEY = $apiKey
    AMAP_JS_SECURITY_CODE = $securityCode
    PRIVATE_AMAP_HOST = $hostName
    PRIVATE_AMAP_PORT = [string]$port
}
if (-not [string]::IsNullOrEmpty($username)) { $childEnvironment.PRIVATE_MAP_USERNAME = $username }
if (-not [string]::IsNullOrEmpty($password)) { $childEnvironment.PRIVATE_MAP_PASSWORD = $password }

$nodePath = (Get-Command node -ErrorAction Stop).Source
$serverProcess = Start-Process `
    -FilePath $nodePath `
    -ArgumentList @('scripts/private-amap-server.mjs') `
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
    if (Test-PrivateMapServer -Url $url -Username $username -Password $password) {
        $started = $true
        break
    }
}

if (-not $started) {
    if (-not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
    $errorTail = if (Test-Path -LiteralPath $StderrLog) { (Get-Content -LiteralPath $StderrLog -Tail 20) -join [Environment]::NewLine } else { '' }
    throw "私有地图服务启动失败。$([Environment]::NewLine)$errorTail"
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
$password = $null

Write-Host "私有高德地图已启动：$url" -ForegroundColor Green
if (-not $NoBrowser) { Start-Process $url }
