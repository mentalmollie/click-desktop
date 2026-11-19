# Следит за тем, что сейчас играет (Spotify, браузер, Яндекс Музыка и т.д.)
# через Windows Global System Media Transport Controls и пишет JSON-строки в stdout.
# Работает отдельным процессом или внутри host.ps1 ($ChanOut вместо консоли).
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Hosted) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $ChanOut = [Console]::Out }

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
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

# Прямой вызов AsStreamForRead в PowerShell 5.1 не видит WinRT-интерфейс, через reflection работает
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))

$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$lastJson = ''
$lastKey = ''
# Какой источник показывать, выбирает пользователь в окне плеера (пусто — текущий системный)
$prefFile = Join-Path $env:TEMP 'glassdock-media.pref'

while ($true) {
    $out = @{ active = $false }
    $cur = $mgr.GetCurrentSession()
    $all = @($mgr.GetSessions())
    $pref = if (Test-Path $prefFile) { (Get-Content $prefFile -Raw).Trim() } else { '' }
    $s = $all | Where-Object { $_.SourceAppUserModelId -eq $pref } | Select-Object -First 1
    if (-not $s) { $s = $cur }

    # Все приложения, где сейчас есть музыка или видео
    $sessions = @(foreach ($x in $all) {
        $px = Await ($x.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        [ordered]@{
            source  = $x.SourceAppUserModelId
            title   = $(if ($px) { $px.Title } else { '' })
            artist  = $(if ($px) { $px.Artist } else { '' })
            playing = ($x.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing')
        }
    })

    if ($s) {
        $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if ($p -and $p.Title) {
            $out = @{
                active  = $true
                title   = $p.Title
                artist  = $p.Artist
                playing = ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing')
                source  = $s.SourceAppUserModelId
                # Music / Video / Unknown — что сообщает сам плеер (браузеры часто не сообщают)
                ptype   = "$($s.GetPlaybackInfo().PlaybackType)"
            }
            # Позиция трека: плеер сообщает её изредка, остальное досчитывает док по времени posAt
            $tl = $s.GetTimelineProperties()
            if ($tl -and $tl.EndTime.TotalSeconds -gt 0) {
                $out.pos = [Math]::Round($tl.Position.TotalSeconds, 2)
                $out.dur = [Math]::Round($tl.EndTime.TotalSeconds, 2)
                $out.posAt = $tl.LastUpdatedTime.ToUnixTimeMilliseconds()
            }
            $key = "$($p.Title)|$($p.Artist)"
            if ($key -ne $lastKey) {
                $lastKey = $key
                $out.thumb = $null
                if ($p.Thumbnail) {
                    try {
                        $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                        $net = $asStreamForRead.Invoke($null, @($stream))
                        $ms = New-Object System.IO.MemoryStream
                        $net.CopyTo($ms)
                        $out.thumb = 'data:image/png;base64,' + [Convert]::ToBase64String($ms.ToArray())
                    } catch {}
                }
            }
        }
    }
    if (-not $out.active) { $lastKey = '' }
    $out.sessions = $sessions
    $out.current = $(if ($cur) { $cur.SourceAppUserModelId } else { '' })
    $json = ConvertTo-Json -Compress -Depth 4 -InputObject $out
    if ($json -ne $lastJson) {
        $lastJson = $json
        $ChanOut.WriteLine($json)
        $ChanOut.Flush()
    }
    Start-Sleep -Milliseconds 1000
}
