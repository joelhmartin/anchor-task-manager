FROM node:20-bullseye AS build

# Runtime libs required by `canvas` (used for DocAI PDF rasterization).
# Build tools required by `argon2` (native password hashing).
# Without these, installs may succeed but the container can crash at runtime with missing .so errors.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    poppler-utils \
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

# Runtime libs only — native modules (argon2, canvas) were compiled in the build stage.
# No python3/g++/make needed here; we copy pre-built node_modules from the build stage.
# Chromium runtime libraries required by @sparticuz/chromium (for report PDF generation).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    poppler-utils \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libgbm1 \
    libgtk-3-0 \
    libxss1 \
    libasound2 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
# Shared constants imported by server code (e.g. clientPresets for AI prompt derivation).
COPY --from=build /app/src/constants ./src/constants
COPY --from=build /app/.env.public ./.env.public
COPY --from=build /app/package.json ./package.json
# Maintenance scripts (contact/email/classification backfills, one-off migrations) —
# run as Cloud Run Jobs off this image. The runtime stage previously omitted scripts/,
# so `node scripts/backfill-contacts.js` failed with MODULE_NOT_FOUND in a Job.
COPY --from=build /app/scripts ./scripts

# Email assets (used by outbound Mailgun template)
RUN mkdir -p server/assets/email
COPY --from=build /app/src/assets/images/ANCHOR__CORPS.png ./server/assets/email/ANCHOR__CORPS.png

RUN mkdir -p uploads

EXPOSE 4001

CMD ["node", "server/index.js"]
