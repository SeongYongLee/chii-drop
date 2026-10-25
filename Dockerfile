FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5180 ONLINE_DATA_FILE=/data/online.json
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate && pnpm install --prod --frozen-lockfile
COPY server ./server
COPY src ./src
COPY scripts/build-info.mjs ./scripts/build-info.mjs
COPY skins/chiikawa/pages-runtime/manifest.json ./skins/chiikawa/pages-runtime/manifest.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 5180
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
