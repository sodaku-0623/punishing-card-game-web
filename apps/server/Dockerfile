FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY apps/server ./apps/server

RUN npm install
RUN npm run build --workspace=@zhanshuang/shared
RUN npm run build --workspace=@zhanshuang/game-rules
RUN npm run build --workspace=@zhanshuang/game-engine
RUN npm run build --workspace=@zhanshuang/database
RUN npm run build --workspace=@zhanshuang/server

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/server ./apps/server
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4000

CMD ["node", "apps/server/dist/index.js"]
