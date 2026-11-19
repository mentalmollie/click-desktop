# Прячет панель задач Windows, пока работает GlassDock.
# Включает автоскрытие (чтобы окна занимали весь экран) и скрывает само окно панели.
#   taskbar.ps1 -ParentPid <pid>  — прятать, пока жив процесс дока, затем вернуть как было
#   taskbar.ps1 -Restore          — вернуть панель сразу
# Исходное состояние хранится в файле, поэтому панель вернётся, даже если док упал.
param([int]$ParentPid = 0, [switch]$Restore)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Taskbar {
    [DllImport("user32.dll")] static extern IntPtr FindWindow(string c, string w);
    [DllImport("user32.dll")] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] struct APPBARDATA {
        public int cbSize; public IntPtr hWnd; public uint msg; public uint edge; public RECT rc; public IntPtr lParam;
    }
    [DllImport("shell32.dll")] static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);

    const uint ABM_GETSTATE = 4, ABM_SETSTATE = 10;
    public const int ABS_AUTOHIDE = 1;

    public static int GetState() {
        var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d);
        return (int)SHAppBarMessage(ABM_GETSTATE, ref d);
    }
    public static void SetState(int s) {
        var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d);
        d.hWnd = FindWindow("Shell_TrayWnd", null); d.lParam = (IntPtr)s;
        SHAppBarMessage(ABM_SETSTATE, ref d);
    }
    // show = false прячет главную и дополнительные (на других мониторах) панели
    public static void Set(bool show) {
        int cmd = show ? 5 : 0;
        IntPtr h = FindWindow("Shell_TrayWnd", null);
        if (h != IntPtr.Zero && IsWindowVisible(h) != show) ShowWindow(h, cmd);
        IntPtr s = IntPtr.Zero;
        while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero)
            if (IsWindowVisible(s) != show) ShowWindow(s, cmd);
    }
}
'@

$stateFile = Join-Path $env:TEMP 'glassdock-taskbar.state'

function Restore-Taskbar {
    if (Test-Path $stateFile) {
        [Taskbar]::SetState([int](Get-Content $stateFile))
        Remove-Item $stateFile -Force
    }
    [Taskbar]::Set($true)
}

if ($Restore) { Restore-Taskbar; exit }

# Если файл остался от прошлого запуска, в нём настоящее исходное состояние
if (-not (Test-Path $stateFile)) { [Taskbar]::GetState() | Set-Content $stateFile }
[Taskbar]::SetState([int](Get-Content $stateFile) -bor [Taskbar]::ABS_AUTOHIDE)

$parent = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
# Док может попросить показать настоящий трей: пока этому файлу меньше 20 секунд, панель не прячем
$pauseFile = Join-Path $env:TEMP 'glassdock-taskbar.pause'
try {
    while ($parent -and -not $parent.HasExited) {
        $paused = (Test-Path $pauseFile) -and ((Get-Date) - (Get-Item $pauseFile).LastWriteTime).TotalSeconds -lt 20
        # Проводник иногда показывает панель снова (Пуск, перезапуск explorer) — прячем обратно
        [Taskbar]::Set($paused)
        Start-Sleep -Milliseconds 250
    }
} finally {
    Restore-Taskbar
}
