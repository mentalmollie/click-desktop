# Публикация новой версии Click

1. Увеличить версию в package.json и package-lock.json, обновить release-notes.json.
2. Запустить `node tools/build.js`. Он собирает установщик и каталог `dist/update-release` с проверяемыми файлами и `latest.json`.
3. Из соседнего проекта `click-website` запустить `node scripts/sync-release.cjs "D:\claude code\glassdock\dist\update-release"`, затем `node scripts/verify-site.cjs`.
4. Опубликовать эту версию сайта через Sites, сохраняя project_id из `.openai/hosting.json` и установленную аудиторию. Не менять адрес сайта: он указан в `update-channel.json` уже установленных приложений.
5. Проверить публичный `/updates/latest.json`. В приложении предыдущей версии нажать «Настройки → Обновления → Проверить обновления».

Один установщик хранится на сайте частями до 20 МиБ из-за ограничения на размер статического файла. И сайт, и приложение собирают исходный EXE в правильном порядке, проверяя SHA-256 частей. Приложение также проверяет SHA-256 всего файла перед скачиванием до конца и перед запуском. Настройки и ключи не входят в публикацию.

Проверки: `node tools/test-updates.js`, `node tools/test-hold.js`, `node tools/test-flight.js`.
