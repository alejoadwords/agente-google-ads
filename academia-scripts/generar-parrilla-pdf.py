from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import Flowable

# ── Colores Acuarius ──────────────────────────────────────────────────────────
BLUE       = colors.HexColor('#1A2BCC')
BLUE_LIGHT = colors.HexColor('#EEF0FD')
BLUE_MID   = colors.HexColor('#3D52E5')
DARK       = colors.HexColor('#0D0F1C')
GRAY       = colors.HexColor('#6B7280')
GRAY_LIGHT = colors.HexColor('#F3F4F6')
GRAY_BORDER= colors.HexColor('#E5E7EB')
WHITE      = colors.white
RED        = colors.HexColor('#EF4444')
AMBER      = colors.HexColor('#F59E0B')
GREEN      = colors.HexColor('#22C55E')
PURPLE     = colors.HexColor('#7C3AED')
TEAL       = colors.HexColor('#0891B2')

W, H = A4
MARGIN = 18 * mm

# ── Estilos ───────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

def sty(name, **kw):
    return ParagraphStyle(name, **kw)

cover_title = sty('CoverTitle',
    fontName='Helvetica-Bold', fontSize=34, textColor=WHITE,
    leading=40, alignment=TA_LEFT)

cover_sub = sty('CoverSub',
    fontName='Helvetica', fontSize=13, textColor=colors.HexColor('#C7D2FE'),
    leading=20, alignment=TA_LEFT)

cover_label = sty('CoverLabel',
    fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#818CF8'),
    leading=12, alignment=TA_LEFT, spaceAfter=4)

section_title = sty('SectionTitle',
    fontName='Helvetica-Bold', fontSize=16, textColor=BLUE,
    leading=20, spaceBefore=6, spaceAfter=4)

section_sub = sty('SectionSub',
    fontName='Helvetica', fontSize=9, textColor=GRAY,
    leading=13, spaceAfter=10)

day_num = sty('DayNum',
    fontName='Helvetica-Bold', fontSize=9, textColor=BLUE,
    leading=11)

day_hook = sty('DayHook',
    fontName='Helvetica-Bold', fontSize=10.5, textColor=DARK,
    leading=14, spaceBefore=2, spaceAfter=3)

day_label = sty('DayLabel',
    fontName='Helvetica-Bold', fontSize=7.5, textColor=GRAY,
    leading=10)

day_body = sty('DayBody',
    fontName='Helvetica', fontSize=8.5, textColor=DARK,
    leading=12, spaceAfter=2)

day_demo = sty('DayDemo',
    fontName='Helvetica', fontSize=8, textColor=GRAY,
    leading=11, spaceAfter=0)

guide_title = sty('GuideTitle',
    fontName='Helvetica-Bold', fontSize=11, textColor=DARK,
    leading=14, spaceBefore=4, spaceAfter=3)

guide_body = sty('GuideBody',
    fontName='Helvetica', fontSize=8.5, textColor=DARK,
    leading=12, spaceAfter=2)

table_header = sty('TableHeader',
    fontName='Helvetica-Bold', fontSize=8, textColor=WHITE,
    leading=10, alignment=TA_CENTER)

table_cell = sty('TableCell',
    fontName='Helvetica', fontSize=8, textColor=DARK,
    leading=11, alignment=TA_LEFT)

footer_sty = sty('FooterSty',
    fontName='Helvetica', fontSize=7, textColor=GRAY,
    leading=9, alignment=TA_CENTER)

# ── Clase para línea horizontal con color ─────────────────────────────────────
class ColorLine(Flowable):
    def __init__(self, width, color, thickness=0.5):
        Flowable.__init__(self)
        self.width = width
        self.color = color
        self.thickness = thickness
        self.height = thickness + 2

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, 0, self.width, 0)

# ── Portada ───────────────────────────────────────────────────────────────────
class CoverPage(Flowable):
    def __init__(self, width, height):
        Flowable.__init__(self)
        self.width = width
        self.height = height

    def wrap(self, *args):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        w, h = self.width, self.height

        # Fondo azul degradado (simulado con rectángulos)
        c.setFillColor(BLUE)
        c.rect(0, 0, w, h, fill=1, stroke=0)

        # Acento decorativo — círculo grande
        c.setFillColor(BLUE_MID)
        c.circle(w * 0.85, h * 0.65, 120, fill=1, stroke=0)
        c.setFillColor(colors.HexColor('#1520B0'))
        c.circle(w * 0.85, h * 0.65, 90, fill=1, stroke=0)

        # Segundo círculo decorativo
        c.setFillColor(colors.HexColor('#2236D4'))
        c.circle(-30, 80, 110, fill=1, stroke=0)

        # Línea superior
        c.setStrokeColor(colors.HexColor('#818CF8'))
        c.setLineWidth(1)
        c.line(MARGIN, h - 22*mm, w - MARGIN, h - 22*mm)

        # ACUARIUS
        c.setFillColor(colors.HexColor('#818CF8'))
        c.setFont('Helvetica-Bold', 8)
        c.drawString(MARGIN, h - 18*mm, 'ACUARIUS · MARKETING CON IA')

        # Titulo principal
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 38)
        c.drawString(MARGIN, h * 0.62, 'Parrilla de')
        c.drawString(MARGIN, h * 0.62 - 45, 'Contenido')

        # Subtitulo azul claro
        c.setFillColor(colors.HexColor('#818CF8'))
        c.setFont('Helvetica-Bold', 38)
        c.drawString(MARGIN, h * 0.62 - 90, '30 DIAS')

        # Descripcion
        c.setFillColor(colors.HexColor('#C7D2FE'))
        c.setFont('Helvetica', 11)
        c.drawString(MARGIN, h * 0.62 - 125,
            'Estrategia viral para Facebook, Instagram,')
        c.drawString(MARGIN, h * 0.62 - 140,
            'TikTok, LinkedIn y YouTube')

        # Chips de plataformas
        platforms = ['Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'YouTube']
        x = MARGIN
        y = h * 0.62 - 185
        for p in platforms:
            c.setFillColor(colors.HexColor('#2236D4'))
            pw = c.stringWidth(p, 'Helvetica-Bold', 7.5) + 14
            c.roundRect(x, y - 3, pw, 15, 4, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 7.5)
            c.drawString(x + 7, y + 2, p)
            x += pw + 6

        # Linea divisoria
        c.setStrokeColor(colors.HexColor('#3D4FE0'))
        c.setLineWidth(0.8)
        c.line(MARGIN, h * 0.62 - 210, w - MARGIN, h * 0.62 - 210)

        # Stats
        stats = [('30', 'videos'), ('5', 'plataformas'), ('8', 'categorias')]
        sx = MARGIN
        sy = h * 0.62 - 245
        for val, lbl in stats:
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 22)
            c.drawString(sx, sy, val)
            c.setFillColor(colors.HexColor('#818CF8'))
            c.setFont('Helvetica', 8)
            c.drawString(sx, sy - 13, lbl)
            sx += 70

        # Footer de portada
        c.setFillColor(colors.HexColor('#3D4FE0'))
        c.rect(0, 0, w, 25*mm, fill=1, stroke=0)
        c.setFillColor(colors.HexColor('#818CF8'))
        c.setFont('Helvetica', 8)
        c.drawString(MARGIN, 10*mm, 'app.acuarius.app')
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 8)
        tagline = 'Emprendedores · Freelancers · PYMES · Agencias'
        c.drawRightString(w - MARGIN, 10*mm, tagline)

# ── Datos de la parrilla ──────────────────────────────────────────────────────
SEMANAS = [
    {
        'num': 1,
        'titulo': 'SEMANA 1',
        'subtitulo': '"¿Esto existe?" — Los mas sorprendentes',
        'objetivo': 'Objetivo: Que la gente no pueda creer que una herramienta hace esto. Maxima viralidad.',
        'color': BLUE,
        'dias': [
            {
                'n': 1,
                'hook': '"Le pregunte a una IA cuanto dinero estaba tirando en Google Ads... y me mostro exactamente esto"',
                'feature': 'Diagnostico de gasto desperdiciado con datos reales',
                'dolor': '"Tengo campanas activas pero no se que esta fallando"',
                'demo': 'Pantalla del agente respondiendo con nombres de campanas, cifras reales, terminos sin conversion',
            },
            {
                'n': 2,
                'hook': '"Conecte mi cuenta de Facebook Ads y el agente me dijo por que mi ROAS bajo — sin que yo le preguntara nada"',
                'feature': 'Analisis automatico Meta Ads con deteccion de fatiga creativa',
                'dolor': '"Mi ROAS bajo y no se por que"',
                'demo': 'Pantalla del agente detectando frecuencia alta y creative fatigue',
            },
            {
                'n': 3,
                'hook': '"Genere un mes completo de contenido para redes sociales en 41 minutos"',
                'feature': 'Studio de contenido + parrilla mensual con IA',
                'dolor': '"No tengo tiempo de crear contenido todos los dias"',
                'demo': 'Studio generando 20 ideas, copys y programacion en calendario',
            },
            {
                'n': 4,
                'hook': '"Le pegue la URL de mi sitio web a una IA y me audito el SEO completo en 30 segundos"',
                'feature': 'Analisis SEO con el agente',
                'dolor': '"No se si mi sitio web esta bien posicionado"',
                'demo': 'Agente SEO recibiendo URL y entregando auditoria con errores especificos',
            },
            {
                'n': 5,
                'hook': '"7 especialistas de marketing trabajando para tu negocio — al mismo tiempo — por menos de lo que vale un cafe al dia"',
                'feature': 'Los 7 agentes: Google Ads, Meta, TikTok, LinkedIn, SEO, Contenido, Consultor',
                'dolor': '"Contratar especialistas es muy caro"',
                'demo': 'Recorrido rapido por los 7 agentes mostrando cada uno en 5 segundos',
            },
            {
                'n': 6,
                'hook': '"Le dije al agente "analiza mis keywords" y ejecuto la consulta directo en la API de Google — sin que yo tocara nada"',
                'feature': 'GAQL queries automaticas en tiempo real',
                'dolor': '"Analizar keywords en Google Ads toma horas"',
                'demo': 'El agente generando y ejecutando la query, mostrando datos reales en segundos',
            },
            {
                'n': 7,
                'hook': '"Genere el reporte mensual de mi cliente para WhatsApp en 2 minutos — con metricas reales de sus campanas"',
                'feature': 'WAR (WhatsApp Automatic Report)',
                'dolor': '"Me toma horas armar reportes para clientes"',
                'demo': 'Flujo completo: seleccion de cliente, plataformas, KPIs, mensaje listo para pegar',
            },
        ]
    },
    {
        'num': 2,
        'titulo': 'SEMANA 2',
        'subtitulo': '"Me esta resolviendo este problema exacto"',
        'objetivo': 'Objetivo: Que cada persona que lo vea piense "esto es exactamente lo que me pasa a mi".',
        'color': PURPLE,
        'dias': [
            {
                'n': 8,
                'hook': '"¿Cuanto estas pagando de mas por cada clic en Google Ads? Esto encontre en mi cuenta"',
                'feature': 'Analisis de CPC y Quality Score',
                'dolor': 'Pagar mas de lo necesario por clics',
                'demo': 'Agente identificando keywords con Quality Score bajo y el sobrecosto real en dinero',
            },
            {
                'n': 9,
                'hook': '"Mi anuncio de Instagram llego 11 veces a las mismas personas. Asi lo detecte antes de seguir perdiendo plata"',
                'feature': 'Deteccion de frecuencia alta en Meta',
                'dolor': 'Presupuesto quemado en la misma audiencia',
                'demo': 'Dashboard Meta mostrando frecuencia + agente recomendando rotar creativos',
            },
            {
                'n': 10,
                'hook': '"Pegue la descripcion de mi negocio y el agente me dijo en que redes sociales debo estar — y en cuales no"',
                'feature': 'Consultor de Marketing — diagnostico de canales',
                'dolor': '"No se si debo estar en TikTok, LinkedIn o Instagram"',
                'demo': 'Agente consultor analizando el negocio y dando recomendacion con justificacion',
            },
            {
                'n': 11,
                'hook': '"Le subi una captura de mis campanas de Meta y el agente me dijo exactamente que cambiar"',
                'feature': 'Analisis de imagenes adjuntas al agente',
                'dolor': '"Tengo datos pero no se interpretarlos"',
                'demo': 'Usuario adjuntando screenshot de Ads Manager — agente analizando y dando 3 acciones',
            },
            {
                'n': 12,
                'hook': '"Estas palabras clave le estan robando tu presupuesto de Google Ads ahora mismo"',
                'feature': 'Analisis de terminos de busqueda + negativas',
                'dolor': 'Terminos irrelevantes activando anuncios',
                'demo': 'Agente mostrando terminos sin conversion con gasto real y generando lista de negativas',
            },
            {
                'n': 13,
                'hook': '"Pedi una estrategia de contenido para TikTok para mi negocio. Esto me dio en 20 segundos"',
                'feature': 'Agente TikTok Ads — estrategia y hooks',
                'dolor': '"No se que contenido funciona en TikTok para mi negocio"',
                'demo': 'Agente generando pilares de contenido, 5 hooks y guion completo de 60 segundos',
            },
            {
                'n': 14,
                'hook': '"Sin disenador, sin Canva, sin nada. Asi genere las imagenes para mis anuncios esta semana"',
                'feature': 'Generacion de imagenes con IA para redes',
                'dolor': '"No tengo disenador y Canva me toma mucho tiempo"',
                'demo': 'Prompt — imagen generada — imagen en el post lista para publicar',
            },
        ]
    },
    {
        'num': 3,
        'titulo': 'SEMANA 3',
        'subtitulo': '"Para alguien exactamente como tu"',
        'objetivo': 'Objetivo: Que cada tipo de usuario se identifique directamente con el video.',
        'color': GREEN,
        'dias': [
            {
                'n': 15,
                'hook': '"Asi gestiono 8 clientes de agencia desde un solo lugar — sin confundirme ni perder contexto de ninguno"',
                'feature': 'Panel de agencia — multiples clientes + contexto activo',
                'dolor': '"Manejo muchos clientes y pierdo el hilo de cada uno"',
                'demo': 'Cambiar entre clientes, ver perfiles, activar agente con contexto cargado automaticamente',
            },
            {
                'n': 16,
                'hook': '"Como freelancer de marketing, esto me ahorro 6 horas de trabajo esta semana"',
                'feature': 'Analisis completo + reporte en minutos vs. horas manual',
                'dolor': '"Cobro poco pero el tiempo de analisis me mata"',
                'demo': 'Comparacion: analisis manual vs. agente en 3 minutos',
            },
            {
                'n': 17,
                'hook': '"Tengo un negocio pequeno. No puedo pagar un especialista de marketing. Encontre esto"',
                'feature': 'Consultor + Google Ads + Meta para negocios pequenos',
                'dolor': '"El marketing digital es caro y complicado para pequenos negocios"',
                'demo': 'Emprendedor haciendo su primera consulta — agente explicando en lenguaje simple',
            },
            {
                'n': 18,
                'hook': '"Este sitio web perdio posiciones en Google el mes pasado. El agente encontro el problema en 40 segundos"',
                'feature': 'Diagnostico SEO tecnico + on-page',
                'dolor': '"Mi trafico organico bajo y no se por que"',
                'demo': 'Agente identificando el problema especifico: velocidad, indexacion o contenido',
            },
            {
                'n': 19,
                'hook': '"Mi anuncio de TikTok dejo de funcionar de un dia para otro. El agente me explico exactamente por que"',
                'feature': 'Analisis de campanas TikTok + fatiga de creativos',
                'dolor': '"TikTok Ads es impredecible"',
                'demo': 'Agente detectando el problema y recomendando acciones especificas',
            },
            {
                'n': 20,
                'hook': '"Escribir copys para redes me tomaba 3 horas. Ahora me toma 8 minutos. Te muestro como"',
                'feature': 'Generador de copys + variaciones de tono',
                'dolor': '"No se me ocurren cosas para publicar y cuando se me ocurren no se como escribirlas"',
                'demo': 'Generando 5 versiones de un mismo post en distintos tonos en tiempo real',
            },
            {
                'n': 21,
                'hook': '"Si haces B2B y no estas optimizando tus LinkedIn Ads con IA, estas dejando dinero sobre la mesa"',
                'feature': 'Agente LinkedIn Ads — analisis de campanas B2B',
                'dolor': '"LinkedIn Ads es caro y no se si esta funcionando bien"',
                'demo': 'Agente analizando campanas B2B, identificando segmentos de mayor rendimiento',
            },
        ]
    },
    {
        'num': 4,
        'titulo': 'SEMANA 4',
        'subtitulo': '"Miralo en accion completo"',
        'objetivo': 'Objetivo: Cerrar a los que llevan semanas viendo el contenido. Mostrar el flujo completo. Urgencia de registro.',
        'color': TEAL,
        'dias': [
            {
                'n': 22,
                'hook': '"De 0 a perfil de cliente completo en 60 segundos — pegue la web y Acuarius hizo el resto"',
                'feature': 'Autocomplete de perfil desde URL del sitio web',
                'dolor': '"Registrar clientes toma tiempo"',
                'demo': 'Ingresar URL — agente analiza — perfil completo de negocio generado automaticamente',
            },
            {
                'n': 23,
                'hook': '"Le pedi al agente un plan de optimizacion para los proximos 90 dias. Esto me entrego"',
                'feature': 'Roadmap de cuenta + plan de accion trimestral',
                'dolor': '"No se que hacer con mi cuenta mes a mes"',
                'demo': 'Agente entregando plan priorizado con acciones especificas por semana',
            },
            {
                'n': 24,
                'hook': '"Asi se ve tener un agente de Google Ads respondiendo en tiempo real con los datos de tu cuenta"',
                'feature': 'Flujo completo Google Ads — pregunta, GAQL, respuesta con datos reales',
                'dolor': 'General — mostrar el wow factor',
                'demo': 'Conversacion fluida de 5 turnos con analisis cada vez mas profundo',
            },
            {
                'n': 25,
                'hook': '"Publique directamente en Instagram y Facebook sin abrir ninguna app. Desde aqui"',
                'feature': 'Publicacion directa a redes desde el Studio',
                'dolor': '"Tengo que abrir mil apps para publicar"',
                'demo': 'Crear post — imagen con IA — programar — confirmacion de publicacion',
            },
            {
                'n': 26,
                'hook': '"3 errores que el 90% de los negocios comete en Google Ads — y como encontrarlos en menos de 5 minutos"',
                'feature': 'Analisis de cuenta completo — top 3 errores comunes',
                'dolor': 'Errores comunes que cuestan dinero',
                'demo': 'Agente identificando los 3 errores en una cuenta real con solucion para cada uno',
            },
            {
                'n': 27,
                'hook': '"¿Cuanto deberia gastar en publicidad este mes? Le pregunte al agente y esto me respondio"',
                'feature': 'Consultor de Marketing — recomendacion de presupuesto',
                'dolor': '"No se cuanto invertir en pauta digital"',
                'demo': 'Consultor analizando el negocio y entregando recomendacion por plataforma',
            },
            {
                'n': 28,
                'hook': '"Mi cliente me pregunto como van sus campanas. Le mande esto por WhatsApp en 2 minutos"',
                'feature': 'WAR completo — flujo de principio a fin',
                'dolor': '"Mis clientes me preguntan como van y no tengo un reporte listo"',
                'demo': 'Flujo completo WAR con metricas reales — mensaje formateado — copiar y enviar',
            },
            {
                'n': 29,
                'hook': '"¿Que pasaria si tuvieras un experto en cada plataforma disponible a las 2am cuando se te ocurre la idea?"',
                'feature': 'Disponibilidad 24/7 de todos los agentes',
                'dolor': '"Los especialistas tienen horario, yo trabajo cuando puedo"',
                'demo': 'Conversacion de analisis en horario nocturno — mostrar el timestamp',
            },
            {
                'n': 30,
                'hook': '"30 dias usando Acuarius. Esto cambio en mi negocio"',
                'feature': 'Recap + CTA de registro',
                'dolor': 'General — cierre del mes con llamado a la accion',
                'demo': 'Montaje rapido de los mejores momentos + link de registro',
            },
        ]
    },
]

# ── Generador de card de dia ──────────────────────────────────────────────────
def make_day_card(dia, sem_color):
    n = dia['n']
    hook = dia['hook']
    feature = dia['feature']
    dolor = dia['dolor']
    demo = dia['demo']

    col_w = (W - 2 * MARGIN - 8*mm) / 2

    # Numero de dia
    p_num = Paragraph(f'DIA {n}', day_num)
    p_hook = Paragraph(hook, day_hook)

    p_feat_lbl = Paragraph('FUNCION:', day_label)
    p_feat = Paragraph(feature, day_body)

    p_dolor_lbl = Paragraph('DOLOR QUE RESUELVE:', day_label)
    p_dolor = Paragraph(dolor, day_body)

    p_demo_lbl = Paragraph('DEMO EN PANTALLA:', day_label)
    p_demo = Paragraph(demo, day_demo)

    inner = [
        [p_num, ''],
        [p_hook, ''],
        [p_feat_lbl, p_dolor_lbl],
        [p_feat, p_dolor],
        [p_demo_lbl, ''],
        [p_demo, ''],
    ]

    t = Table(inner, colWidths=[col_w, col_w])
    t.setStyle(TableStyle([
        ('SPAN', (0, 0), (1, 0)),
        ('SPAN', (0, 1), (1, 1)),
        ('SPAN', (0, 4), (1, 4)),
        ('SPAN', (0, 5), (1, 5)),
        ('BACKGROUND', (0, 0), (1, 0), BLUE_LIGHT),
        ('TOPPADDING', (0, 0), (-1, 0), 6),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 3),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 1), (-1, -1), 4),
        ('BOTTOMPADDING', (0, -1), (-1, -1), 8),
        ('ROWBACKGROUNDS', (0, 2), (-1, 5), [WHITE, WHITE, GRAY_LIGHT, GRAY_LIGHT]),
        ('LINEABOVE', (0, 0), (-1, 0), 2.5, sem_color),
        ('LINEBELOW', (0, -1), (-1, -1), 0.3, GRAY_BORDER),
        ('LINEBEFORE', (0, 0), (0, -1), 0.3, GRAY_BORDER),
        ('LINEAFTER', (-1, 0), (-1, -1), 0.3, GRAY_BORDER),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 0), (-1, 0), [BLUE_LIGHT]),
    ]))

    return KeepTogether([t, Spacer(1, 6)])


# ── Tabla de horarios por plataforma ─────────────────────────────────────────
def make_platform_table():
    headers = ['Plataforma', 'Frecuencia', 'Formato', 'Mejor horario (LatAm)', 'Duracion']
    data = [
        [Paragraph(h, table_header) for h in headers],
        [Paragraph('TikTok', table_cell),
         Paragraph('1-2 videos/dia', table_cell),
         Paragraph('9:16 vertical', table_cell),
         Paragraph('7pm - 9pm', table_cell),
         Paragraph('30-60 seg', table_cell)],
        [Paragraph('Instagram Reels', table_cell),
         Paragraph('1 Reel/dia', table_cell),
         Paragraph('9:16 vertical', table_cell),
         Paragraph('7pm - 9pm', table_cell),
         Paragraph('30-60 seg', table_cell)],
        [Paragraph('Instagram Stories', table_cell),
         Paragraph('3-5/dia', table_cell),
         Paragraph('9:16 vertical', table_cell),
         Paragraph('Cualquier hora', table_cell),
         Paragraph('15 seg', table_cell)],
        [Paragraph('LinkedIn', table_cell),
         Paragraph('1 post/dia (lun-vie)', table_cell),
         Paragraph('1:1 o 9:16', table_cell),
         Paragraph('8am-9am | 12pm-1pm', table_cell),
         Paragraph('30-45 seg', table_cell)],
        [Paragraph('YouTube Shorts', table_cell),
         Paragraph('3-4/semana', table_cell),
         Paragraph('9:16 vertical', table_cell),
         Paragraph('2pm - 4pm', table_cell),
         Paragraph('< 60 seg', table_cell)],
        [Paragraph('Facebook', table_cell),
         Paragraph('Auto desde Instagram', table_cell),
         Paragraph('9:16 vertical', table_cell),
         Paragraph('Sincronizacion automatica', table_cell),
         Paragraph('30-60 seg', table_cell)],
    ]

    col_widths = [90, 95, 75, 110, 65]
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), BLUE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, GRAY_LIGHT]),
        ('GRID', (0, 0), (-1, -1), 0.3, GRAY_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
    ]))
    return t


# ── Estructura del video ──────────────────────────────────────────────────────
def make_video_structure():
    headers = ['Segmento', 'Tiempo', 'Objetivo', 'Ejemplo']
    data = [
        [Paragraph(h, table_header) for h in headers],
        [Paragraph('HOOK', ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=8, textColor=RED)),
         Paragraph('0 - 3 seg', table_cell),
         Paragraph('Detener el scroll. Sorprender o generar pregunta inmediata.', table_cell),
         Paragraph('"Le pregunte a una IA cuanto dinero estaba botando..."', table_cell)],
        [Paragraph('PROBLEMA', ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=8, textColor=AMBER)),
         Paragraph('3 - 10 seg', table_cell),
         Paragraph('Conectar con el dolor del espectador.', table_cell),
         Paragraph('"Llevaba meses sin saber por que mi ROAS bajaba."', table_cell)],
        [Paragraph('DEMO', ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=8, textColor=BLUE)),
         Paragraph('10 - 45 seg', table_cell),
         Paragraph('Mostrar la solucion en pantalla. Real, sin cortes largos.', table_cell),
         Paragraph('Pantalla de Acuarius con datos reales del agente.', table_cell)],
        [Paragraph('CTA', ParagraphStyle('h', fontName='Helvetica-Bold', fontSize=8, textColor=GREEN)),
         Paragraph('45 - 60 seg', table_cell),
         Paragraph('Llamado a la accion claro y unico.', table_cell),
         Paragraph('"Pruebalo gratis en app.acuarius.app"', table_cell)],
    ]
    col_widths = [70, 55, 155, 155]
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), DARK),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, GRAY_LIGHT]),
        ('GRID', (0, 0), (-1, -1), 0.3, GRAY_BORDER),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    return t


# ── Footer ────────────────────────────────────────────────────────────────────
def draw_cover(canvas, doc):
    canvas.saveState()
    c = canvas
    w, h = W, H
    c.setFillColor(BLUE)
    c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(BLUE_MID)
    c.circle(w * 0.85, h * 0.65, 120, fill=1, stroke=0)
    c.setFillColor(colors.HexColor('#1520B0'))
    c.circle(w * 0.85, h * 0.65, 90, fill=1, stroke=0)
    c.setFillColor(colors.HexColor('#2236D4'))
    c.circle(-30, 80, 110, fill=1, stroke=0)
    c.setStrokeColor(colors.HexColor('#818CF8'))
    c.setLineWidth(1)
    c.line(MARGIN, h - 22*mm, w - MARGIN, h - 22*mm)
    c.setFillColor(colors.HexColor('#818CF8'))
    c.setFont('Helvetica-Bold', 8)
    c.drawString(MARGIN, h - 18*mm, 'ACUARIUS · MARKETING CON IA')
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 38)
    c.drawString(MARGIN, h * 0.62, 'Parrilla de')
    c.drawString(MARGIN, h * 0.62 - 45, 'Contenido')
    c.setFillColor(colors.HexColor('#818CF8'))
    c.setFont('Helvetica-Bold', 38)
    c.drawString(MARGIN, h * 0.62 - 90, '30 DIAS')
    c.setFillColor(colors.HexColor('#C7D2FE'))
    c.setFont('Helvetica', 11)
    c.drawString(MARGIN, h * 0.62 - 125, 'Estrategia viral para Facebook, Instagram,')
    c.drawString(MARGIN, h * 0.62 - 140, 'TikTok, LinkedIn y YouTube')
    platforms = ['Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'YouTube']
    x = MARGIN
    y = h * 0.62 - 185
    for p in platforms:
        c.setFillColor(colors.HexColor('#2236D4'))
        pw = c.stringWidth(p, 'Helvetica-Bold', 7.5) + 14
        c.roundRect(x, y - 3, pw, 15, 4, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 7.5)
        c.drawString(x + 7, y + 2, p)
        x += pw + 6
    c.setStrokeColor(colors.HexColor('#3D4FE0'))
    c.setLineWidth(0.8)
    c.line(MARGIN, h * 0.62 - 210, w - MARGIN, h * 0.62 - 210)
    stats = [('30', 'videos'), ('5', 'plataformas'), ('8', 'categorias')]
    sx = MARGIN
    sy = h * 0.62 - 245
    for val, lbl in stats:
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 22)
        c.drawString(sx, sy, val)
        c.setFillColor(colors.HexColor('#818CF8'))
        c.setFont('Helvetica', 8)
        c.drawString(sx, sy - 13, lbl)
        sx += 70
    c.setFillColor(colors.HexColor('#3D4FE0'))
    c.rect(0, 0, w, 25*mm, fill=1, stroke=0)
    c.setFillColor(colors.HexColor('#818CF8'))
    c.setFont('Helvetica', 8)
    c.drawString(MARGIN, 10*mm, 'app.acuarius.app')
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 8)
    c.drawRightString(w - MARGIN, 10*mm, 'Emprendedores · Freelancers · PYMES · Agencias')
    canvas.restoreState()

def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(GRAY)
    canvas.setFont('Helvetica', 7)
    canvas.drawString(MARGIN, 12*mm, 'Acuarius — Parrilla de Contenido 30 Dias')
    canvas.drawRightString(W - MARGIN, 12*mm, f'Pagina {doc.page}')
    canvas.setStrokeColor(GRAY_BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 15*mm, W - MARGIN, 15*mm)
    canvas.restoreState()


# ── CONSTRUIR EL DOCUMENTO ────────────────────────────────────────────────────
OUTPUT = '/Users/mac/Documents/Claude/Acuarius/academia-scripts/Parrilla-30-Dias-Acuarius.pdf'

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=MARGIN,
    rightMargin=MARGIN,
    topMargin=MARGIN,
    bottomMargin=22*mm,
)

story = []

# ── PORTADA ───────────────────────────────────────────────────────────────────
# Cover is drawn via onFirstPage callback
story.append(Spacer(1, 1))  # minimal spacer - cover drawn by canvas callback
story.append(PageBreak())

# ── PAGINA DE INTRODUCCION ────────────────────────────────────────────────────
story.append(Spacer(1, 8))
story.append(Paragraph('COMO USAR ESTA PARRILLA', cover_label))
story.append(ColorLine(W - 2*MARGIN, BLUE, 2))
story.append(Spacer(1, 10))

story.append(Paragraph(
    'Esta parrilla esta disenada para publicar <b>1 video al dia durante 30 dias</b> en todas '
    'las plataformas simultaneamente. El mismo video adaptado a cada formato. El objetivo es '
    '<b>viralidad por utilidad</b> — mostrar funciones de Acuarius que resuelven problemas '
    'reales de emprendedores, freelancers, PYMES y agencias.',
    ParagraphStyle('intro', fontName='Helvetica', fontSize=10, textColor=DARK,
                   leading=16, spaceAfter=14)
))

story.append(Paragraph('ESTRUCTURA DE CADA VIDEO', guide_title))
story.append(make_video_structure())
story.append(Spacer(1, 14))

story.append(Paragraph('PLATAFORMAS Y FRECUENCIA', guide_title))
story.append(make_platform_table())
story.append(Spacer(1, 14))

# Regla de oro
story.append(Table(
    [[Paragraph(
        '<b>Regla de oro:</b> No publiques mas hasta que tengas el proceso de las 2 piezas '
        'diarias dominado. Consistencia por 30 dias con 2 piezas diarias supera a 5 piezas '
        'diarias durante 2 semanas seguido de silencio. El algoritmo castiga la inconsistencia '
        'mas que la baja frecuencia.',
        ParagraphStyle('rule', fontName='Helvetica', fontSize=9, textColor=DARK,
                       leading=14, leftIndent=4)
    )]],
    colWidths=[W - 2*MARGIN],
    style=TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BLUE_LIGHT),
        ('LINEABOVE', (0, 0), (-1, 0), 3, BLUE),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ])
))

story.append(PageBreak())

# ── SEMANAS ───────────────────────────────────────────────────────────────────
for sem in SEMANAS:
    color = sem['color']

    # Header de semana
    sem_header = Table(
        [[
            Paragraph(sem['titulo'], ParagraphStyle(
                'SH', fontName='Helvetica-Bold', fontSize=18,
                textColor=WHITE, leading=22)),
            Paragraph(sem['subtitulo'], ParagraphStyle(
                'SS', fontName='Helvetica-Bold', fontSize=10,
                textColor=colors.HexColor('#E0E7FF'), leading=13, alignment=TA_RIGHT)),
        ]],
        colWidths=[(W - 2*MARGIN)*0.45, (W - 2*MARGIN)*0.55],
        style=TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), color),
            ('TOPPADDING', (0, 0), (-1, -1), 12),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
            ('LEFTPADDING', (0, 0), (-1, -1), 14),
            ('RIGHTPADDING', (0, 0), (-1, -1), 14),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ])
    )
    story.append(sem_header)
    story.append(Spacer(1, 4))
    story.append(Paragraph(sem['objetivo'],
        ParagraphStyle('obj', fontName='Helvetica', fontSize=8.5,
                       textColor=GRAY, leading=12, spaceAfter=8, leftIndent=2)
    ))

    for dia in sem['dias']:
        story.append(make_day_card(dia, color))

    story.append(PageBreak())

# ── PAGINA FINAL ──────────────────────────────────────────────────────────────
story.append(Spacer(1, 20))
story.append(Paragraph('PROXIMOS PASOS', cover_label))
story.append(ColorLine(W - 2*MARGIN, BLUE, 2))
story.append(Spacer(1, 12))

pasos = [
    ('1', 'Descarga Loom o usa QuickTime para grabar tu pantalla mientras usas Acuarius.'),
    ('2', 'Graba el hook de camara (primeros 3 segundos) con tu celular en vertical.'),
    ('3', 'Combina la grabacion de pantalla con el hook en CapCut o DaVinci Resolve.'),
    ('4', 'Agrega subtitulos quemados — el 85% del contenido se consume sin sonido.'),
    ('5', 'Publica en TikTok primero, luego reutiliza en Instagram, LinkedIn y YouTube.'),
    ('6', 'Monitorea los primeros 30 minutos de cada video — el algoritmo decide en ese tiempo.'),
    ('7', 'El video que mas engage tenga en la semana 1, hazle parte 2 la semana siguiente.'),
]

for num, texto in pasos:
    row = Table(
        [[
            Paragraph(num, ParagraphStyle('n', fontName='Helvetica-Bold', fontSize=14,
                                           textColor=WHITE, alignment=TA_CENTER, leading=16)),
            Paragraph(texto, ParagraphStyle('t', fontName='Helvetica', fontSize=9.5,
                                             textColor=DARK, leading=14))
        ]],
        colWidths=[28, W - 2*MARGIN - 42],
        style=TableStyle([
            ('BACKGROUND', (0, 0), (0, 0), BLUE),
            ('TOPPADDING', (0, 0), (-1, -1), 7),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LINEBELOW', (0, 0), (-1, -1), 0.3, GRAY_BORDER),
        ])
    )
    story.append(row)
    story.append(Spacer(1, 3))

story.append(Spacer(1, 20))

# CTA final
story.append(Table(
    [[Paragraph(
        'Registrate gratis en <b>app.acuarius.app</b> y empieza hoy con tus primeros videos.',
        ParagraphStyle('cta', fontName='Helvetica-Bold', fontSize=12,
                       textColor=WHITE, leading=18, alignment=TA_CENTER)
    )]],
    colWidths=[W - 2*MARGIN],
    style=TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), BLUE),
        ('TOPPADDING', (0, 0), (-1, -1), 18),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 18),
        ('LEFTPADDING', (0, 0), (-1, -1), 20),
        ('RIGHTPADDING', (0, 0), (-1, -1), 20),
    ])
))

# ── BUILD ─────────────────────────────────────────────────────────────────────
doc.build(story, onFirstPage=draw_cover, onLaterPages=add_footer)
print(f'PDF generado: {OUTPUT}')
