[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'china-imax-map - 高德私有地图密钥设置'

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$SecureValue)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

Write-Host ''
Write-Host '只在本机保存到 Windows 用户环境变量。输入内容不会显示，也不会写入仓库。' -ForegroundColor Cyan
Write-Host '请从高德控制台复制“Web端（JS API）1”这一行的两项。' -ForegroundColor Cyan
Write-Host ''

$apiKeySecure = Read-Host '1/2 粘贴 Web端（JS API）Key，然后按 Enter' -AsSecureString
$securityCodeSecure = Read-Host '2/2 粘贴对应安全密钥，然后按 Enter' -AsSecureString

$apiKeyPlain = $null
$securityCodePlain = $null
try {
    $apiKeyPlain = ConvertFrom-SecureValue -SecureValue $apiKeySecure
    $securityCodePlain = ConvertFrom-SecureValue -SecureValue $securityCodeSecure

    if ($apiKeyPlain -notmatch '^[a-fA-F0-9]{32}$') {
        throw 'Web端 Key 格式不正确：应为 32 位十六进制字符。'
    }
    if ($securityCodePlain -notmatch '^[a-fA-F0-9]{32}$') {
        throw '安全密钥格式不正确：应为 32 位十六进制字符。'
    }
    if ($apiKeyPlain -eq $securityCodePlain) {
        throw 'Web端 Key 与安全密钥不应相同。'
    }

    [Environment]::SetEnvironmentVariable('AMAP_JS_API_KEY', $apiKeyPlain, 'User')
    [Environment]::SetEnvironmentVariable('AMAP_JS_SECURITY_CODE', $securityCodePlain, 'User')

    Write-Host ''
    Write-Host '设置完成：AMAP_JS_API_KEY 与 AMAP_JS_SECURITY_CODE 已写入用户环境变量。' -ForegroundColor Green
    Write-Host '没有创建 .env 文件，也没有把值输出到终端。' -ForegroundColor Green
}
catch {
    Write-Host ''
    Write-Host "设置失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    $apiKeyPlain = $null
    $securityCodePlain = $null
    $apiKeySecure = $null
    $securityCodeSecure = $null
}

Write-Host ''
Read-Host '按 Enter 关闭此窗口'
