# Перехват клавиши Win: одиночное нажатие открывает «Пуск» Click, сочетания (Win+E, Win+D…) работают как обычно.
# Как это устроено: настоящее нажатие Win придерживаем. Если до отпускания нажата другая клавиша —
# «досылаем» Win и эту клавишу, и Windows видит обычное сочетание. Если Win отпустили одну — пишем
# в вывод строку "start", а системный «Пуск» не открывается. Нажатия, которые прислали программы
# (injected), не трогаем — так продолжают работать горячие клавиши, которые посылает сам док.
# Работает отдельным процессом или внутри host.ps1 ($ChanIn/$ChanOut вместо консоли). Конец ввода — снимаем перехват.
if (-not $Hosted) { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $ChanIn = [Console]::In; $ChanOut = [Console]::Out }

Add-Type @'
using System;
using System.IO;
using System.Threading;
using System.Runtime.InteropServices;

public static class WinKey {
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] struct KBD { public uint vk, scan, flags, time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }

    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc fn, IntPtr mod, uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint tid, uint msg, IntPtr w, IntPtr l);

    static readonly HookProc proc = Hook;   // держим ссылку, чтобы делегат не собрал GC
    static bool winDown, combo;
    static byte winVk;
    static TextWriter output;
    static uint loopThread;

    static IntPtr Hook(int code, IntPtr w, IntPtr l) {
        if (code >= 0) {
            var k = (KBD)Marshal.PtrToStructure(l, typeof(KBD));
            bool injected = (k.flags & 0x10) != 0;
            int msg = w.ToInt32();
            bool down = msg == 0x100 || msg == 0x104;
            bool isWin = k.vk == 0x5B || k.vk == 0x5C;
            if (!injected) {
                if (isWin) {
                    if (down) {
                        if (!winDown) { winDown = true; combo = false; winVk = (byte)k.vk; }
                        return (IntPtr)1;
                    }
                    if (winDown) {
                        winDown = false;
                        if (combo) keybd_event(winVk, 0, 3, UIntPtr.Zero);   // отпустить «досланный» Win
                        else {
                            // Нажатие получили мы — значит, можем разрешить доку забрать фокус для «Пуска»
                            AllowSetForegroundWindow(-1);
                            Say("start");
                        }
                        return (IntPtr)1;
                    }
                } else if (winDown && down && !combo) {
                    // Сочетание: сначала Win, потом сама клавиша — оба уже как присланные
                    combo = true;
                    keybd_event(winVk, 0, 1, UIntPtr.Zero);
                    keybd_event((byte)k.vk, (byte)k.scan, (k.flags & 1) != 0 ? 1u : 0u, UIntPtr.Zero);
                    return (IntPtr)1;
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, w, l);
    }

    static void Say(string s) {
        try { output.WriteLine(s); output.Flush(); }
        catch { Quit(); }   // док закрылся — уходим и снимаем перехват
    }

    static void Quit() { PostThreadMessage(loopThread, 0x12, IntPtr.Zero, IntPtr.Zero); }   // WM_QUIT

    public static void Run(TextReader input, TextWriter o) {
        output = o;
        winDown = false; combo = false;
        loopThread = GetCurrentThreadId();
        IntPtr hook = SetWindowsHookEx(13, proc, GetModuleHandle(null), 0);   // WH_KEYBOARD_LL
        // Конец ввода (док закрылся или выключил перехват) — выходим из цикла сообщений
        new Thread(() => { try { while (input.ReadLine() != null) { } } catch { } Quit(); }) { IsBackground = true }.Start();
        Say("ready");
        MSG m;
        while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
        UnhookWindowsHookEx(hook);
    }
}
'@
[WinKey]::Run($ChanIn, $ChanOut)
