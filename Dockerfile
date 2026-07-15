FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --production
COPY . .
ENV PORT=3100
EXPOSE 3100
CMD ["node", "index.js"]
