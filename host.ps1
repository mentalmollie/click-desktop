# Один процесс PowerShell вместо нескольких: помощники (winkey, keys, media, mediactl, windows, appbar)
# работают каждый в своём потоке (runspace) внутри этого процесса. Экономит ~60 МБ памяти на помощника.
#
# Обмен с доком — строками UTF-8:
#   stdin:  "+<имя>"          — запустить помощника <имя>.ps1
#           "-<имя>"          — остановить (он получает конец ввода, а через 1,5 с — принудительно)
#           "<имя> <строка>"  — строка во ввод помощника
#   stdout: "<имя> <строка>"  — строка, которую помощник написал в свой вывод
#           "<имя> !exit"     — помощник завершился (сам или после ошибки)
# Конец stdin (док закрылся или упал) — останавливаем всех и выходим; appbar при этом снимает резерв экрана.
#
# Сами помощники ничего не знают про хозяина: им передаются переменные $ChanIn и $ChanOut (вместо консоли)
# и $Hosted = $true. Запущенные отдельно (powershell -File x.ps1), они работают с консолью, как раньше.
$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections.Concurrent;

// Ввод помощника: строки из очереди; после CompleteAdding — конец ввода (null)
public class ChanReader : TextReader {
    public readonly BlockingCollection<string> Q = new BlockingCollection<string>();
    public override string ReadLine() {
        string s;
        try { return Q.TryTake(out s, Timeout.Infinite) ? s : null; } catch (InvalidOperationException) { return null; }
    }
    public override int Peek() { return -1; }
}

// Вывод помощника: собираем до перевода строки и отдаём в общий stdout с именем помощника
public class ChanWriter : TextWriter {
    static readonly object Lock = new object();
    static TextWriter real;
    public static void Init(TextWriter w) { real = w; }
    public static void Emit(string name, string line) {
        lock (Lock) { real.Write(name); real.Write(' '); real.Write(line); real.Write('\n'); real.Flush(); }
    }
    readonly string name;
    readonly StringBuilder sb = new StringBuilder();
    public ChanWriter(string n) { name = n; }
    public override Encoding Encoding { get { return Encoding.UTF8; } }
    public override void Write(char c) {
        lock (sb) {
            if (c == '\n') { Emit(name, sb.ToString().TrimEnd('\r')); sb.Clear(); }
            else sb.Append(c);
        }
    }
    public override void Write(string s) { if (s != null) foreach (char c in s) Write(c); }
    public override void WriteLine(string s) { Write(s); Write('\n'); }
    public override void WriteLine() { Write('\n'); }
    public override void Flush() { }
}

// stdin дока читаем в отдельном потоке: главный цикл тогда может ещё и следить за помощниками
public static class HostInput {
    public static readonly BlockingCollection<string> Lines = new BlockingCollection<string>();
    public static void Start(TextReader r) {
        new Thread(() => {
            string s;
            while ((s = r.ReadLine()) != null) Lines.Add(s);
            Lines.CompleteAdding();
        }) { IsBackground = true }.Start();
    }
}
'@

$utf8 = New-Object System.Text.UTF8Encoding $false
[ChanWriter]::Init((New-Object System.IO.StreamWriter ([Console]::OpenStandardOutput()), $utf8))
[HostInput]::Start((New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), $utf8))

$chans = @{}

function Start-Chan([string]$name) {
    if ($chans.ContainsKey($name)) { return }
    $file = Join-Path $PSScriptRoot "$name.ps1"
    if (-not (Test-Path $file)) { [ChanWriter]::Emit($name, '!exit'); return }
    $rd = New-Object ChanReader
    $wr = New-Object ChanWriter $name
    $rs = [runspacefactory]::CreateRunspace()
    # STA — только для appbar (окно WinForms). Остальным MTA: в STA-потоке ожидание WinRT (media) зависает
    $rs.ApartmentState = $(if ($name -eq 'appbar') { 'STA' } else { 'MTA' })
    $rs.ThreadOptions = 'ReuseThread'
    $rs.Open()
    # Имена — не $In/$Out: в помощниках бывают свои $out (PowerShell не различает регистр)
    $rs.SessionStateProxy.SetVariable('ChanIn', $rd)
    $rs.SessionStateProxy.SetVariable('ChanOut', $wr)
    $rs.SessionStateProxy.SetVariable('Hosted', $true)
    $ps = [powershell]::Create()
    $ps.Runspace = $rs
    $null = $ps.AddCommand($file)
    $chans[$name] = @{ ps = $ps; rs = $rs; rd = $rd; h = $ps.BeginInvoke(); stopAt = $null }
}

function Stop-Chan([string]$name) {
    $c = $chans[$name]
    if (-not $c -or $c.stopAt) { return }
    $c.rd.Q.CompleteAdding()
    $c.stopAt = (Get-Date).AddMilliseconds(1500)
}

# Проверка помощников: завершившихся — убрать и сообщить; не остановившихся за 1,5 с — остановить силой
# (get_Keys(), а не .Keys: у хэш-таблицы .Keys вернёт помощника по имени «keys»)
function Check-Chans {
    foreach ($name in @($chans.get_Keys())) {
        $c = $chans[$name]
        if ($c.h.IsCompleted) {
            # Ошибки — доку в журнал; остановку по нашей же команде ошибкой не считаем
            try { $c.ps.EndInvoke($c.h) | Out-Null } catch { if (-not $c.stopAt) { [ChanWriter]::Emit($name, '!err ' + ($_.Exception.Message -replace '\s+', ' ')) } }
            if (-not $c.stopAt) { foreach ($e in $c.ps.Streams.Error) { [ChanWriter]::Emit($name, '!err ' + ("$e" -replace '\s+', ' ')) } }
            try { $c.ps.Dispose(); $c.rs.Dispose() } catch {}
            $chans.Remove($name)
            [ChanWriter]::Emit($name, '!exit')
        } elseif ($c.stopAt -and (Get-Date) -gt $c.stopAt) {
            $c.stopAt = (Get-Date).AddSeconds(10)
            try { $null = $c.ps.BeginStop($null, $null) } catch {}
        }
    }
}

while ($true) {
    $line = $null
    $got = [HostInput]::Lines.TryTake([ref]$line, 300)
    if (-not $got) {
        if ([HostInput]::Lines.IsCompleted) { break }
        Check-Chans
        continue
    }
    if ($line.StartsWith('+')) { Start-Chan $line.Substring(1).Trim() }
    elseif ($line.StartsWith('-')) { Stop-Chan $line.Substring(1).Trim() }
    else {
        $i = $line.IndexOf(' ')
        $name = if ($i -lt 0) { $line } else { $line.Substring(0, $i) }
        $c = $chans[$name]
        if ($c -and -not $c.rd.Q.IsAddingCompleted) { $c.rd.Q.Add($(if ($i -lt 0) { '' } else { $line.Substring($i + 1) })) }
    }
    Check-Chans
}

# Док закрылся: всем — конец ввода, ждём до 2 с (appbar снимает резерв), остальное — силой
foreach ($name in @($chans.get_Keys())) { Stop-Chan $name }
$until = (Get-Date).AddSeconds(2)
while ($chans.get_Count() -and (Get-Date) -lt $until) { Start-Sleep -Milliseconds 100; Check-Chans }
foreach ($c in @($chans.get_Values())) { try { $null = $c.ps.BeginStop($null, $null) } catch {} }
[Environment]::Exit(0)
