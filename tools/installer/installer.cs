// Установщик и деинсталлятор Click — один исходник, две сборки (см. tools/build.js):
//  · Click-Setup.exe — со встроенным архивом программы (ресурс app.zip): окно установки;
//  · Uninstall Click.exe — без архива: окно удаления (его открывает «Установленные приложения» Windows).
// Ставится для текущего пользователя, без прав администратора: %LOCALAPPDATA%\Programs\Click.
// Личные данные программы (%APPDATA%\GlassDock) установка не трогает, удаление — только по галочке.
// Компилируется встроенным в Windows csc.exe (.NET Framework 4.x, C# 5).
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class App {
    public const string Name = "Click";
    public const string Version = "1.0.0";
    public const string Publisher = "Click";
    public const string ExeName = "Click.exe";
    public const string UninstName = "Uninstall Click.exe";
    public const string UninstKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Click";
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static string DefaultDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Click"); } }
    public static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "GlassDock"); } }
    public static string StartMenuLnk { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Click.lnk"); } }
    public static string DesktopLnk { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Click.lnk"); } }

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int s);
    public static void DarkTitle(Form f) { int on = 1; try { DwmSetWindowAttribute(f.Handle, 20, ref on, 4); } catch { } }

    [STAThread]
    static void Main(string[] args) {
        try { SetProcessDPIAware(); } catch { }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        bool hasPayload = Assembly.GetExecutingAssembly().GetManifestResourceNames().Contains("app.zip");
        if (hasPayload) {
            string updateDir = null;
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == "/update-dir") updateDir = args[i + 1];
            Application.Run(new SetupForm(updateDir)); return;
        }

        // Удаление. Из папки программы себя не удалить — копируемся во временную папку и запускаемся оттуда
        string from = null;
        for (int i = 0; i < args.Length - 1; i++) if (args[i] == "/from") from = args[i + 1];
        if (from == null) {
            string self = Application.ExecutablePath;
            string tmp = Path.Combine(Path.GetTempPath(), "click-uninstall-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".exe");
            File.Copy(self, tmp, true);
            Process.Start(new ProcessStartInfo(tmp, "/from \"" + Path.GetDirectoryName(self) + "\"") { UseShellExecute = false });
            return;
        }
        Application.Run(new UninstallForm(from));
    }

    // ---------- Общее ----------

    // Закрыть запущенный Click из этой папки (и его помощников: они сами завершатся, когда док закроется)
    public static bool CloseRunning(string dir, IWin32Window owner) {
        var procs = Process.GetProcessesByName("Click").Where(p => {
            try { return p.MainModule.FileName.StartsWith(dir, StringComparison.OrdinalIgnoreCase); } catch { return false; }
        }).ToList();
        if (procs.Count == 0) return true;
        if (MessageBox.Show(owner, "Click сейчас запущен. Закрыть его, чтобы продолжить?", "Click", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return false;
        foreach (var p in procs) { try { p.Kill(); } catch { } }
        foreach (var p in procs) { try { p.WaitForExit(5000); } catch { } }
        Thread.Sleep(800);   // панель задач Windows возвращает помощник taskbar.ps1
        return true;
    }

    public static void Shortcut(string lnk, string target, string dir) {
        Directory.CreateDirectory(Path.GetDirectoryName(lnk));
        Type t = Type.GetTypeFromProgID("WScript.Shell");
        object sh = Activator.CreateInstance(t);
        object s = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, sh, new object[] { lnk });
        Type st = s.GetType();
        st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, s, new object[] { target });
        st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, s, new object[] { dir });
        st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, s, new object[] { target + ",0" });
        st.InvokeMember("Description", BindingFlags.SetProperty, null, s, new object[] { "Click" });
        st.InvokeMember("Save", BindingFlags.InvokeMethod, null, s, null);
    }

    public static void DeleteDir(string dir) {
        for (int i = 0; i < 10 && Directory.Exists(dir); i++) {
            try { Directory.Delete(dir, true); } catch { Thread.Sleep(400); }
        }
    }

    public static long DirSizeKb(string dir) {
        try { return new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length) / 1024; } catch { return 0; }
    }
}

// ---------- Оформление: тёмное окно в стиле Click ----------

class Ui {
    public static readonly Color Bg = Color.FromArgb(27, 28, 31);
    public static readonly Color Panel = Color.FromArgb(36, 37, 42);
    public static readonly Color Text = Color.FromArgb(240, 240, 245);
    public static readonly Color Muted = Color.FromArgb(150, 152, 165);
    public static readonly Color Accent = Color.FromArgb(106, 92, 255);
    public static readonly Color AccentHover = Color.FromArgb(124, 111, 255);

    public static Font F(float size, FontStyle st = FontStyle.Regular) { return new Font("Segoe UI", size, st); }

    public static Label Label(string text, float size, Color color, FontStyle st = FontStyle.Regular) {
        return new Label { Text = text, Font = F(size, st), ForeColor = color, BackColor = Color.Transparent, AutoSize = true };
    }

    public static Button Button(string text, bool primary) {
        var b = new Button { Text = text, Font = F(9.5f, primary ? FontStyle.Bold : FontStyle.Regular), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand };
        b.FlatAppearance.BorderSize = primary ? 0 : 1;
        b.FlatAppearance.BorderColor = Color.FromArgb(70, 72, 80);
        b.BackColor = primary ? Accent : Panel;
        b.ForeColor = Color.White;
        b.FlatAppearance.MouseOverBackColor = primary ? AccentHover : Color.FromArgb(48, 49, 56);
        b.FlatAppearance.MouseDownBackColor = primary ? Accent : Color.FromArgb(56, 57, 64);
        return b;
    }

    public static CheckBox Check(string text, bool on) {
        return new CheckBox { Text = text, Checked = on, Font = F(9.5f), ForeColor = Text, BackColor = Color.Transparent, AutoSize = true, Cursor = Cursors.Hand };
    }

    // Логотип: иконка из ресурсов exe (её кладёт /win32icon), большая — из logo.png, если есть
    public static Image Logo() {
        var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("logo.png");
        if (s != null) return Image.FromStream(s);
        return Icon.ExtractAssociatedIcon(Application.ExecutablePath).ToBitmap();
    }
}

// Полоса прогресса со скруглёнными краями
class Bar : Control {
    public double Value;
    public Bar() { DoubleBuffered = true; Height = 6; }
    protected override void OnPaint(PaintEventArgs e) {
        var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(Parent != null ? Parent.BackColor : Ui.Bg);
        using (var bg = new SolidBrush(Color.FromArgb(50, 52, 60))) Round(g, bg, new RectangleF(0, 0, Width - 1, Height - 1));
        float w = (float)Math.Max(Height, (Width - 1) * Math.Min(1, Value));
        if (Value > 0) using (var fg = new LinearGradientBrush(new RectangleF(0, 0, Width, Height), Color.FromArgb(79, 140, 255), Color.FromArgb(166, 77, 255), 0f)) Round(g, fg, new RectangleF(0, 0, w, Height - 1));
    }
    static void Round(Graphics g, Brush b, RectangleF r) {
        float d = r.Height;
        using (var p = new GraphicsPath()) {
            p.AddArc(r.X, r.Y, d, d, 90, 180); p.AddArc(r.Right - d, r.Y, d, d, 270, 180); p.CloseFigure();
            g.FillPath(b, p);
        }
    }
}

class BaseForm : Form {
    protected float K;   // масштаб под DPI экрана
    protected int S(float v) { return (int)Math.Round(v * K); }
    protected BaseForm(string title, int w, int h) {
        using (var g = CreateGraphics()) K = g.DpiX / 96f;
        Text = title;
        Font = Ui.F(9.5f);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Ui.Bg;
        ForeColor = Ui.Text;
        ClientSize = new Size(S(w), S(h));
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        HandleCreated += (s, e) => App.DarkTitle(this);
    }
    protected void Place(Control c, float x, float y, float w = 0, float h = 0) {
        c.Location = new Point(S(x), S(y));
        if (w > 0 || h > 0) { c.AutoSize = false; c.Size = new Size(S(w), S(h)); }
        Controls.Add(c);
    }
}

// ---------- Установка ----------

class SetupForm : BaseForm {
    TextBox dirBox; CheckBox desktop, autostart, launch; Button go, browse, cancel; Bar bar; Label status, heading, sub;
    string installedDir;
    bool done, busy;

    public SetupForm(string updateDir = null) : base("Установка Click", 520, 400) {
        var logo = new PictureBox { Image = Ui.Logo(), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Transparent };
        Place(logo, 28, 26, 64, 64);
        heading = Ui.Label("Установка Click", 17f, Ui.Text, FontStyle.Bold); Place(heading, 108, 28);
        sub = Ui.Label("Панель с живыми виджетами и ассистентами · версия " + App.Version, 9.5f, Ui.Muted); Place(sub, 110, 64);
        sub.MaximumSize = new Size(S(390), 0);

        Place(Ui.Label("Папка установки", 9.5f, Ui.Muted), 28, 118);
        dirBox = new TextBox { Text = String.IsNullOrWhiteSpace(updateDir) ? App.DefaultDir : updateDir, Font = Ui.F(9.5f), BackColor = Ui.Panel, ForeColor = Ui.Text, BorderStyle = BorderStyle.FixedSingle };
        Place(dirBox, 28, 140, 362, 26);
        browse = Ui.Button("Изменить…", false);
        browse.Click += (s, e) => {
            using (var d = new FolderBrowserDialog { Description = "Куда установить Click", SelectedPath = dirBox.Text }) {
                if (d.ShowDialog(this) == DialogResult.OK) dirBox.Text = d.SelectedPath.EndsWith("Click", StringComparison.OrdinalIgnoreCase) ? d.SelectedPath : Path.Combine(d.SelectedPath, "Click");
            }
        };
        Place(browse, 398, 139, 94, 28);

        desktop = Ui.Check("Ярлык на рабочем столе", true); Place(desktop, 28, 186);
        autostart = Ui.Check("Запускать вместе с Windows", true); Place(autostart, 28, 214);
        launch = Ui.Check("Запустить Click после установки", true); Place(launch, 28, 242);

        bar = new Bar { Visible = false }; Place(bar, 28, 292, 464, 6);
        status = Ui.Label("Ярлык в меню «Пуск» создаётся всегда. Настройки и ключи хранятся отдельно и при обновлении сохраняются.", 8.5f, Ui.Muted);
        Place(status, 28, 306);
        status.MaximumSize = new Size(S(464), 0);

        cancel = Ui.Button("Отмена", false); cancel.Click += (s, e) => Close(); Place(cancel, 286, 346, 96, 34);
        go = Ui.Button("Установить", true); go.Click += (s, e) => Start(); Place(go, 390, 346, 102, 34);
        AcceptButton = go;
        Shown += (s, e) => go.Focus();
        FormClosing += (s, e) => { if (busy) e.Cancel = true; };
    }

    void Start() {
        if (done) { Finish(); return; }
        string dir = dirBox.Text.Trim();
        try { dir = Path.GetFullPath(dir); } catch { MessageBox.Show(this, "Неверный путь к папке.", "Click"); return; }
        if (!App.CloseRunning(dir, this)) return;
        busy = true;
        foreach (Control c in new Control[] { go, cancel, browse, dirBox, desktop, autostart }) c.Enabled = false;
        bar.Visible = true;
        status.Text = "Устанавливаю…";
        bool wantDesktop = desktop.Checked, wantRun = autostart.Checked;
        var th = new Thread(() => {
            string err = null;
            try { Install(dir, wantDesktop, wantRun); } catch (Exception ex) { err = ex.Message; }
            BeginInvoke((Action)(() => Installed(dir, err)));
        });
        th.IsBackground = true;
        th.Start();
    }

    void Progress(double v, string text) {
        BeginInvoke((Action)(() => { bar.Value = v; bar.Invalidate(); if (text != null) status.Text = text; }));
    }

    void Install(string dir, bool wantDesktop, bool wantRun) {
        // Обновление: старые файлы программы убираем целиком (данные пользователя лежат в другом месте)
        if (Directory.Exists(dir) && File.Exists(Path.Combine(dir, App.ExeName))) App.DeleteDir(dir);
        Directory.CreateDirectory(dir);
        string root = Path.GetFullPath(dir) + Path.DirectorySeparatorChar;
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("app.zip"))
        using (var zip = new ZipArchive(s, ZipArchiveMode.Read)) {
            long total = zip.Entries.Sum(e => e.Length), doneBytes = 0;
            int n = 0;
            foreach (var e in zip.Entries) {
                string to = Path.GetFullPath(Path.Combine(dir, e.FullName));
                if (!to.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;   // защита от путей «../»
                // Запись папки (бывает с «/» или «\» на конце — смотря чем собран архив)
                if (e.Name.Length == 0) { Directory.CreateDirectory(to); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(to));
                using (var src = e.Open()) using (var dst = File.Create(to)) src.CopyTo(dst);
                doneBytes += e.Length;
                if (++n % 20 == 0) Progress(0.95 * doneBytes / Math.Max(1, total), null);
            }
        }
        string exe = Path.Combine(dir, App.ExeName);
        Progress(0.96, "Создаю ярлыки…");
        App.Shortcut(App.StartMenuLnk, exe, dir);
        if (wantDesktop) App.Shortcut(App.DesktopLnk, exe, dir);
        else if (File.Exists(App.DesktopLnk)) File.Delete(App.DesktopLnk);

        Progress(0.98, "Регистрирую программу…");
        using (var run = Registry.CurrentUser.CreateSubKey(App.RunKey)) {
            if (wantRun) run.SetValue("Click", "\"" + exe + "\"");
            else if (run.GetValue("Click") != null) run.DeleteValue("Click");
        }
        using (var u = Registry.CurrentUser.CreateSubKey(App.UninstKey)) {
            string un = Path.Combine(dir, App.UninstName);
            u.SetValue("DisplayName", App.Name);
            u.SetValue("DisplayVersion", App.Version);
            u.SetValue("Publisher", App.Publisher);
            u.SetValue("DisplayIcon", exe + ",0");
            u.SetValue("InstallLocation", dir);
            u.SetValue("UninstallString", "\"" + un + "\"");
            u.SetValue("QuietUninstallString", "\"" + un + "\"");
            u.SetValue("NoModify", 1, RegistryValueKind.DWord);
            u.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            u.SetValue("EstimatedSize", (int)App.DirSizeKb(dir), RegistryValueKind.DWord);
            u.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
        }
        Progress(1, null);
    }

    void Installed(string dir, string err) {
        busy = false;
        if (err != null) {
            status.Text = "Не получилось: " + err;
            status.ForeColor = Color.FromArgb(255, 120, 120);
            foreach (Control c in new Control[] { go, cancel, browse, dirBox, desktop, autostart }) c.Enabled = true;
            go.Text = "Повторить";
            return;
        }
        done = true;
        installedDir = dir;
        heading.Text = "Click установлен";
        status.Text = "Готово. Click есть в меню «Пуск»" + (desktop.Checked ? " и на рабочем столе" : "") + ".";
        go.Text = "Готово";
        go.Enabled = true;
        cancel.Visible = false;
    }

    void Finish() {
        if (launch.Checked && installedDir != null) {
            try { Process.Start(new ProcessStartInfo(Path.Combine(installedDir, App.ExeName)) { WorkingDirectory = installedDir }); } catch { }
        }
        Close();
    }
}

// ---------- Удаление ----------

class UninstallForm : BaseForm {
    readonly string dir;
    CheckBox wipe; Button go, cancel; Bar bar; Label status, heading;
    bool busy, done;

    public UninstallForm(string dir) : base("Удаление Click", 500, 300) {
        this.dir = dir;
        var logo = new PictureBox { Image = Ui.Logo(), SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.Transparent };
        Place(logo, 28, 26, 56, 56);
        heading = Ui.Label("Удалить Click?", 16f, Ui.Text, FontStyle.Bold); Place(heading, 100, 30);
        Place(Ui.Label("Будут удалены программа, ярлыки и автозапуск.", 9.5f, Ui.Muted), 102, 64);
        wipe = Ui.Check("Удалить и мои настройки, ключи и распознаватель речи", false); Place(wipe, 28, 112);
        Place(Ui.Label(App.DataDir, 8.5f, Ui.Muted), 46, 138);
        bar = new Bar { Visible = false }; Place(bar, 28, 186, 444, 6);
        status = Ui.Label("Без галочки настройки останутся — при повторной установке всё вернётся как было.", 8.5f, Ui.Muted);
        Place(status, 28, 202);
        status.MaximumSize = new Size(S(444), 0);
        Shown += (s, e) => cancel.Focus();
        cancel = Ui.Button("Отмена", false); cancel.Click += (s, e) => Close(); Place(cancel, 262, 248, 96, 34);
        go = Ui.Button("Удалить", true); go.Click += (s, e) => Start(); Place(go, 366, 248, 106, 34);
        FormClosing += (s, e) => { if (busy) e.Cancel = true; };
        FormClosed += (s, e) => SelfDelete();
    }

    void Start() {
        if (done) { Close(); return; }
        if (!App.CloseRunning(dir, this)) return;
        busy = true;
        go.Enabled = cancel.Enabled = wipe.Enabled = false;
        bar.Visible = true; bar.Value = 0.3; bar.Invalidate();
        status.Text = "Удаляю…";
        bool wipeData = wipe.Checked;
        var th = new Thread(() => {
            try {
                foreach (var l in new[] { App.StartMenuLnk, App.DesktopLnk }) { try { if (File.Exists(l)) File.Delete(l); } catch { } }
                using (var run = Registry.CurrentUser.OpenSubKey(App.RunKey, true)) { if (run != null && run.GetValue("Click") != null) run.DeleteValue("Click"); }
                try { Registry.CurrentUser.DeleteSubKeyTree(App.UninstKey, false); } catch { }
                App.DeleteDir(dir);
                if (wipeData) App.DeleteDir(App.DataDir);
            } catch { }
            BeginInvoke((Action)(() => {
                busy = false; done = true;
                bar.Value = 1; bar.Invalidate();
                heading.Text = "Click удалён";
                status.Text = Directory.Exists(dir) ? "Удалено не всё: папку " + dir + " можно удалить вручную." : "Готово.";
                go.Text = "Закрыть"; go.Enabled = true; cancel.Visible = false;
            }));
        });
        th.IsBackground = true;
        th.Start();
    }

    // Временная копия деинсталлятора удаляет себя после закрытия
    static void SelfDelete() {
        try {
            string self = Application.ExecutablePath;
            if (!self.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase)) return;
            Process.Start(new ProcessStartInfo("cmd.exe", "/c ping 127.0.0.1 -n 3 >nul & del /f /q \"" + self + "\"") { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden });
        } catch { }
    }
}
