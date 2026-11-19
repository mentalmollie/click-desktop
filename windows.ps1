# Следит за открытыми окнами (как список Alt+Tab) и пишет JSON-строки в stdout — при изменениях
# (по событиям Windows: окно открыли, закрыли, свернули, сменился заголовок или активное окно):
# {"fg": <активное окно>, "list": [{"h": hwnd, "t": заголовок, "p": pid, "e": путь к exe, "m": свёрнуто}]}
# Работает отдельным процессом или внутри host.ps1 ($ChanOut вместо консоли).
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Hosted) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $ChanOut = [Console]::Out }

Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Wins {
    // ---- События окон вместо опроса: список пересобираем, только когда что-то изменилось ----
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr h, int idObject, int idChild, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr mod, WinEventProc fn, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
    [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjects(uint n, IntPtr[] h, bool all, uint ms, uint mask);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    static readonly WinEventProc onEvent = OnEvent;   // держим ссылку от GC
    static bool hooked, dirty = true;
    static void OnEvent(IntPtr hook, uint ev, IntPtr h, int idObject, int idChild, uint thread, uint time) {
        if (ev == 0x0003) { dirty = true; return; }                              // сменилось активное окно
        if (idObject != 0 || idChild != 0 || h == IntPtr.Zero) return;           // только сами окна
        if (GetAncestor(h, 2) != h) return;                                       // только верхнего уровня
        dirty = true;
    }
    static void Pump() { MSG m; while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); } }
    // Ждать изменения окон (но не дольше maxMs); после события — ещё ~120 мс, чтобы собрать пачку событий в одно
    public static void WaitChange(int maxMs) {
        if (!hooked) {
            hooked = true;
            const uint OUT = 0x0002;   // WINEVENT_OUTOFCONTEXT — события приходят в очередь этого потока
            SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, onEvent, 0, 0, OUT);     // активное окно
            SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, onEvent, 0, 0, OUT);     // свернули/развернули
            SetWinEventHook(0x8000, 0x8003, IntPtr.Zero, onEvent, 0, 0, OUT);     // создано/закрыто/показано/скрыто
            SetWinEventHook(0x800C, 0x800C, IntPtr.Zero, onEvent, 0, 0, OUT);     // сменился заголовок
            SetWinEventHook(0x8017, 0x8018, IntPtr.Zero, onEvent, 0, 0, OUT);     // спрятано/показано системой (cloak)
        }
        var until = Environment.TickCount + maxMs;
        while (!dirty) {
            int left = until - Environment.TickCount;
            if (left <= 0) break;
            MsgWaitForMultipleObjects(0, null, false, (uint)Math.Min(left, 250), 0x04FF);   // QS_ALLINPUT
            Pump();
        }
        if (dirty) {
            var t = Environment.TickCount + 120;
            while (Environment.TickCount < t) { MsgWaitForMultipleObjects(0, null, false, 40, 0x04FF); Pump(); }
        }
        dirty = false;
    }

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint p);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr h, uint f, StringBuilder s, ref uint n);

    static readonly Dictionary<uint, string> exeCache = new Dictionary<uint, string>();
    static string ExePath(uint pid) {
        string r;
        if (exeCache.TryGetValue(pid, out r)) return r;
        r = "";
        IntPtr h = OpenProcess(0x1000, false, pid);  // PROCESS_QUERY_LIMITED_INFORMATION
        if (h != IntPtr.Zero) {
            var sb = new StringBuilder(1024); uint n = 1024;
            if (QueryFullProcessImageName(h, 0, sb, ref n)) r = sb.ToString();
            CloseHandle(h);
        }
        exeCache[pid] = r;
        return r;
    }

    public static List<object[]> List() {
        var res = new List<object[]>();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;  // скрытые и дочерние диалоги
            int ex = GetWindowLong(h, -20);
            if ((ex & 0x80) != 0) return true;                                      // WS_EX_TOOLWINDOW
            if ((ex & 0x08000000) != 0 && (ex & 0x40000) == 0) return true;         // NOACTIVATE без APPWINDOW
            int cloaked;
            if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            var cls = new StringBuilder(256); GetClassName(h, cls, 256);
            string c = cls.ToString();
            if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return true;
            var t = new StringBuilder(512);
            if (GetWindowText(h, t, 512) == 0) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            res.Add(new object[] { h.ToInt64(), t.ToString(), pid, ExePath(pid), IsIconic(h) });
            return true;
        }, IntPtr.Zero);
        return res;
    }
}
'@

$last = ''
while ($true) {
    $list = @(foreach ($w in [Wins]::List()) {
        [ordered]@{ h = $w[0]; t = $w[1]; p = $w[2]; e = $w[3]; m = $w[4] }
    })
    $json = ConvertTo-Json -Compress -Depth 3 -InputObject ([ordered]@{
        fg = [Wins]::GetForegroundWindow().ToInt64()
        list = $list
    })
    if ($json -ne $last) {
        $last = $json
        $ChanOut.WriteLine($json)
        $ChanOut.Flush()
    }
    # Ждём события окон; раз в 5 с пересобираем и без них (на случай пропущенного события)
    [Wins]::WaitChange(5000)
}
