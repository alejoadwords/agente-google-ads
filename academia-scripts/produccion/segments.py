import subprocess, json
SEGS = [
("g1", "Esta es una de las funciones más potentes de Acuárius: el agente de Google Ads no solo analiza — también crea campañas reales en tu cuenta, contigo al mando en todo momento. Vamos a crear una juntos, de principio a fin."),
("g2", "Empieza diciéndole qué quieres lograr, con la información que ya tengas: el servicio que quieres promocionar, el presupuesto diario, la ciudad. Si algo falta, el agente te lo pregunta; y el perfil de tu negocio ya le dio el resto del contexto."),
("g3", "Mientras arma el plan, está haciendo el trabajo de un especialista: elegir la estructura de campaña, redactar palabras clave con su tipo de concordancia, escribir los títulos y descripciones del anuncio, y decidir la estrategia de puja según el historial de la cuenta."),
("g4", "Y aquí está lo importante: antes de tocar tu cuenta aparece el panel de revisión, con todo lo que se va a crear. El nombre de la campaña, el presupuesto diario, el país, la estrategia de puja, y dentro de cada grupo sus palabras clave, la URL de destino, los títulos y las descripciones."),
("g5", "Todo el panel es editable. Puedes cambiar cualquier título, quitar una palabra clave que no te convenza, ajustar el presupuesto o corregir la URL, ahí mismo, sin volver al chat. Y si prefieres pedirle un cambio al agente, se lo dices y vuelve a armar el plan."),
("g6", "Cuando estés conforme, pulsas crear en Google Ads. Fíjate en el propio botón: dice en pausa. Toda campaña creada desde Acuárius nace pausada, sin excepción. Nunca se activa sola, nunca gasta un peso sin tu autorización expresa."),
("g7", "Listo: la campaña está creada en la cuenta real, con sus grupos, sus palabras clave y su anuncio. Desde aquí puedes abrirla en Google Ads para revisarla con calma, o activarla cuando lo decidas — y ahí sí te pide confirmación, porque a partir de ese momento empieza a gastar."),
("g8", "¿Por qué trabajar así en lugar de armarla a mano? Por velocidad: lo que toma una hora en el editor de Google, aquí son cinco minutos. Por calidad: el agente aplica las buenas prácticas actuales y respeta los límites de caracteres. Y por contexto: usa el perfil de tu cliente para escribir anuncios que suenan al negocio, no a plantilla. Mi consejo: empieza con una campaña sencilla de búsqueda para un solo servicio. Cuando veas el flujo completo, vas a montar estructuras más ambiciosas con total confianza."),
]
durs = {}
for name, text in SEGS:
    out = f"audio/{name}.mp3"
    subprocess.run(["python3","-m","edge_tts","--voice","es-MX-JorgeNeural","--text",text,"--write-media",out], check=True, capture_output=True)
    durs[name] = round(float(subprocess.run(["ffprobe","-v","quiet","-show_entries","format=duration","-of","csv=p=0",out],capture_output=True,text=True).stdout.strip()),2)
json.dump(durs, open("audio/durations.json","w"))
print(json.dumps(durs), "total:", round(sum(durs.values()),1))
