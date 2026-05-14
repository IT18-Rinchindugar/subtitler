FROM node:20-slim

RUN apt-get update && apt-get install -y openssl ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock* package-lock.json* ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
