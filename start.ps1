# Список приложений для меню «Пуск»: всё, что Windows показывает в «Пуске» (и обычные, и из Store).
# К каждому по возможности находим ярлык из папок меню «Пуск» — по нему док достаёт иконку.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$lnks = @{}
foreach ($dir in "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs") {
    foreach ($f in Get-ChildItem $dir -Recurse -Include *.lnk) {
        if (-not $lnks.ContainsKey($f.BaseName)) { $lnks[$f.BaseName] = $f.FullName }
    }
}

$items = foreach ($a in Get-StartApps) {
    [ordered]@{ name = $a.Name; id = $a.AppID; lnk = $lnks[$a.Name] }
}
ConvertTo-Json -Compress -InputObject @($items)
