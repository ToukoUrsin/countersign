FROM oven/bun:1.3.3
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY web/package.json web/bun.lock ./web/
RUN cd web && bun install --frozen-lockfile
COPY server ./server
COPY shared ./shared
COPY pipeline ./pipeline
COPY policy ./policy
COPY sandbox ./sandbox
COPY rounds.jsonl tsconfig.json ./
COPY web ./web
RUN cd web && bunx vite build
COPY deploy/demo-data ./deploy/demo-data
RUN cp -a deploy/demo-data deploy/demo-data-clean
COPY deploy/entrypoint.sh ./deploy/entrypoint.sh
RUN chmod +x deploy/entrypoint.sh
ENV PORT=8080
ENV CS_PUBLIC_DEMO=1
ENV CS_NO_PUBLISH=1
ENV CS_DEMO_SIGNERS=1
ENV CS_LIVE_BUDGET=30
ENV CS_DATA=/tmp/countersign-data
ENV CS_GITHUB_SNAPSHOT=/tmp/countersign-data/github-snapshot.json
EXPOSE 8080
CMD ["/app/deploy/entrypoint.sh"]
