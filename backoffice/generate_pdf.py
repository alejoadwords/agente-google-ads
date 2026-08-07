"""
Generate pack-videos-acuarius.pdf — Pack de Videos Acuarius
Professional PDF deliverable for Hotmart product.
"""

import os
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import mm, cm
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable, KeepTogether
)
from reportlab.pdfgen import canvas
from reportlab.platypus.flowables import Flowable

# ── Brand colors ──────────────────────────────────────────────────────────────
PURPLE      = colors.HexColor('#7C3AED')
LIGHT_PURPLE= colors.HexColor('#EDE9FE')
DARK        = colors.HexColor('#1E1B4B')
WHITE       = colors.white
GRAY        = colors.HexColor('#6B7280')
DARK_TEXT   = colors.HexColor('#111827')

A4_W, A4_H = A4  # 595.27 x 841.89 pt

OUT_PATH = '/Users/mac/Documents/Claude/Acuarius/backoffice/pack-videos-acuarius.pdf'

# ── Custom flowable: rounded rectangle box ────────────────────────────────────
class RoundedBox(Flowable):
    """A light-purple rounded rectangle containing a title and body text."""

    def __init__(self, title, body, width, bg_color=None, radius=8):
        super().__init__()
        self.title = title
        self.body = body
        self.box_width = width
        self.bg_color = bg_color or LIGHT_PURPLE
        self.radius = radius
        # We'll measure height at draw time via wrap
        self._height = None

    def wrap(self, availWidth, availHeight):
        self._height = 90
        return (self.box_width, self._height)

    def draw(self):
        c = self.canv
        w = self.box_width
        h = self._height
        r = self.radius

        # Background rounded rect
        c.setFillColor(self.bg_color)
        c.setStrokeColor(self.bg_color)
        c.roundRect(0, 0, w, h, r, fill=1, stroke=0)

        # Title
        c.setFillColor(DARK)
        c.setFont('Helvetica-Bold', 11)
        c.drawString(16, h - 26, self.title)

        # Body — simple word wrap
        c.setFont('Helvetica', 9)
        c.setFillColor(colors.HexColor('#374151'))
        max_w = w - 32
        words = self.body.split()
        lines = []
        current = ''
        for word in words:
            test = (current + ' ' + word).strip()
            if c.stringWidth(test, 'Helvetica', 9) <= max_w:
                current = test
            else:
                if current:
                    lines.append(current)
                current = word
        if current:
            lines.append(current)

        y = h - 44
        for line in lines:
            if y < 8:
                break
            c.drawString(16, y, line)
            y -= 13


# ── Custom flowable: purple section header bar ────────────────────────────────
class HeaderBar(Flowable):
    def __init__(self, text, width, height=36, font_size=16):
        super().__init__()
        self.text = text
        self.bar_width = width
        self.bar_height = height
        self.font_size = font_size

    def wrap(self, availWidth, availHeight):
        return (self.bar_width, self.bar_height)

    def draw(self):
        c = self.canv
        c.setFillColor(PURPLE)
        c.rect(0, 0, self.bar_width, self.bar_height, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', self.font_size)
        c.drawString(20, 10, self.text)


# ── Styles ────────────────────────────────────────────────────────────────────
def make_styles():
    normal = ParagraphStyle(
        'Body',
        fontName='Helvetica',
        fontSize=10,
        leading=15,
        textColor=DARK_TEXT,
        spaceAfter=6,
    )
    h2 = ParagraphStyle(
        'H2',
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=18,
        textColor=DARK,
        spaceBefore=14,
        spaceAfter=6,
    )
    tip_title = ParagraphStyle(
        'TipTitle',
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=DARK,
        spaceBefore=10,
        spaceAfter=3,
    )
    tip_body = ParagraphStyle(
        'TipBody',
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#374151'),
        leftIndent=14,
        spaceAfter=8,
    )
    gray_small = ParagraphStyle(
        'GraySmall',
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=GRAY,
    )
    footer = ParagraphStyle(
        'Footer',
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=GRAY,
        alignment=TA_CENTER,
    )
    support_title = ParagraphStyle(
        'SupportTitle',
        fontName='Helvetica-Bold',
        fontSize=12,
        leading=16,
        textColor=DARK,
        spaceBefore=4,
        spaceAfter=4,
    )
    support_body = ParagraphStyle(
        'SupportBody',
        fontName='Helvetica',
        fontSize=10,
        leading=14,
        textColor=colors.HexColor('#374151'),
    )
    return normal, h2, tip_title, tip_body, gray_small, footer, support_title, support_body


# ── PAGE 1: Cover (canvas) ────────────────────────────────────────────────────
def draw_cover(c, doc):
    w, h = A4

    # Full purple background
    c.setFillColor(PURPLE)
    c.rect(0, 0, w, h, fill=1, stroke=0)

    # ── Logo area (top-left) ──────────────────────────────────────────────────
    logo_x, logo_y = 52, h - 80

    # Small white circle accent
    c.setFillColor(colors.HexColor('#A78BFA'))
    c.circle(logo_x - 4, logo_y + 8, 18, fill=1, stroke=0)

    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 30)
    c.drawString(logo_x, logo_y, 'Acuarius')

    c.setFont('Helvetica', 11)
    c.setFillColor(colors.HexColor('#C4B5FD'))
    c.drawString(logo_x, logo_y - 20, 'Marketing con IA para LatAm')

    # ── Divider line ─────────────────────────────────────────────────────────
    c.setStrokeColor(colors.HexColor('#A78BFA'))
    c.setLineWidth(1)
    c.line(52, h - 130, w - 52, h - 130)

    # ── Main headline ─────────────────────────────────────────────────────────
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 42)
    # Two lines, vertically centered-ish
    line1 = 'Pack de Videos'
    line2 = 'Publicitarios con IA'
    c.drawCentredString(w / 2, h / 2 + 30, line1)
    c.drawCentredString(w / 2, h / 2 - 20, line2)

    # ── Subtext ───────────────────────────────────────────────────────────────
    c.setFont('Helvetica', 14)
    c.setFillColor(colors.HexColor('#C4B5FD'))
    c.drawCentredString(w / 2, h / 2 - 60, 'Guia de uso y recomendaciones profesionales')

    # ── Decorative dots ───────────────────────────────────────────────────────
    c.setFillColor(colors.HexColor('#6D28D9'))
    for i in range(5):
        c.circle(52 + i * 18, h / 2 - 100, 4, fill=1, stroke=0)

    # ── Bottom white bar ──────────────────────────────────────────────────────
    bar_h = 52
    c.setFillColor(WHITE)
    c.rect(0, 0, w, bar_h, fill=1, stroke=0)
    c.setFillColor(DARK)
    c.setFont('Helvetica-Bold', 13)
    c.drawCentredString(w / 2, 18, 'acuarius.app')

    # Purple dot accent in bottom bar
    c.setFillColor(PURPLE)
    c.circle(w / 2 - 62, 22, 4, fill=1, stroke=0)
    c.circle(w / 2 + 62, 22, 4, fill=1, stroke=0)


# ── PAGE 2: ¿Qué incluye tu pack? ────────────────────────────────────────────
def page2_content(content_w, styles):
    normal, h2, tip_title, tip_body, gray_small, footer, support_title, support_body = styles
    story = []

    # Header bar
    story.append(HeaderBar('¿Que incluye tu pack?', content_w, height=40, font_size=17))
    story.append(Spacer(1, 18))

    # Section title
    story.append(Paragraph('Tus creditos de video', h2))
    story.append(Paragraph(
        'Cada credito te permite generar 1 video publicitario de hasta 15 segundos en alta '
        'definicion (1080p) usando Seedance 2.0, el modelo de IA mas avanzado para generacion de video.',
        normal
    ))
    story.append(Spacer(1, 16))

    # 3 feature boxes
    box_w = (content_w - 20) / 3
    boxes = [
        ('Video en HD 1080p',
         'Calidad profesional lista para publicar directamente en Meta, TikTok o YouTube Ads'),
        ('Listo en ~60 seg',
         'Generacion asincrona. El modelo trabaja en segundo plano y te entrega el resultado en menos de 2 minutos'),
        ('Con audio incluido',
         'Al subir una foto de referencia del producto, el video incluye musica y efectos generados automaticamente'),
    ]

    box_table_data = [[
        RoundedBox(t, b, box_w - 4) for t, b in boxes
    ]]
    box_table = Table(box_table_data, colWidths=[box_w] * 3)
    box_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(box_table)
    story.append(Spacer(1, 24))

    # Formatos disponibles
    story.append(Paragraph('Formatos disponibles', h2))

    fmt_data = [
        ['Formato', 'Relacion de aspecto', 'Plataformas ideales'],
        ['Reels / Stories', '9:16 Vertical', 'TikTok, Instagram Reels, Stories'],
        ['Feed cuadrado', '1:1 Cuadrado', 'Instagram Feed, Facebook Feed'],
        ['YouTube / Horizontal', '16:9 Horizontal', 'YouTube Ads, Google Display'],
    ]
    fmt_table = Table(fmt_data, colWidths=[content_w * 0.32, content_w * 0.22, content_w * 0.46])
    fmt_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PURPLE),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('BACKGROUND', (0, 1), (-1, 1), LIGHT_PURPLE),
        ('BACKGROUND', (0, 2), (-1, 2), WHITE),
        ('BACKGROUND', (0, 3), (-1, 3), LIGHT_PURPLE),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('TEXTCOLOR', (0, 1), (-1, -1), DARK_TEXT),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
        ('ROWBACKGROUND', (0, 0), (-1, 0), PURPLE),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(fmt_table)
    story.append(Spacer(1, 20))

    # Footer
    story.append(HRFlowable(width=content_w, thickness=0.5, color=colors.HexColor('#E5E7EB')))
    story.append(Spacer(1, 8))
    story.append(Paragraph('acuarius.app  |  Marketing con IA para LatAm', footer))

    return story


# ── PAGE 3: Cómo sacar el máximo provecho ─────────────────────────────────────
def page3_content(content_w, styles):
    normal, h2, tip_title, tip_body, gray_small, footer, support_title, support_body = styles
    story = []

    story.append(HeaderBar('Como sacar el maximo provecho', content_w, height=40, font_size=17))
    story.append(Spacer(1, 18))

    tips = [
        ('1.  Sube siempre una foto de referencia',
         'Los videos generados con imagen de producto tienen mejor calidad, evitan filtros '
         'de contenido y el resultado es mas relevante para tu cliente.'),
        ('2.  Describe la escena, no el producto',
         "En lugar de escribir 'shampoo organico', escribe 'mujer latinoamericana en ducha, "
         "aplicando shampoo con cabello brillante, ambiente calido y natural'. "
         'El modelo responde mejor a escenas vividas.'),
        ('3.  Genera una version por plataforma',
         'El formato vertical 9:16 funciona para Reels y TikTok. El cuadrado 1:1 es ideal '
         'para Feed de Instagram y Facebook. Genera versiones separadas para cada placement.'),
        ('4.  Itera sobre lo que funciona',
         'Si un video tiene buena aceptacion en Meta Ads, usa el mismo prompt con pequenas '
         'variaciones: cambia el estilo visual (Cinematic a UGC) o el tiempo (10s a 15s).'),
        ('5.  Combina video con analisis del agente',
         'Despues de generar el video, usa el Agente Meta Ads o TikTok Ads de Acuarius para '
         'crear el copy del anuncio, definir la audiencia y estructurar la campana completa.'),
    ]

    for title, body in tips:
        story.append(KeepTogether([
            Paragraph(title, tip_title),
            Paragraph(body, tip_body),
        ]))

    story.append(Spacer(1, 16))
    story.append(HRFlowable(width=content_w, thickness=0.5, color=colors.HexColor('#E5E7EB')))
    story.append(Spacer(1, 8))
    story.append(Paragraph('acuarius.app  |  Marketing con IA para LatAm', footer))

    return story


# ── PAGE 4: Estilos visuales y casos de uso ───────────────────────────────────
def page4_content(content_w, styles):
    normal, h2, tip_title, tip_body, gray_small, footer, support_title, support_body = styles
    story = []

    story.append(HeaderBar('Estilos visuales y casos de uso', content_w, height=40, font_size=17))
    story.append(Spacer(1, 18))

    # Styles table
    tbl_data = [
        ['Estilo', 'Ideal para', 'Descripcion'],
        ['Cinematic',     'Moda, lujo, cosmetica',         'Iluminacion dramatica, movimiento lento, colores calidos'],
        ['UGC / Organico','eCommerce, salud, alimentacion', 'Camara en mano, luz natural, sensacion autentica'],
        ['Lifestyle',     'Servicios, bienestar, turismo',  'Personas reales, momentos cotidianos, tono aspiracional'],
        ['Producto Hero', 'Tecnologia, gadgets, B2B',       'Fondo limpio, foco total en el producto, alta definicion'],
    ]
    col_w = [content_w * 0.22, content_w * 0.30, content_w * 0.48]
    tbl = Table(tbl_data, colWidths=col_w)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PURPLE),
        ('TEXTCOLOR', (0, 0), (-1, 0), WHITE),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
        ('FONTSIZE', (0, 1), (-1, -1), 10),
        ('FONTNAME', (0, 1), (0, -1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0, 1), (-1, -1), DARK_TEXT),
        ('ROWBACKGROUND', (0, 1), (-1, 1), LIGHT_PURPLE),
        ('ROWBACKGROUND', (0, 2), (-1, 2), WHITE),
        ('ROWBACKGROUND', (0, 3), (-1, 3), LIGHT_PURPLE),
        ('ROWBACKGROUND', (0, 4), (-1, 4), WHITE),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D1D5DB')),
        ('TOPPADDING', (0, 0), (-1, -1), 9),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 9),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 24))

    # Credits section
    story.append(Paragraph('Se te acabaron los creditos?', h2))
    story.append(Paragraph(
        'Puedes comprar creditos adicionales en cualquier momento desde el modulo Meta Ads o '
        'TikTok Ads dentro de la plataforma. Los creditos extra no tienen fecha de vencimiento.',
        normal
    ))
    story.append(Spacer(1, 20))

    # Support box — light purple bg
    support_data = [[
        Paragraph('Tienes preguntas?', support_title),
        '',
    ], [
        Paragraph(
            'Escribenos a hola@acuarius.app o accede a soporte desde la plataforma en acuarius.app',
            support_body
        ),
        '',
    ]]
    support_tbl = Table(support_data, colWidths=[content_w, 0])
    support_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT_PURPLE),
        ('TOPPADDING', (0, 0), (-1, -1), 12),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 16),
        ('RIGHTPADDING', (0, 0), (-1, -1), 16),
        ('SPAN', (0, 0), (1, 0)),
        ('SPAN', (0, 1), (1, 1)),
    ]))
    story.append(support_tbl)
    story.append(Spacer(1, 20))

    # Footer
    story.append(HRFlowable(width=content_w, thickness=0.5, color=colors.HexColor('#E5E7EB')))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        '(c) 2025 Acuarius  \u00b7  acuarius.app  \u00b7  Marketing con IA para LatAm',
        footer
    ))

    return story


# ── Canvas callback (page numbers / no header on cover) ───────────────────────
_page_counter = [0]

def on_page(canvas_obj, doc):
    _page_counter[0] += 1
    page_num = _page_counter[0]

    if page_num == 1:
        # Draw the cover using canvas
        draw_cover(canvas_obj, doc)


# ── Main builder ──────────────────────────────────────────────────────────────
def build_pdf():
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)

    margin = 52  # ~18mm side margins
    doc = SimpleDocTemplate(
        OUT_PATH,
        pagesize=A4,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=margin,
        title='Pack de Videos Acuarius',
        author='Acuarius',
        subject='Guia de uso — Pack de Videos Publicitarios con IA',
    )
    content_w = A4_W - 2 * margin

    styles = make_styles()
    story = []

    # ── Page 1 placeholder: cover is drawn via onFirstPage ────────────────────
    # We add an empty transparent paragraph + PageBreak so Platypus reserves page 1
    cover_placeholder = Paragraph(' ', ParagraphStyle('blank', fontSize=1))
    story.append(cover_placeholder)
    story.append(PageBreak())

    # ── Page 2 ────────────────────────────────────────────────────────────────
    story.extend(page2_content(content_w, styles))
    story.append(PageBreak())

    # ── Page 3 ────────────────────────────────────────────────────────────────
    story.extend(page3_content(content_w, styles))
    story.append(PageBreak())

    # ── Page 4 ────────────────────────────────────────────────────────────────
    story.extend(page4_content(content_w, styles))

    doc.build(story, onFirstPage=on_page, onLaterPages=lambda c, d: None)
    print(f'PDF generated: {OUT_PATH}')
    print(f'File size: {os.path.getsize(OUT_PATH):,} bytes')


if __name__ == '__main__':
    build_pdf()
