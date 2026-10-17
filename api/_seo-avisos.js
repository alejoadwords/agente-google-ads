// api/_seo-avisos.js — avisos del calendario de contenido (fase 2).
//
// Al cliente: un correo cuando hay una pieza esperando su revisión (si la
// agencia dejó su correo en el proyecto). A la agencia: celular y correo
// cuando el cliente aprueba, pide cambios o comenta — a quien creó la pieza y
// al dueño de la cuenta. Ninguno tumba la acción si falla, pero queda en
// error_log y la respuesta dice si salió. Solo se importa desde edge.

import { enviarPushA } from './_push.js';
import { registrarError } from './_registro-errores.js';
import { comercialesActivos, duenoComoComercial } from './_assign.js';
import { emailHtml, bloque, esc, RESPONDER_A } from './_email-layout.js';
import { enviarResend } from './_correo.js';

async function correo({ para, asunto, titulo, intro, cuerpo, cta, pie, donde, usuario }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !para) return false;
  try {
    const r = await enviarResend(donde, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'Acuarius <crm@app.acuarius.app>', reply_to: RESPONDER_A, to: para, subject: asunto,
        html: emailHtml({ titulo, intro, preheader: intro, cuerpo, cta, pie }) }),
    }, usuario);
    if (!r?.ok) throw new Error('Resend HTTP ' + (r?.status || '?'));
    return true;
  } catch (e) {
    await registrarError({ origen: 'servidor', donde: 'seo-avisos.' + donde, error: e, usuario }).catch(() => {});
    return false;
  }
}

// Una pieza para revisar: al cliente, con el enlace directo a ella.
export async function avisarClienteRevision({ proyecto, contenido, token }) {
  if (!proyecto.correo_cliente || !token) return { enviado: false, motivo: !proyecto.correo_cliente ? 'sin correo del cliente' : 'sin enlace activo' };
  const url = 'https://app.acuarius.app/seo/' + token + '?c=' + contenido.id;
  const ok = await correo({
    para: proyecto.correo_cliente, donde: 'revision', usuario: proyecto.user_id,
    asunto: 'Para revisar: ' + contenido.titulo,
    titulo: 'Tienes un contenido para revisar',
    intro: (proyecto.nombre_cliente ? esc(proyecto.nombre_cliente) + ', ' : '') + 'el equipo de SEO de ' + esc(proyecto.nombre) + ' te envió una pieza para que la revises.',
    cuerpo: bloque(`<div style="font-size:16px;font-weight:800">${esc(contenido.titulo)}</div>` +
      (contenido.fecha ? `<div style="color:#5B6072;font-size:13px;margin-top:4px">Publicación prevista: ${esc(contenido.fecha)}</div>` : '')),
    cta: { texto: 'Revisar y aprobar', url },
    pie: 'Puedes aprobarla o pedir cambios con una nota, sin crear cuenta.',
  });
  return { enviado: ok };
}

// El cliente decidió algo: a quien creó la pieza y al dueño de la cuenta.
export async function avisarAgencia({ proyecto, contenido, accion, nombre, texto }) {
  const que = { aprobado: 'aprobó', cambios: 'pidió cambios en', comentario: 'comentó' }[accion] || 'respondió sobre';
  const titulo = (nombre || 'Tu cliente') + ' ' + que + ' «' + contenido.titulo + '»';
  const destinos = [...new Set([contenido.creado_por, proyecto.user_id].filter(Boolean))];
  const equipo = await comercialesActivos(proyecto.user_id).catch(() => []);
  const hechos = [];
  for (const para of destinos) {
    try {
      const r = await enviarPushA(para, { titulo, texto: String(texto || '').slice(0, 120) || proyecto.nombre, url: '/proyecto-seo', etiqueta: 'seo-contenido-' + contenido.id });
      if (r?.enviados) hechos.push('celular');
    } catch (e) { await registrarError({ origen: 'servidor', donde: 'seo-avisos.push', error: e, usuario: proyecto.user_id }).catch(() => {}); }
    const com = equipo.find(m => m.id === para) || (para === proyecto.user_id ? await duenoComoComercial(para).catch(() => null) : null);
    if (com?.email && await correo({
      para: com.email, donde: 'agencia', usuario: proyecto.user_id, asunto: titulo,
      titulo: accion === 'aprobado' ? 'Contenido aprobado' : accion === 'cambios' ? 'Te pidieron cambios' : 'Nuevo comentario de tu cliente',
      intro: esc(titulo) + ' en el proyecto SEO ' + esc(proyecto.nombre) + '.',
      cuerpo: texto ? bloque(`<div style="font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(texto)}</div>`) : '',
      cta: { texto: 'Abrir el proyecto', url: 'https://app.acuarius.app/proyecto-seo' },
    })) hechos.push('correo');
  }
  return hechos;
}
