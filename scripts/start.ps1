# 一键启动：环境检查 → 按需构建前端 → 起后端 → 等待健康 → 打开浏览器
# 用法: powershell -ExecutionPolicy Bypass -File scripts\start.ps1 [-Build] [-NoBuild] [-Restart] [-NoOpen] [-Dev]
param(
    [switch]$Build,      # 强制重建前端（默认：产物缺失或源码比产物新时自动构建）
    [switch]$NoBuild,    # 跳过构建检查，直接用现有 web\dist
    [switch]$Restart,    # 强制重启（停掉占用端口的旧进程）
    [switch]$NoOpen,     # 不自动打开浏览器
    [switch]$Dev         # 开发模式：后端热重载(8000) + 前端 dev server(4200, HMR)；改代码即时生效
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
$lanIp = (Get-NetIPConfiguration -ErrorAction SilentlyContinue |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Select-Object -First 1)
$lanUrl = if ($lanIp) { "http://${lanIp}:$port" } else { "http://<本机IP>:$port" }

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
# dev 模式跑的是 ng serve（内存里现编），不需要也不该看 dist
$dist = Join-Path $root 'web\dist\browser\index.html'
$needBuild = $false
if ($Dev) {
    $needBuild = $false
} elseif ($Build) {
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
$devPort = 4200
$devUrl = "http://127.0.0.1:$devPort"
$devLanUrl = if ($lanIp) { "http://${lanIp}:$devPort" } else { "http://<本机IP>:$devPort" }

if ($Dev) {
    # 开发模式下每次都是「重启」：8000 与 4200 都清掉。
    # 这里**不报错**（生产模式那条路会报），因为热重载本来就该无脑覆盖。
    foreach ($p in @($port, $devPort)) {
        $owner = Get-PortOwner $p
        if ($owner -gt 0) {
            Write-Host "→ 清理占用 $p 的进程 $owner"
            & taskkill /PID $owner /T /F 2>$null | Out-Null
            Start-Sleep -Milliseconds 600
        }
    }
} else {
    $running = Test-Health
    if ($running -and -not $Restart) {
        Write-Host "✔ 服务已在运行：$url （要重启请加 -Restart；局域网访问需重启到 0.0.0.0）"
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
}

# ---- 启动 ----
if ($Dev) {
    # 后端：RELOAD=1 走自研 backend/dev.py。**不要改用 uvicorn --reload** ——
    # 0.54 在 Windows 上收到 CTRL_C_EVENT 后 join() 永不返回，老进程会继续占着端口不换新代码。
    Write-Host "→ 启动后端（热重载）：$url"
    $env:RELOAD = '1'
    $server = Start-Process -FilePath $py -ArgumentList 'backend/run.py' -WorkingDirectory $root -PassThru -NoNewWindow

    Write-Host "→ 启动前端 dev server：$devUrl"
    # 端口不在这里传：web/package.json 的 start 已经是
    # `ng serve --port 4200 --host 0.0.0.0`，再传一遍 Angular 会警告
    # 「Option 'port' has been specified multiple times」。$devPort 必须与它保持一致。
    $webProc = Start-Process -FilePath 'npm.cmd' `
        -ArgumentList @('start') `
        -WorkingDirectory (Join-Path $root 'web') -PassThru -NoNewWindow

    try {
        $ready = $false
        for ($i = 0; $i -lt 120; $i++) {
            if (Test-Health) { $ready = $true; break }
            if ($server.HasExited) { throw '后端进程提前退出' }
            Start-Sleep -Milliseconds 500
        }
        if (-not $ready) { throw '等待 /api/health 超时（60s）' }

        Write-Host "✔ 后端已就绪：$url （改后端 .py 自动重启）"
        Write-Host "✔ 前端开发地址：$devUrl （改前端即时生效，Ctrl+C 一起停）"
        Write-Host "✔ 局域网访问：$devLanUrl"
        Write-Host "  如果局域网仍打不开，请在 Windows 防火墙放行 TCP $devPort 与 $port"
        if (-not $NoOpen) { Start-Process $devUrl }
        Wait-Process -Id $server.Id
    } finally {
        # npm 在 Windows 会再拉一层 node 子进程，必须连树一起杀，
        # 否则 4200 被孤儿进程占着，下次启动会以为「端口被占」。
        foreach ($p in @($webProc, $server)) {
            if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null }
        }
    }
    exit 0
}

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
    Write-Host "✔ 局域网访问：$lanUrl"
    Write-Host "  如果局域网仍打不开，请在 Windows 防火墙放行 TCP $port"
    if (-not $NoOpen) { Start-Process $url }
    Wait-Process -Id $proc.Id
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
