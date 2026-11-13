# Game + multiplayer relay in one small container (no npm packages needed)
FROM node:22-alpine
WORKDIR /app
COPY index.html game.bundle.js ./
COPY server ./server
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["node", "server/server.mjs"]
