# El worker del agente de voz. Se despliega en Fly.io (fly.toml), no en Vercel.
FROM node:22-slim
# Los certificados raíz del sistema. La imagen slim no los trae y el conector
# de audio de LiveKit (escrito en Rust) los necesita para abrir la conexión
# segura con la sala: sin ellos falla con «no native root CA certificates
# found» y el agente nunca entra a la llamada (pasó en la primera prueba).
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
# Los modelos del detector de turnos y del VAD se bajan al construir la
# imagen: si se bajaran al arrancar, la primera llamada esperaría la descarga.
RUN node agente.js download-files
CMD ["node", "agente.js", "start"]
