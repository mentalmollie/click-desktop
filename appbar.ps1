# Резервирует полосу экрана под док, как это делает панель задач Windows:
# развёрнутые окна заканчиваются над доком и не заходят под него.
# Команды из stdin: "<край> <толщина в пикселях>" (край 1 — сверху, 3 — снизу; толщина 0 — снять резерв).
# В stdout: "pos left top right bottom" — полоса, которую выдала система.
# Когда stdin закрывается (док выключили или он упал), резерв снимается.
# Работает отдельным процессом или внутри host.ps1 ($ChanIn/$ChanOut вместо консоли).
if (-not $Hosted) { $ChanIn = [Console]::In; $ChanOut = [Console]::Out }
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class BarForm : Form {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct APPBARDATA {
        public int cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public RECT rc; public IntPtr lParam;
    }
    [DllImport("shell32.dll")] static extern IntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterWindowMessage(string s);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const uint ABM_NEW = 0, ABM_REMOVE = 1, ABM_QUERYPOS = 2, ABM_SETPOS = 3;
    readonly uint callback = RegisterWindowMessage("GlassDockAppBar");
    bool registered;
    int edge = 3, thick;
    RECT last;
    bool placed;

    TextWriter output;

    public static void Main2(TextReader input, TextWriter o) {
        SetProcessDPIAware();   // работаем в настоящих пикселях экрана
        var f = new BarForm();
        f.output = o;
        IntPtr h = f.Handle;     // окно не показываем, нужен только его дескриптор
        o.WriteLine("ready"); o.Flush();
        new Thread(() => {
            string line;
            while ((line = input.ReadLine()) != null) {
                // Берём только два числа — на случай мусора в начале строки (BOM в другой кодировке)
                var m = System.Text.RegularExpressions.Regex.Match(line, @"(\d+)\s+(\d+)");
                if (!m.Success) continue;
                int e = int.Parse(m.Groups[1].Value), t = int.Parse(m.Groups[2].Value);
                f.BeginInvoke((Action)(() => f.Apply(e, t)));
            }
            // ExitThread, а не Exit: в host.ps1 рядом могут работать и другие помощники
            f.BeginInvoke((Action)(() => { f.Remove(); f.Close(); Application.ExitThread(); }));
        }) { IsBackground = true }.Start();
        Application.Run();
    }

    APPBARDATA Data() { var d = new APPBARDATA(); d.cbSize = Marshal.SizeOf(d); d.hWnd = Handle; return d; }

    void Apply(int e, int t) {
        if (e != edge || t != thick) placed = false;
        edge = e; thick = t;
        if (t <= 0) { Remove(); return; }
        if (!registered) {
            var d = Data(); d.uCallbackMessage = callback;
            SHAppBarMessage(ABM_NEW, ref d);
            registered = true;
        }
        SetPos();
    }

    void SetPos() {
        var d = Data();
        d.uEdge = (uint)edge;
        var b = Screen.PrimaryScreen.Bounds;
        d.rc.left = b.Left; d.rc.right = b.Right;
        if (edge == 3) { d.rc.top = b.Bottom - thick; d.rc.bottom = b.Bottom; }
        else { d.rc.top = b.Top; d.rc.bottom = b.Top + thick; }
        // Система может сдвинуть полосу (например, над видимой панелью задач)
        SHAppBarMessage(ABM_QUERYPOS, ref d);
        if (edge == 3) d.rc.top = d.rc.bottom - thick; else d.rc.bottom = d.rc.top + thick;
        // Своё же уведомление о сдвиге не должно запускать повторную установку той же полосы
        if (registered && d.rc.top == last.top && d.rc.bottom == last.bottom && d.rc.left == last.left && d.rc.right == last.right && placed) return;
        SHAppBarMessage(ABM_SETPOS, ref d);
        last = d.rc;
        placed = true;
        output.WriteLine("pos " + d.rc.left + " " + d.rc.top + " " + d.rc.right + " " + d.rc.bottom);
        output.Flush();
    }

    void Remove() {
        if (!registered) return;
        var d = Data();
        SHAppBarMessage(ABM_REMOVE, ref d);
        registered = false;
        placed = false;
        output.WriteLine("off");
        output.Flush();
    }

    protected override void WndProc(ref Message m) {
        // ABN_POSCHANGED: сменилось разрешение, появилась панель задач и т.п. — пересчитываем
        if (m.Msg == (int)callback && m.WParam.ToInt32() == 1 && registered) SetPos();
        base.WndProc(ref m);
    }
}
'@
[BarForm]::Main2($ChanIn, $ChanOut)
