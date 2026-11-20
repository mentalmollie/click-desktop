# Выполняет команды из stdin, по одной на строку:
#   <vk>                  — нажать одну клавишу (медиа-клавиши, Win)
#   combo <vk>,<vk>,...   — нажать сочетание (горячие клавиши Island)
#   activate <hwnd>       — развернуть окно и переключиться на него
#   minimize <hwnd>       — свернуть окно
#   noactivate <hwnd>     — окно не активируется кликом (но клики получает)
#   showtitle <заголовок> — показать окно по заголовку; печатает ok/missing
# Работает отдельным процессом или внутри host.ps1 ($ChanIn/$ChanOut вместо консоли).
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Hosted) {
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
    [Console]::InputEncoding = [Text.Encoding]::UTF8
    $ChanIn = [Console]::In; $ChanOut = [Console]::Out
}

$sig = @'
[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
[DllImport("user32.dll")] public static extern int SetWindowLong(IntPtr h, int i, int v);
'@
$u = Add-Type -MemberDefinition $sig -Name Kbd -Namespace GlassDock -PassThru

# Медиа-клавиши и стрелки — «расширенные», остальные — обычные
$extended = @(0xB0, 0xB1, 0xB2, 0xB3, 0x5B, 0x25, 0x26, 0x27, 0x28)

function Press([byte[]]$vks) {
    foreach ($vk in $vks) { $u::keybd_event($vk, 0, $(if ($extended -contains $vk) { 1 } else { 0 }), [UIntPtr]::Zero) }
    [array]::Reverse($vks)
    foreach ($vk in $vks) { $u::keybd_event($vk, 0, $(if ($extended -contains $vk) { 3 } else { 2 }), [UIntPtr]::Zero) }
}

function Activate([IntPtr]$h, [bool]$allowKeys = $true) {
    if ($u::IsIconic($h)) { $u::ShowWindow($h, 9) | Out-Null }
    # Windows не даёт фоновому процессу забирать фокус. Сначала — без нажатий клавиш:
    # подключаемся к потоку ввода активного окна, и из него переключение разрешено.
    # (Раньше нажимали Alt — но после этого окна дока переставали получать нажатия мыши.)
    $fg = $u::GetForegroundWindow()
    $fgThread = $u::GetWindowThreadProcessId($fg, [IntPtr]::Zero)
    $me = $u::GetCurrentThreadId()
    $attached = $false
    if ($fgThread -ne 0 -and $fgThread -ne $me) { $attached = $u::AttachThreadInput($me, $fgThread, $true) }
    $u::BringWindowToTop($h) | Out-Null
    $u::SetForegroundWindow($h) | Out-Null
    if ($attached) { $u::AttachThreadInput($me, $fgThread, $false) | Out-Null }
    if ($u::GetForegroundWindow() -eq $h) { return }
    # Во время OLE-перетаскивания Alt может изменить действие или прервать передачу файла.
    if (-not $allowKeys) { return }
    # Запасной способ: Alt вместе с «пустой» клавишей 0xE8, чтобы не включать «режим меню»
    $u::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
    $u::keybd_event(0xE8, 0, 0, [UIntPtr]::Zero)
    $u::keybd_event(0xE8, 0, 2, [UIntPtr]::Zero)
    $u::SetForegroundWindow($h) | Out-Null
    $u::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}

while ($null -ne ($line = $ChanIn.ReadLine())) {
    $line = $line.Trim()
    $cmd, $arg = $line -split ' ', 2
    switch ($cmd) {
        'combo'     { Press ([byte[]]($arg -split ',' | ForEach-Object { [int]$_ })) }
        'activate'  { Activate ([IntPtr][long]$arg) }
        'activate-drop' { Activate ([IntPtr][long]$arg) $false }
        'minimize'  { $u::ShowWindow([IntPtr][long]$arg, 6) | Out-Null }
        'noactivate' {
            # Окно не забирает фокус при клике, но нажатие мыши получает (WS_EX_NOACTIVATE)
            $h = [IntPtr][long]$arg
            $u::SetWindowLong($h, -20, ($u::GetWindowLong($h, -20) -bor 0x08000000)) | Out-Null
        }
        'showtitle' {
            $h = $u::FindWindow($null, $arg)
            if ($h -ne [IntPtr]::Zero) { $u::ShowWindow($h, 9) | Out-Null; Activate $h; $ChanOut.WriteLine('ok') }
            else { $ChanOut.WriteLine('missing') }
            $ChanOut.Flush()
        }
        default {
            $vk = 0
            if ([int]::TryParse($cmd, [ref]$vk)) { Press ([byte[]]@($vk)) }
        }
    }
}
