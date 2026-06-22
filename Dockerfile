FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY utils ./utils
COPY data ./data
COPY certs ./certs

RUN mkdir -p /app/data /app/certs

EXPOSE 3002 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.HTTP_PORT||3002; fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
