# 一键启动：环境检查 → 按需构建前端 → 起后端 → 等待健康 → 打开浏览器
# 用法: powershell -ExecutionPolicy Bypass -File scripts\start.ps1 [-Build] [-NoBuild] [-Restart] [-NoOpen]
param(
    [switch]$Build,      # 强制重建前端（默认：产物缺失或源码比产物新时自动构建）
    [switch]$NoBuild,    # 跳过构建检查，直接用现有 web\dist
    [switch]$Restart,    # 强制重启（停掉占用端口的旧进程）
    [switch]$NoOpen      # 不自动打开浏览器
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$root = (Get-Location).Path

# 本机 127.0.0.1 请求绝不能走系统代理
$env:HTTP_PROXY = $null
$env:HTTPS_PROXY = $null
$env:ALL_PROXY = $null
$env:http_proxy = $null
$env:https_proxy = $null
$env:NO_PROXY = '127.0.0.1,localhost'
if (-not $env:PYTHONPATH) { $env:PYTHONPATH = (Join-Path $root 'backend') }

$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    throw "找不到虚拟环境。先执行：python -m venv .venv; .venv\Scripts\pip install -r backend\requirements.txt"
}

$port = 8000
$settingsPath = Join-Path $root 'var\data\settings.json'
if (Test-Path $settingsPath) {
    try { $port = [int]((Get-Content $settingsPath -Raw | ConvertFrom-Json).app.port) } catch { $port = 8000 }
    if ($port -le 0) { $port = 8000 }
}
$url = "http://127.0.0.1:$port"

function Test-Health {
    # /health 会被 SPA fallback 吞掉返回 index.html（假 200），必须用 /api/health
    try {
        $req = [System.Net.HttpWebRequest]::Create("$url/api/health")
        $req.Timeout = 2000
        $req.Proxy = $null
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $reader.ReadToEnd()
        $reader.Close()
        $resp.Close()
        return ($body -match '"status"\s*:\s*"ok"')
    } catch { return $false }
}

function Get-PortOwner([int]$p) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction Stop | Select-Object -First 1
        if ($conn) { return [int]$conn.OwningProcess }
    } catch { }
    $lines = netstat -ano | Select-String ":$p\s+.*LISTENING"
    foreach ($line in $lines) {
        $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
        if ($parts.Count -ge 5) { return [int]$parts[-1] }
    }
    return 0
}

# ---- 前端产物 ----
$dist = Join-Path $root 'web\dist\browser\index.html'
$needBuild = $false
if ($Build) {
    $needBuild = $true
} elseif (-not $NoBuild) {
    if (-not (Test-Path $dist)) {
        Write-Host '→ 前端产物缺失，自动构建'
        $needBuild = $true
    } else {
        $distTime = (Get-Item $dist).LastWriteTime
        $sources = @((Join-Path $root 'web\src'), (Join-Path $root 'web\public'),
                    (Join-Path $root 'web\angular.json'), (Join-Path $root 'web\package.json'))
        $newer = Get-ChildItem -Path $sources -Recurse -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.LastWriteTime -gt $distTime } | Select-Object -First 1
        if ($newer) { Write-Host '→ 检测到前端源码更新，自动构建'; $needBuild = $true }
    }
}

if ($needBuild) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw '找不到 npm，无法构建前端' }
    Remove-Item -Recurse -Force (Join-Path $root 'web\dist') -ErrorAction SilentlyContinue  # ng build 会假成功
    Push-Location (Join-Path $root 'web')
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
    } finally { Pop-Location }
    if (-not (Test-Path $dist)) { throw "构建后仍找不到 $dist" }
    Write-Host '✔ 前端已构建'
}

# ---- 旧实例 ----
$running = Test-Health
if ($running -and -not $Restart) {
    Write-Host "✔ 服务已在运行：$url （要重启请加 -Restart）"
    if (-not $NoOpen) { Start-Process $url }
    exit 0
}
if ($running) { Write-Host '→ -Restart：停止旧服务' }

$oldProcId = Get-PortOwner $port
if ($oldProcId -gt 0) {
    if ($Restart) {
        Write-Host "→ 清理占用 $port 的进程 $oldProcId"
        Stop-Process -Id $oldProcId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    } else {
        throw "端口 $port 被进程 $oldProcId 占用且 /api/health 无响应；加 -Restart 强制重启"
    }
}

# ---- 启动 ----
Write-Host "→ 启动后端：$url"
$proc = Start-Process -FilePath $py -ArgumentList 'backend/run.py' -WorkingDirectory $root -PassThru -NoNewWindow
try {
    $ready = $false
    for ($i = 0; $i -lt 80; $i++) {
        if (Test-Health) { $ready = $true; break }
        if ($proc.HasExited) { throw '后端进程提前退出' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw '等待 /api/health 超时（40s）' }

    Write-Host "✔ 已就绪：$url   （Ctrl+C 停止服务）"
    if (-not $NoOpen) { Start-Process $url }
    Wait-Process -Id $proc.Id
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
