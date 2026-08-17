# Развёртывание репозитория на сервере

Инструкция рассчитана на домен `gpodvorotov.ru`, поддомен `repo.gpodvorotov.ru` и сервер Linux. Порты `80` и `443` могут оставаться занятыми системным Nginx и Xray/VPN: публичный HTTPS-трафик пойдёт через Cloudflare Tunnel.

## 1. Что переносить на сервер

Рекомендуемый способ — клонировать весь GitHub-репозиторий. В нём Docker использует следующие файлы:

```text
Dockerfile
compose.yaml
.dockerignore
.env.example
package.json
bun.lock
tsconfig.json
biome.json
repo.config.json
types/
plugins/auto-translate/
docker/nginx.conf
```

Не переносите локальные `node_modules`, `.gradle`, `.idea`, `build`, `local.properties` и настоящий `.env`. Если Git пока недоступен, можно передать перечисленные файлы и каталоги через SFTP/SCP с сохранением структуры.

## 2. Подготовка сервера

Установите Git, Docker Engine и Docker Compose plugin. Для Ubuntu/Debian после установки проверьте:

```bash
git --version
docker --version
docker compose version
```

Клонируйте репозиторий:

```bash
git clone https://github.com/YourX36/ww.PGV.yourX.ravengeRepo.git
cd ww.PGV.yourX.ravengeRepo
```

Если файлы переносились вручную, просто перейдите в каталог с `compose.yaml`.

## 3. Что делать, пока DNS инициализируется

Можно заранее выполнить всю серверную подготовку и создать Tunnel. До активации nameserver-ов публичный адрес может не открываться — это нормально. Не меняйте DNS повторно и дождитесь статуса **Active** в Cloudflare.

Проверять делегирование можно командами:

```bash
dig NS gpodvorotov.ru +short
dig repo.gpodvorotov.ru +short
```

Продолжайте настройку, когда первая команда покажет nameserver-ы Cloudflare. Распространение DNS иногда занимает до 24–48 часов.

## 4. Подключение домена к Cloudflare

1. В Cloudflare нажмите **Add a domain** и добавьте `gpodvorotov.ru`.
2. Cloudflare покажет два nameserver-а.
3. В REG.RU откройте управление DNS/NS домена и замените текущие NS на выданные Cloudflare.
4. Сохраните существующие DNS-записи, особенно используемые VPN. Записи VPN/Xray лучше оставить в режиме **DNS only** — серое облако.
5. Дождитесь статуса домена **Active** в Cloudflare.

Для Tunnel не нужно направлять входящий порт `443` на контейнер и не нужно останавливать Xray.

## 5. Создание Cloudflare Tunnel

1. Откройте **Cloudflare Zero Trust**.
2. Перейдите в **Networks → Connectors → Cloudflare Tunnels**.
3. Создайте remotely-managed tunnel с именем, например, `revenge-repository`.
4. На шаге установки connector выберите Docker и скопируйте только длинный token после `--token`.
5. Откройте tunnel → **Public Hostnames** → **Add a public hostname**.
6. Укажите:

   ```text
   Subdomain: repo
   Domain:    gpodvorotov.ru
   Type:      HTTP
   URL:       repository:80
   ```

7. Сохраните hostname. Cloudflare создаст связанную DNS-запись автоматически.

`repository:80` — это имя Docker-сервиса во внутренней сети Compose, не порт хоста. Входящие `80/443` контейнер не публикует. При строгом исходящем firewall разрешите `cloudflared` соединения к Cloudflare на порту `7844`.

## 6. Секретная конфигурация

В каталоге проекта на сервере:

```bash
cp .env.example .env
nano .env
```

Содержимое должно выглядеть так:

```dotenv
REPOSITORY_HOST=repo.gpodvorotov.ru
CLOUDFLARE_TUNNEL_TOKEN=сюда_реальный_token_tunnel
REVENGE_NEXT_REF=main
```

Не отправляйте `.env` другим людям и не добавляйте его в Git. Права можно ограничить:

```bash
chmod 600 .env
```

## 7. Первый запуск

```bash
docker compose up -d --build
docker compose ps
```

Первая сборка скачивает зависимости и официальный исходный код Revenge Next, поэтому может занять несколько минут.

Логи:

```bash
docker compose logs --tail=200 repository
docker compose logs --tail=200 cloudflared
```

После активации DNS проверьте:

```bash
curl --fail https://repo.gpodvorotov.ru/index.json
curl -I https://repo.gpodvorotov.ru/revenge.bundle
curl -I https://repo.gpodvorotov.ru/com.gleb.autotranslate.zip
```

Все три адреса должны отвечать `HTTP 200`.

## 8. Выпуск обновления плагина

На компьютере разработчика:

1. Измените код.
2. Увеличьте версию в `plugins/auto-translate/manifest.json`.
3. Выполните:

   ```bash
   bun run lint:types
   bun run build auto-translate
   ./gradlew packageAutoTranslate
   ```

4. Закоммитьте и отправьте изменения на GitHub.

На сервере:

```bash
cd ww.PGV.yourX.ravengeRepo
git pull --ff-only
docker compose up -d --build
docker compose ps
curl --fail https://repo.gpodvorotov.ru/index.json
```

Контейнер заменяется только после успешной сборки. Пользователи, подключившие `index.json`, увидят новую версию при проверке обновлений.

## 9. Обновление Revenge Next bundle

При `REVENGE_NEXT_REF=main` каждая новая Docker-сборка получает актуальный commit официальной ветки `main`.

```bash
docker compose build --no-cache repository
docker compose up -d
```

Для воспроизводимой сборки вместо `main` можно указать полный commit SHA в `.env`.

## 10. Диагностика

Проверка контейнеров и tunnel:

```bash
docker compose ps
docker compose logs --tail=200 cloudflared
docker compose logs --tail=200 repository
```

Если `repository` healthy, но сайт не открывается:

- проверьте, что домен в Cloudflare имеет статус **Active**;
- проверьте Public Hostname и адрес `http://repository:80`;
- проверьте token в `.env`;
- убедитесь, что сервер имеет исходящий интернет-доступ;
- дождитесь завершения распространения DNS.

После замены или удаления tunnel старый token следует считать недействительным и заменить в `.env`.
