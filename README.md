# Auto Translate RU for Revenge Next

Плагин автоматически переводит входящие сообщения Discord на русский язык и исходящие русские сообщения на английский.

Входящий перевод добавляется локально под оригиналом:

```text
John
We need to restart the server after the update.

> 🇷🇺 Нужно перезапустить сервер после обновления.
```

Исходный текст собеседника на сервере Discord не изменяется. При отправке русского сообщения плагин заменяет его английским переводом до отправки.

## Возможности

- английский → русский для входящих сообщений;
- русский → английский для исходящих сообщений;
- кэширование переводов и защита от повторной обработки;
- установка из собственного Revenge-репозитория или ZIP;
- автоматические обновления через `index.json`;
- размещение репозитория и Revenge Next bundle в Docker;
- HTTPS через обычный Cloudflare Proxy и Origin Rule без Zero Trust;
- совместная работа с Xray/VPN, уже занимающим серверный порт `443`.

Переводы выполняются через публичный endpoint Google Translate. Для работы требуется интернет; endpoint не является официальным платным Google Cloud Translation API и может ограничивать частоту запросов.

## Публичные адреса

После развёртывания сервера:

```text
Revenge Next: https://repo.gpodvorotov.ru/revenge.bundle
Repository:   https://repo.gpodvorotov.ru/index.json
Plugin ZIP:   https://repo.gpodvorotov.ru/com.gleb.autotranslate.zip
```

## Установка пользователем

Подробная инструкция для установки с телефона находится в [INSTALL_FROM_FILE.md](INSTALL_FROM_FILE.md). Компьютер пользователю не нужен: Revenge Next загружается по постоянному HTTPS-адресу владельца репозитория.

## Локальная разработка

Требуются Bun, JDK и Android SDK.

```bash
bun install
bun run lint:types
bun run build auto-translate
./gradlew packageAutoTranslate
```

Готовый архив:

```text
build/dist/com.gleb.autotranslate.zip
```

После изменения плагина обязательно увеличьте `version` в `plugins/auto-translate/manifest.json`, иначе Revenge не предложит обновление.

## Развёртывание

Полная инструкция для владельца сервера, включая Cloudflare Proxy, Origin Rule и Nginx: [SERVER_SETUP.md](SERVER_SETUP.md).

Краткий запуск после создания `.env`:

```bash
docker compose up -d --build
```

Контейнер собирает Auto Translate, формирует `index.json`, собирает официальный Revenge Next bundle и отдаёт файлы локально на `127.0.0.1:8083`. Системный Nginx принимает Cloudflare-трафик на `8443`; Xray продолжает занимать `443`.

## Структура

```text
plugins/auto-translate/  исходный код и manifest плагина
docker/nginx.conf        конфигурация статического сервера
Dockerfile               сборка плагина и Revenge Next
compose.yaml              Docker-сервис repository
.env.example              безопасный шаблон конфигурации
server/nginx/             конфигурация системного Nginx
SERVER_SETUP.md           инструкция владельцу сервера
INSTALL_FROM_FILE.md      инструкция пользователю
```

## Безопасность

Никогда не коммитьте `.env`, приватный ключ Origin CA или другие сертификаты/ключи. В Git хранится только безопасный шаблон `.env.example`; ключи остаются в `/etc/nginx/ssl` на сервере.

## Предупреждение

Revenge — сторонняя модификация Discord и не связана с Discord Inc. Использование модифицированного клиента может нарушать правила Discord. Установка выполняется пользователем на свой риск.

Исходный проект Revenge Next: <https://github.com/revenge-mod/revenge-bundle-next>.

## Лицензия

Проект распространяется по лицензии [GPL-3.0](LICENSE).
