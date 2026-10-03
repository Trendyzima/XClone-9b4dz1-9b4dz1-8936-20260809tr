FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm install --package-lock-only --ignore-scripts --no-audit --no-fund
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build
RUN npx tsc -p tsconfig.server.json

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/.runtime ./.runtime
COPY --from=build /app/server.mjs ./server.mjs

EXPOSE 8080
CMD ["node", "server.mjs"]
