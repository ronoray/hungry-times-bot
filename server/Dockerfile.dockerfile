FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm ci --only=production

COPY server/ ./

CMD ["npm", "start"]