FROM node:20-alpine
WORKDIR /app
# The lockfile pins every transitive dependency; `npm ci` fails if it drifts from package.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE 3000
# /api/health is public and does not touch the database. Plain node so the image
# needs no curl/wget. start-period covers the migration + DB connection retries.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
