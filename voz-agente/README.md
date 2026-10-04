# Worker del agente de voz

Contesta las llamadas del módulo «Agente de voz» de Acuarius. Corre en
**Fly.io**, no en Vercel: una llamada dura minutos y las funciones de Vercel se
cortan mucho antes. Todo lo que es del negocio (instrucciones, herramientas,
cobro) lo resuelve `api/agente-voz.js`; aquí solo está el audio.

```
número colombiano (Telnyx) → SIP → LiveKit → este worker → /api/agente-voz
                                              oído: Deepgram nova-3 (es)
                                              turnos: VAD Silero + detector local
                                              cerebro: Claude Haiku 4.5
                                              voz: Cartesia sonic-3 (es)
```

## Cuentas que hacen falta

| Servicio | Para qué | Variable |
|---|---|---|
| LiveKit Cloud (plan Ship) | salas, SIP y reparto de llamadas | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| Deepgram | voz a texto | `DEEPGRAM_API_KEY` |
| Cartesia | texto a voz; elegir una voz latina | `CARTESIA_API_KEY`, `VOZ_CARTESIA_DEFECTO` |
| Anthropic | el cerebro (ya la tenemos) | `ANTHROPIC_API_KEY` |
| Telnyx | número colombiano + SIP hacia LiveKit | (se configura en Telnyx y LiveKit) |
| — | el worker se identifica ante Acuarius | `AGENTE_VOZ_SECRETO` (el mismo en Vercel y en Fly) |

En **Vercel** van `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (para
el botón «Hablar con mi agente») y `AGENTE_VOZ_SECRETO`. La beta se abre por
cuenta con `AGENTE_VOZ_BETA` (ids de Clerk separados por coma).

## Probar en local

```bash
cd voz-agente && npm install
node agente.js download-files     # modelos del VAD y del detector de turnos
node agente.js dev                # se registra en LiveKit Cloud como «acuarius-voz»
```

Con el worker corriendo, el botón «Hablar con mi agente» del módulo abre una
sala de prueba y LiveKit le manda la llamada a este worker.

## Desplegar

```bash
fly launch --no-deploy --copy-config
fly secrets set LIVEKIT_URL=… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=… DEEPGRAM_API_KEY=… \
  CARTESIA_API_KEY=… ANTHROPIC_API_KEY=… AGENTE_VOZ_SECRETO=… VOZ_CARTESIA_DEFECTO=…
fly deploy
```

## Llamadas de teléfono (después de las pruebas web)

1. En Telnyx: número de Bogotá + conexión SIP (FQDN) apuntando al SIP URI de LiveKit.
2. En LiveKit: trunk de entrada con ese número y regla de despacho a `acuarius-voz`.
3. En Acuarius: el número en `agentes_voz.numero` (dígitos, con 57) del agente que debe contestar.

Pruebas sin red: `node pruebas/agente-voz.mjs` (desde la raíz del repo).
