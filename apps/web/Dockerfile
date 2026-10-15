FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages ./packages
COPY apps/web ./apps/web

RUN npm install
RUN npm run build --workspace=@zhanshuang/shared
RUN npm run build --workspace=@zhanshuang/game-rules
RUN npm run build --workspace=@zhanshuang/web

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace=@zhanshuang/web"]
