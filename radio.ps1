# Wi-Fi и Bluetooth: включить, выключить, переключить или узнать состояние (Windows.Devices.Radios).
# Запуск: radio.ps1 -Kind wifi|bluetooth -State on|off|toggle|status
# Печатает одну строку JSON: {"ok":true,"radios":[{"name":"Wi-Fi","state":"On"}]} или {"ok":false,"error":"..."}
param([string]$Kind = 'wifi', [string]$State = 'status')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    # WinRT-операции ждём через AsTask (в PowerShell 5.1 нет await)
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    function Await($op, [Type]$type) {
        $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
        $task.Wait(-1) | Out-Null
        $task.Result
    }
    [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null
    [Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime] | Out-Null

    $access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    $all = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
    $want = if ($Kind -eq 'bluetooth') { 'Bluetooth' } else { 'WiFi' }
    $radios = @($all | Where-Object { $_.Kind.ToString() -eq $want })
    if (-not $radios.Count) { '{"ok":false,"error":"none"}'; exit }

    $out = @()
    foreach ($r in $radios) {
        if ($State -ne 'status') {
            if ($access.ToString() -ne 'Allowed') { '{"ok":false,"error":"denied"}'; exit }
            $target = switch ($State) {
                'on' { 'On' }
                'off' { 'Off' }
                default { if ($r.State.ToString() -eq 'On') { 'Off' } else { 'On' } }
            }
            $res = Await ($r.SetStateAsync([Windows.Devices.Radios.RadioState]$target)) ([Windows.Devices.Radios.RadioAccessStatus])
            if ($res.ToString() -ne 'Allowed') { '{"ok":false,"error":"denied"}'; exit }
        }
        $out += @{ name = $r.Name; state = $r.State.ToString() }
    }
    (@{ ok = $true; radios = $out } | ConvertTo-Json -Compress -Depth 4)
} catch {
    (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress)
}
