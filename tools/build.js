// Сборка программы Click.
// Запуск: node tools\build.js          → dist\Click-win32-x64\Click.exe и установщик dist\Click-Setup-<версия>.exe
//         node tools\build.js install  → и ещё копия в %LOCALAPPDATA%\Programs\Click + ярлыки (без установщика)
// Установщик и деинсталлятор — tools\installer\installer.cs, компилируются встроенным в Windows csc.exe.
//
// Код кладётся как есть, без архива asar: помощники PowerShell (*.ps1) запускаются отдельными
// процессами и должны лежать обычными файлами. Личные данные (настройки, ключи, распознаватель речи)
// в сборку не попадают — программа хранит их в %APPDATA%\GlassDock\data (см. paths.js).
const { packager } = require('@electron/packager');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { createRelease } = require('./create-release');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const pkg = require(path.join(ROOT, 'package.json'));

// Что не кладём в сборку (пути от корня проекта, через «/»)
const IGNORE = [
  /^\/dist($|\/)/, /^\/tools($|\/)/, /^\/whisper($|\/)/, /^\/\.claude($|\/)/, /^\/\.git($|\/)/,
  /^\/(config|todos|social|start-cache|start-icons)\.json$/, /\.key$/,
  /^\/package-lock\.json$/,
  /^\/assets\/[^/]*sheet[^/]*\.(png|webp)$/,   // исходные листы кадров — нарезанные кадры лежат в assets/<имя>/
];

(async () => {
  const [appDir] = await packager({
    dir: ROOT,
    out: OUT,
    name: 'Click',
    executableName: 'Click',
    platform: 'win32',
    arch: 'x64',
    appVersion: pkg.version,
    icon: path.join(ROOT, 'assets', 'app.ico'),
    asar: false,
    overwrite: true,
    prune: true,
    ignore: (p) => IGNORE.some((re) => re.test(p.replace(/\\/g, '/'))),
    win32metadata: { CompanyName: 'Click', FileDescription: 'Click', ProductName: 'Click', InternalName: 'Click', OriginalFilename: 'Click.exe' },
  });
  const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  console.log('собрано:', appDir, `(${Math.round(size(appDir) / 1048576)} МБ)`);

  // ---- Установщик ----
  const CSC = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  const INST = path.join(ROOT, 'tools', 'installer');
  // Версия — из package.json
  const src = path.join(OUT, 'installer.cs');
  fs.writeFileSync(src, fs.readFileSync(path.join(INST, 'installer.cs'), 'utf8').replace(/Version = "[^"]*"/, `Version = "${pkg.version}"`));
  const logo = path.join(ROOT, 'assets', 'app-icon.png');
  const csc = (out, extra) => execFileSync(CSC, ['/nologo', '/target:winexe', '/optimize+', '/codepage:65001',
    `/win32icon:${path.join(ROOT, 'assets', 'app.ico')}`, `/win32manifest:${path.join(INST, 'app.manifest')}`,
    '/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
    `/resource:${logo},logo.png`, ...extra, `/out:${out}`, src], { stdio: 'inherit' });
  // 1) деинсталлятор — внутрь папки программы, чтобы попал в архив
  csc(path.join(appDir, 'Uninstall Click.exe'), []);
  // 2) архив программы
  const zip = path.join(OUT, 'app.zip');
  fs.rmSync(zip, { force: true });
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${appDir.replace(/'/g, "''")}', '${zip.replace(/'/g, "''")}', 'Optimal', $false)`],
  { stdio: 'inherit' });
  // 3) установщик с архивом внутри
  const setup = path.join(OUT, `Click-Setup-${pkg.version}.exe`);
  csc(setup, [`/resource:${zip},app.zip`]);
  fs.rmSync(zip, { force: true });
  fs.rmSync(src, { force: true });
  console.log('установщик:', setup, `(${Math.round(fs.statSync(setup).size / 1048576)} МБ)`);
  const releaseDir = path.join(OUT, 'update-release');
  await createRelease(setup, releaseDir, pkg.version, require('../release-notes.json').notes);
  console.log('файлы обновления для сайта:', releaseDir);

  if (process.argv.includes('install')) {
    const dest = path.join(process.env.LOCALAPPDATA, 'Programs', 'Click');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(appDir, dest, { recursive: true });
    const exe = path.join(dest, 'Click.exe');
    // Ярлыки: рабочий стол и меню «Пуск»
    const lnk = (file) => `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${file.replace(/'/g, "''")}');` +
      `$s.TargetPath='${exe.replace(/'/g, "''")}';$s.WorkingDirectory='${dest.replace(/'/g, "''")}';$s.IconLocation='${exe.replace(/'/g, "''")},0';$s.Description='Click';$s.Save()`;
    const desktop = execFileSync('powershell.exe', ['-NoProfile', '-Command', '[Environment]::GetFolderPath("Desktop")'], { encoding: 'utf8' }).trim();
    const startMenu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    for (const f of [path.join(desktop, 'Click.lnk'), path.join(startMenu, 'Click.lnk')]) {
      execFileSync('powershell.exe', ['-NoProfile', '-Command', lnk(f)], { windowsHide: true });
    }
    console.log('установлено:', exe, '+ ярлыки на рабочем столе и в «Пуске»');
  }
})().catch((e) => { console.error('ошибка сборки:', e.message); process.exit(1); });
