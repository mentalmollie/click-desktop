# Подробности о дисках для всплывающего окна: метка, тип, файловая система, размеры.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$items = foreach ($d in [IO.DriveInfo]::GetDrives()) {
    if (-not $d.IsReady) { continue }
    [ordered]@{
        name  = $d.Name.TrimEnd('\')
        label = $d.VolumeLabel
        type  = $d.DriveType.ToString()
        fs    = $d.DriveFormat
        total = $d.TotalSize
        free  = $d.AvailableFreeSpace
    }
}
ConvertTo-Json -Compress -InputObject @($items)
