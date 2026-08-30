FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
ENV NODE_ENV=production
EXPOSE 9000
CMD ["node", "dist/index.js"]
