# Значки области уведомлений (трея) у запущенных программ.
# Windows 11 хранит их в реестре вместе с картинкой (IconSnapshot) — оттуда и берём.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# В путях встречаются GUID известных папок вместо самих путей
$known = @{
    '{6D809377-6AF0-444B-8957-A3773F02200E}' = $env:ProgramW6432
    '{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}' = ${env:ProgramFiles(x86)}
    '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}' = "$env:WINDIR\System32"
    '{F38BF404-1D43-42F2-9305-67DE0B28FC23}' = $env:WINDIR
    '{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}' = "$env:WINDIR\SysWOW64"
    '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}' = $env:LOCALAPPDATA
    '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}' = $env:APPDATA
}

$running = @{}
foreach ($p in Get-Process) { if ($p.Path) { $running[$p.Path.ToLower()] = $p.Id } }

$seen = @{}
$items = foreach ($k in Get-ChildItem 'HKCU:\Control Panel\NotifyIconSettings') {
    $p = Get-ItemProperty $k.PSPath
    $exe = [string]$p.ExecutablePath
    foreach ($g in $known.Keys) { $exe = $exe.Replace($g, $known[$g]) }
    $key = $exe.ToLower()
    if (-not $exe -or $seen[$key] -or -not $running.ContainsKey($key)) { continue }
    if ((Split-Path $exe -Leaf) -ieq 'explorer.exe') { continue }  # системные значки: звук, сеть и т.п.
    $seen[$key] = $true

    $name = ([string]$p.InitialTooltip -split "`n")[0].Trim()
    if (-not $name) { $name = (Get-Item $exe).VersionInfo.FileDescription }
    if (-not $name) { $name = [IO.Path]::GetFileNameWithoutExtension($exe) }

    [ordered]@{
        exe      = $exe
        name     = $name
        promoted = ($p.IsPromoted -eq 1)
        icon     = $(if ($p.IconSnapshot) { 'data:image/png;base64,' + [Convert]::ToBase64String($p.IconSnapshot) } else { $null })
    }
}

ConvertTo-Json -Compress -Depth 3 -InputObject @($items)
