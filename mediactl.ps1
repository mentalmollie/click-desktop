# Управление конкретным источником музыки/видео (а не только «текущим», как медиаклавиши).
# Команды из stdin: "<playpause|next|prev> <AppUserModelId>"
# Работает отдельным процессом или внутри host.ps1 ($ChanIn вместо консоли).
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Hosted) { [Console]::InputEncoding = [Text.Encoding]::UTF8; $ChanIn = [Console]::In }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$type) {
    $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

while ($null -ne ($line = $ChanIn.ReadLine())) {
    $cmd, $src = $line.Trim() -split ' ', 2
    $s = $mgr.GetSessions() | Where-Object { $_.SourceAppUserModelId -eq $src } | Select-Object -First 1
    if (-not $s) { continue }
    switch ($cmd) {
        'playpause' { Await ($s.TryTogglePlayPauseAsync()) ([bool]) | Out-Null }
        'next'      { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }
        'prev'      { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }
    }
}
