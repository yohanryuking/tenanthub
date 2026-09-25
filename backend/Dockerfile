# Single build stage carried into the runtime image on purpose: the
# container needs the Prisma CLI at boot anyway (to run `prisma migrate
# deploy` before the app starts), so there's nothing to gain from a
# separate slimmed-down runtime stage that would just reinstall it.
FROM node:22-alpine AS build

WORKDIR /app

# bcrypt ships prebuilt binaries for glibc, not musl, so alpine needs to
# compile it from source on install — hence these build tools instead of
# a slimmer base image.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# Applies any pending migrations (idempotent — no-ops if already up to
# date) before starting the app. See docs/deploy.md for what a first
# deploy still needs done manually (rotating the tenanthub_app password).
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
