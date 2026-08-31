[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StateFile = Join-Path $ProjectRoot 'data\local\public-map-server.json'

if (-not (Test-Path -LiteralPath $StateFile -PathType Leaf)) {
    Write-Host '没有找到本项目的公开地图启动状态文件；未停止任何进程。' -ForegroundColor Yellow
    exit 0
}

$state = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
if ($state.project -ne 'china-imax-map' -or $state.projectRoot -ne $ProjectRoot -or $state.pid -notmatch '^\d+$') {
    throw '运行状态文件不属于当前 china-imax-map 项目，已拒绝停止进程。'
}

$processId = [int]$state.pid
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
if ($null -ne $process) {
    $commandLine = [string]$process.CommandLine
    if ($process.Name -notin @('node.exe', 'node') -or $commandLine -notlike '*public-amap-server.mjs*') {
        throw "PID $processId 不是本项目的公开地图服务，已拒绝停止。"
    }
    Stop-Process -Id $processId -Force
    Write-Host "已停止公开高德地图服务（PID $processId）。" -ForegroundColor Green
} else {
    Write-Host '记录的服务进程已经退出。' -ForegroundColor Yellow
}

Remove-Item -LiteralPath $StateFile -Force
