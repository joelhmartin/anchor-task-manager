FROM node:20-bullseye AS build

# Build tools required by `argon2` (native password hashing).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    g++ \
    make \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock .yarnrc.yml ./

RUN corepack enable \
  && yarn install --immutable

COPY . .

RUN yarn build

FROM node:20-bullseye-slim AS production

WORKDIR /app

ENV NODE_ENV=production

# Pre-built node_modules (incl. compiled argon2) and built SPA come from the build stage.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/.env.public ./.env.public
COPY --from=build /app/package.json ./package.json

# Email logo used by the Mailgun template.
RUN mkdir -p server/assets/email
COPY --from=build /app/src/assets/images/ANCHOR__CORPS.png ./server/assets/email/ANCHOR__CORPS.png

# Task file attachments are written here at runtime (ephemeral on Cloud Run).
RUN mkdir -p uploads/tasks

# Cloud Run injects PORT (8080); the server honours it.
EXPOSE 8080

CMD ["node", "server/index.js"]
