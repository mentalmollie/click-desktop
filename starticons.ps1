# Иконки приложений «Пуска» через оболочку Windows (работает и для приложений из Store).
# Список AppID читает из stdin (по одному на строку), пишет JSON { "AppID": "data:image/png;base64,..." }.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

[ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItemImageFactory { [PreserveSig] int GetImage(ShellSize size, int flags, out IntPtr phbm); }

[StructLayout(LayoutKind.Sequential)] public struct ShellSize { public int cx, cy; }

public static class StartIcons {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);

    public static string Png(string appId, int size) {
        IShellItemImageFactory f;
        try { SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f); }
        catch { return null; }
        IntPtr hb;
        if (f.GetImage(new ShellSize { cx = size, cy = size }, 0x4 /* SIIGBF_ICONONLY */, out hb) != 0) return null;
        try {
            // FromHbitmap теряет прозрачность — переносим пиксели в ARGB вручную
            using (var raw = Image.FromHbitmap(hb)) {
                var bd = raw.LockBits(new Rectangle(0, 0, raw.Width, raw.Height), ImageLockMode.ReadOnly, raw.PixelFormat);
                using (var argb = new Bitmap(bd.Width, bd.Height, bd.Stride, PixelFormat.Format32bppArgb, bd.Scan0))
                using (var copy = new Bitmap(argb))
                using (var ms = new MemoryStream()) {
                    raw.UnlockBits(bd);
                    copy.Save(ms, ImageFormat.Png);
                    return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
                }
            }
        } finally { DeleteObject(hb); }
    }
}
'@

$out = [ordered]@{}
while ($null -ne ($id = [Console]::In.ReadLine())) {
    $id = $id.Trim()
    if (-not $id) { continue }
    $png = [StartIcons]::Png($id, 64)
    if ($png) { $out[$id] = $png }
}
ConvertTo-Json -Compress -InputObject $out
