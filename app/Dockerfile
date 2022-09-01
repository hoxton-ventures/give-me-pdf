FROM node:18-alpine

RUN npm install pm2 -g

ENV PORT="3000"

RUN mkdir -p /app /app/bin /app/routes /app/views /app/public /app/controllers /app/utils /PDF

COPY bin/ /app/bin/
COPY public/ /app/public/
COPY routes/ /app/routes/
COPY controllers/ /app/controllers/
COPY views/ /app/views/
COPY utils/ /app/utils/
COPY app.js package.json ecosystem.config.js config.js /app/

WORKDIR /app
RUN npm i --unsafe-perm --omit=dev

EXPOSE 3000 
CMD [ "pm2-runtime", "start", "ecosystem.config.js"]

HEALTHCHECK  --interval=30s --timeout=3s \
  CMD wget --quiet --tries=1 --spider http://docsend-app:3000/ || exit 1