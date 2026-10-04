# El worker del agente de voz. Se despliega en Fly.io (fly.toml), no en Vercel.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
# Los modelos del detector de turnos y del VAD se bajan al construir la
# imagen: si se bajaran al arrancar, la primera llamada esperaría la descarga.
RUN node agente.js download-files
CMD ["node", "agente.js", "start"]
