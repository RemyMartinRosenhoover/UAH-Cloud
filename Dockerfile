FROM node:26.10.0-alpine3.24

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
