# Запуск репозитория на сервере

Рабочая цепочка:

```text
телефон → Cloudflare HTTPS:443 → Origin Rule → сервер HTTPS:9443
       → системный Nginx → 127.0.0.1:8083 → Docker repository:80
```

Xray продолжает слушать серверный `443`, а MTProto — `8443`. Cloudflare Zero Trust и `cloudflared` не используются.

## 1. Настройки Cloudflare

Должны быть выполнены три условия:

1. DNS-запись `A repo → IP_СЕРВЕРА` имеет статус **Proxied** (оранжевое облако).
2. `SSL/TLS → Overview` установлен в **Full (strict)**.
3. Origin Rule содержит:

   ```text
   Condition:        (http.host eq "repo.gpodvorotov.ru")
   Destination Port: Rewrite to 9443
   ```

Origin CA certificate для `repo.gpodvorotov.ru` и его приватный ключ должны находиться только на сервере:

```text
/etc/nginx/ssl/gpodvorotov.ru.pem
/etc/nginx/ssl/gpodvorotov.ru.key
```

## 2. Какие файлы нужны на сервере

Удобнее клонировать весь репозиторий. Для Docker фактически нужны:

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
server/nginx/revenge-repository.conf
```

Не переносите `node_modules`, `build`, `.gradle`, `.idea`, `local.properties`, `.env`, сертификат и приватный ключ через Git.

## 3. Перенос проекта

Вариант с Git после слияния актуальной ветки в `main`:

```bash
cd /opt
sudo git clone https://github.com/YourX36/ww.PGV.yourX.ravengeRepo.git
sudo chown -R "$USER":"$USER" /opt/ww.PGV.yourX.ravengeRepo
cd /opt/ww.PGV.yourX.ravengeRepo
```

При ручном переносе скопируйте перечисленные выше файлы в:

```text
/opt/ww.PGV.yourX.ravengeRepo/
```

с сохранением структуры каталогов.

## 4. Конфигурация Docker

```bash
cd /opt/ww.PGV.yourX.ravengeRepo
cp .env.example .env
chmod 600 .env
nano .env
```

Содержимое:

```dotenv
REPOSITORY_HOST=repo.gpodvorotov.ru
REVENGE_NEXT_REF=main
```

Запуск:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 repository
```

Первая сборка может занять несколько минут. В `docker compose ps` сервис должен стать `healthy`.

Проверка Docker без Nginx и Cloudflare:

```bash
curl -I http://127.0.0.1:8083/index.json
curl -I http://127.0.0.1:8083/revenge.bundle
curl -I http://127.0.0.1:8083/com.gleb.autotranslate.zip
```

Все три запроса должны вернуть `HTTP/1.1 200 OK`.

## 5. Установка конфигурации Nginx

Скопируйте подготовленный конфиг:

```bash
sudo cp server/nginx/revenge-repository.conf \
  /etc/nginx/sites-available/revenge-repository
```

Убедитесь, что пути к certificate и key совпадают с файлами на сервере:

```bash
sudo ls -l /etc/nginx/ssl/gpodvorotov.ru.pem \
  /etc/nginx/ssl/gpodvorotov.ru.key
sudo chmod 600 /etc/nginx/ssl/gpodvorotov.ru.key
```

Проверьте, что certificate включает поддомен:

```bash
sudo openssl x509 -in /etc/nginx/ssl/gpodvorotov.ru.pem \
  -noout -subject -issuer -ext subjectAltName
```

Активируйте сайт:

```bash
sudo ln -s /etc/nginx/sites-available/revenge-repository \
  /etc/nginx/sites-enabled/revenge-repository
sudo nginx -t
sudo systemctl reload nginx
sudo ss -lntp | grep ':9443'
```

Если символьная ссылка уже существует, повторно создавать её не нужно.

Откройте TCP-порт `9443` в firewall сервера и панели хостинга:

```bash
sudo ufw allow 9443/tcp
sudo ufw status
```

## 6. Проверка Nginx напрямую

На сервере:

```bash
curl -kI --resolve repo.gpodvorotov.ru:9443:127.0.0.1 \
  https://repo.gpodvorotov.ru:9443/index.json
```

Ожидается `HTTP/1.1 200 OK`. Опция `-k` нужна только для локальной проверки Cloudflare Origin CA: этот certificate доверен Cloudflare, а не системному хранилищу сервера.

## 7. Публичная проверка через Cloudflare

```bash
curl -I https://repo.gpodvorotov.ru/index.json
curl -I https://repo.gpodvorotov.ru/revenge.bundle
curl -I https://repo.gpodvorotov.ru/com.gleb.autotranslate.zip
```

Ожидается `HTTP 200`, а в заголовках обычно присутствует `server: cloudflare`.

Типичные ошибки:

- `521`: Nginx не слушает `9443` или порт закрыт firewall;
- `522`: Cloudflare не может подключиться к IP сервера;
- `525/526`: ошибка certificate/key или режим не `Full (strict)`;
- `502`: Nginx не видит Docker на `127.0.0.1:8083`;
- `404`: запрошен неправильный путь или контейнер собран некорректно.

## 8. Проверка с телефона

Отключите Wi-Fi, чтобы проверить внешний доступ через мобильную сеть, и откройте в браузере:

```text
https://repo.gpodvorotov.ru/index.json
```

Должен открыться или скачаться JSON без предупреждения о certificate. Затем проверьте:

```text
https://repo.gpodvorotov.ru/revenge.bundle
https://repo.gpodvorotov.ru/com.gleb.autotranslate.zip
```

Переход на Revenge Next:

```text
Discord → Settings → Revenge → Developer Settings
→ Developer → Load from custom URL
```

Вставьте:

```text
https://repo.gpodvorotov.ru/revenge.bundle
```

Полностью перезапустите Discord. Затем добавьте репозиторий:

```text
Revenge → Plugins → шестерёнка → Repository URL
https://repo.gpodvorotov.ru/index.json
```

Нажмите **Add repository**, откройте **Browse plugins**, установите **Auto Translate RU** и перезапустите Discord.

## 9. Обновления

После изменения кода увеличьте версию в `plugins/auto-translate/manifest.json`, отправьте изменения в Git, затем на сервере выполните:

```bash
cd /opt/ww.PGV.yourX.ravengeRepo
git pull --ff-only
docker compose up -d --build
docker compose ps
```
