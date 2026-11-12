FROM node:24.22.2-bookworm-slim AS toolchain
WORKDIR /app
RUN npm install --global npm@11.12.1

FROM toolchain AS build
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM toolchain AS production-dependencies
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM toolchain AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./package.json
RUN mkdir -p /app/uploads/products && chown -R node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
