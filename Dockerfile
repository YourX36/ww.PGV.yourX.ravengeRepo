FROM oven/bun:1.3.14-debian AS builder

USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git zip \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock tsconfig.json biome.json repo.config.json ./
COPY types ./types
COPY plugins/auto-translate ./plugins/auto-translate

ARG REPOSITORY_BASE_URL
RUN test -n "$REPOSITORY_BASE_URL" \
	&& case "$REPOSITORY_BASE_URL" in http://*|https://*) ;; *) echo "REPOSITORY_BASE_URL must start with http:// or https://" >&2; exit 1;; esac

RUN mkdir -p /app/vendor/plugin-cli /app/vendor/types \
	&& git -C /app/vendor/plugin-cli init \
	&& git -C /app/vendor/plugin-cli remote add origin https://github.com/revenge-mod/revenge-plugin-cli.git \
	&& git -C /app/vendor/plugin-cli fetch --depth 1 origin 2b87bee42f57ba0864f5f077d7da500d5397c1c0 \
	&& git -C /app/vendor/plugin-cli checkout --detach FETCH_HEAD \
	&& git -C /app/vendor/types init \
	&& git -C /app/vendor/types remote add origin https://github.com/revenge-mod/revenge-types.git \
	&& git -C /app/vendor/types fetch --depth 1 origin 90401c0dc470d12159ec7aeedaad355b4942f1c9 \
	&& git -C /app/vendor/types checkout --detach FETCH_HEAD \
	&& sed -i 's|git+https://github.com/revenge-mod/revenge-types.git|file:/app/vendor/types|' /app/vendor/plugin-cli/package.json \
	&& sed -i 's|git+https://github.com/revenge-mod/revenge-plugin-cli.git|file:/app/vendor/plugin-cli|' package.json \
	&& sed -i 's|git+https://github.com/revenge-mod/revenge-types.git|file:/app/vendor/types|' package.json

RUN bun install
RUN bun run lint:types
RUN bun run build auto-translate

RUN mkdir -p /site /package \
	&& cp plugins/auto-translate/manifest.json /package/manifest.json \
	&& cp plugins/auto-translate/build/js/index.js /package/index.js \
	&& cd /package \
	&& zip -q /site/com.gleb.autotranslate.zip manifest.json index.js

RUN bun --bun node_modules/@revenge-mod/plugin-cli/bin/revenge-plugin.js \
	generate-index \
	--dist /site \
	--base-url "$REPOSITORY_BASE_URL" \
	--out /site/index.json

FROM denoland/deno:2.9.5 AS revenge-next-builder

USER root
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git \
	&& rm -rf /var/lib/apt/lists/*

ARG REVENGE_NEXT_REF=main
WORKDIR /revenge-next
RUN git init \
	&& git remote add origin https://github.com/revenge-mod/revenge-bundle-next.git \
	&& git fetch --depth 1 origin "$REVENGE_NEXT_REF" \
	&& git checkout --detach FETCH_HEAD
RUN deno install --frozen
RUN REVENGE_DISCORD_SERVER_URL=https://discord.gg/revenge \
	REVENGE_SOURCE_REPOSITORY_URL=https://github.com/revenge-mod/revenge-bundle-next \
	REVENGE_LICENSE_URL=https://github.com/revenge-mod/revenge-bundle-next/blob/main/LICENSE \
	deno run build
RUN test -s dist/revenge.bundle

FROM nginx:alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /site /usr/share/nginx/html
COPY --from=revenge-next-builder /revenge-next/dist/revenge.bundle /usr/share/nginx/html/revenge.bundle

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1/index.json || exit 1
