param([Parameter(Mandatory=$true)][string]$ExePath, [int]$OwnerProcessId = 0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Reply([bool]$ok, [string]$text) { [ordered]@{ ok=$ok; text=$text } | ConvertTo-Json -Compress }
try {
    if (-not [IO.Path]::IsPathRooted($ExePath) -or [IO.Path]::GetExtension($ExePath) -ine '.exe') { Reply $false 'Неверный путь приложения.'; exit }
    $targetPath = [IO.Path]::GetFullPath($ExePath)
    $blocked = @('explorer.exe','svchost.exe','services.exe','lsass.exe','winlogon.exe','csrss.exe','smss.exe','wininit.exe','dwm.exe','sihost.exe')
    if ($blocked -contains [IO.Path]::GetFileName($targetPath)) { Reply $false 'Системную задачу нельзя завершить из Click.'; exit }
    $snapshot = @(Get-CimInstance Win32_Process)
    $owner = $snapshot | Where-Object { $_.ProcessId -eq $OwnerProcessId } | Select-Object -First 1
    $ownerSession = if ($owner) { $owner.SessionId } else { (Get-Process -Id $PID).SessionId }
    if ($owner -and $owner.ExecutablePath -and $owner.ExecutablePath -ieq $targetPath) { Reply $false 'Click нельзя завершить через его скрытые значки.'; exit }
    $targets = @($snapshot | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $targetPath -and $_.SessionId -eq $ownerSession -and $_.ProcessId -ne $PID -and $_.ProcessId -ne $OwnerProcessId })
    if (-not $targets.Count) { Reply $true 'Приложение уже закрыто.'; exit }
    # Выбираем корни одноимённого приложения. /T завершает также дочерние фоновые процессы.
    $targetIds = @{}; foreach ($item in $targets) { $targetIds[[int]$item.ProcessId] = $true }
    $roots = @($targets | Where-Object { -not $targetIds.ContainsKey([int]$_.ParentProcessId) })
    if (-not $roots.Count) { $roots = $targets }
    $taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    foreach ($item in $roots) {
        $current = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$item.ProcessId) -ErrorAction SilentlyContinue
        # PID мог исчезнуть или использоваться другой задачей, пока открыто меню.
        if (-not $current -or $current.ExecutablePath -ine $targetPath -or $current.CreationDate -ne $item.CreationDate) { continue }
        $oldPreference = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $null = & $taskkill /PID ([string]$current.ProcessId) /T /F 2>&1
        $ErrorActionPreference = $oldPreference
    }
    $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $targetPath -and $_.SessionId -eq $ownerSession })
    if ($remaining.Count) { Reply $false 'Задача не завершилась или приложение запустилось снова. Возможно, нужны права администратора.' }
    else { Reply $true 'Задача завершена.' }
} catch { Reply $false 'Не удалось завершить задачу. Возможно, нужны права администратора.' }
