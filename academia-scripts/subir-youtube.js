#!/usr/bin/env node
// Sube los videos de la Academia a YouTube: título, descripción con capítulos,
// etiquetas, subtítulos y playlist por categoría. Quedan en PRIVADO.
//
//   node subir-youtube.js --dry-run        ver qué haría, sin subir nada
//   node subir-youtube.js --limit 4        subir los 4 siguientes pendientes
//   node subir-youtube.js --sin-subtitulos ahorra 400 unidades de cuota por video
//
// Requiere en el entorno: SUPABASE_URL, SUPABASE_SERVICE_KEY, GOOGLE_CLIENT_ID,
// GOOGLE_CLIENT_SECRET. El token sale de platform_connections (platform
// 'youtube'), que se llena autorizando una vez en /api/yt-auth.
//
// Cuota de YouTube: 10.000 unidades/día. Cada video cuesta 1.600 (subida) +
// 400 (subtítulos) + 50 (playlist) = 2.050, así que entran 4 por día. Sin
// subtítulos son 1.650 y entran 6. El script se detiene solo al agotar cuota y
// guarda el avance en estado-youtube.json para retomar al día siguiente.

const fs = require('fs');
const path = require('path');

const ESCRITORIO = process.env.ACADEMIA_DIR || path.join(process.env.HOME, 'Desktop');
const ESTADO = path.join(__dirname, 'estado-youtube.json');
const USER_ID = process.env.ACUARIUS_USER_ID || 'user_3GQCaAm5pxdTpk3PbyvJoqBPW1o';

// Categoría de cada video → playlist. El número sale del nombre del archivo.
const CATEGORIAS = [
  { hasta: 4,  playlist: 'Acuarius · Primeros pasos' },
  { hasta: 11, playlist: 'Acuarius · Google Ads, Meta y TikTok' },
  { hasta: 13, playlist: 'Acuarius · SEO y visibilidad en IA' },
  { hasta: 14, playlist: 'Acuarius · Contenido para redes' },
  { hasta: 17, playlist: 'Acuarius · CRM' },
  { hasta: 22, playlist: 'Acuarius · Marketing y automatización' },
  { hasta: 24, playlist: 'Acuarius · Conversaciones' },
  { hasta: 99, playlist: 'Acuarius · Análisis' },
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SIN_SUBS = args.includes('--sin-subtitulos');
const LIMITE = (() => {
  const i = args.indexOf('--limit');
  return i >= 0 ? parseInt(args[i + 1], 10) || 4 : 4;
})();

const sb = () => ({
  apikey: process.env.SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

function leerEstado() {
  try { return JSON.parse(fs.readFileSync(ESTADO, 'utf8')); } catch { return { subidos: {} }; }
}
function guardarEstado(e) { fs.writeFileSync(ESTADO, JSON.stringify(e, null, 1)); }

// ── Metadatos: se leen del .txt que acompaña a cada video ────────────────────
function parsearMeta(txt) {
  const bloque = (nombre, siguiente) => {
    const re = new RegExp(nombre + '\\n([\\s\\S]*?)(?=\\n(?:' + siguiente.join('|') + ')\\n|$)');
    const m = txt.match(re);
    return m ? m[1].trim() : '';
  };
  const titulo = bloque('TÍTULO SUGERIDO', ['DESCRIPCIÓN']).split('\n')[0].trim();
  const desc = bloque('DESCRIPCIÓN', ['CAPÍTULOS', 'ETIQUETAS', 'MINIATURA SUGERIDA']);
  const caps = bloque('CAPÍTULOS', ['ETIQUETAS', 'MINIATURA SUGERIDA']);
  const tags = bloque('ETIQUETAS', ['MINIATURA SUGERIDA'])
    .split(',').map(t => t.trim()).filter(Boolean).slice(0, 25);
  // Los capítulos solo funcionan si van dentro de la descripción
  const descripcion = [desc, caps ? 'CAPÍTULOS\n' + caps : ''].filter(Boolean).join('\n\n');
  return { titulo, descripcion, tags };
}

// ── Token: se refresca siempre, el access_token dura una hora ────────────────
async function tokenFresco() {
  const filas = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/platform_connections?user_id=eq.${encodeURIComponent(USER_ID)}&platform=eq.youtube&select=*&limit=1`,
    { headers: sb() }
  ).then(r => r.json());
  const c = filas?.[0];
  if (!c) throw new Error('No hay conexión de YouTube. Autoriza una vez en https://app.acuarius.app/api/yt-auth?userId=' + USER_ID);
  if (!c.refresh_token) throw new Error('La conexión no tiene refresh_token: vuelve a autorizar en /api/yt-auth');

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: c.refresh_token,
      grant_type: 'refresh_token',
    }),
  }).then(x => x.json());
  if (!r.access_token) throw new Error('No se pudo refrescar el token: ' + JSON.stringify(r).slice(0, 200));
  return { token: r.access_token, cuenta: c.account_name };
}

// ── Playlists: se crean una vez y se reutilizan ──────────────────────────────
const cachePlaylists = {};
async function playlistId(token, titulo, estado) {
  if (estado.playlists?.[titulo]) return estado.playlists[titulo];
  if (cachePlaylists[titulo]) return cachePlaylists[titulo];

  const mias = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50', {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json()).catch(() => ({}));
  const existente = (mias.items || []).find(p => p.snippet?.title === titulo);
  if (existente) {
    cachePlaylists[titulo] = existente.id;
    estado.playlists = { ...(estado.playlists || {}), [titulo]: existente.id };
    return existente.id;
  }

  const nueva = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snippet: { title: titulo, description: 'Academia de Acuarius' },
      status: { privacyStatus: 'private' },
    }),
  }).then(r => r.json());
  if (!nueva.id) throw new Error('No se pudo crear la playlist: ' + JSON.stringify(nueva).slice(0, 200));
  cachePlaylists[titulo] = nueva.id;
  estado.playlists = { ...(estado.playlists || {}), [titulo]: nueva.id };
  return nueva.id;
}

// ── Subida ───────────────────────────────────────────────────────────────────
async function subirVideo(token, archivo, meta) {
  const cuerpo = fs.readFileSync(archivo);
  const metadatos = {
    snippet: {
      title: meta.titulo.slice(0, 100),
      description: meta.descripcion.slice(0, 4900),
      tags: meta.tags,
      categoryId: '27',           // Educación
      defaultLanguage: 'es',
      defaultAudioLanguage: 'es',
    },
    // Privado a propósito: una app sin verificar de YouTube solo puede subir en
    // privado, y además conviene revisar antes de publicar.
    status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
  };

  const limite = '-----acuarius' + Date.now();
  const partes = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadatos)}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Type: video/mp4\r\n\r\n`),
    cuerpo,
    Buffer.from(`\r\n--${limite}--\r\n`),
  ]);

  const r = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${limite}` },
    body: partes,
  });
  const d = await r.json();
  if (!d.id) {
    const err = JSON.stringify(d).slice(0, 400);
    const e = new Error('Subida fallida: ' + err);
    e.cuota = /quota/i.test(err);
    throw e;
  }
  return d.id;
}

async function subirSubtitulos(token, videoId, srt) {
  const meta = { snippet: { videoId, language: 'es', name: 'Español', isDraft: false } };
  const limite = '-----subs' + Date.now();
  const partes = Buffer.concat([
    Buffer.from(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fs.readFileSync(srt),
    Buffer.from(`\r\n--${limite}--\r\n`),
  ]);
  const r = await fetch('https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${limite}` },
    body: partes,
  });
  const d = await r.json().catch(() => ({}));
  return !!d.id;
}

async function aPlaylist(token, videoId, listaId) {
  // El primer añadido a una playlist recién creada falla por propagación:
  // se reintenta un par de veces antes de darlo por perdido.
  for (let intento = 0; intento < 3; intento++) {
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { playlistId: listaId, resourceId: { kind: 'youtube#video', videoId } } }),
    });
    if (r.ok) return true;
    await new Promise(res => setTimeout(res, 3000));
  }
  return false;
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  const videos = fs.readdirSync(ESCRITORIO)
    .filter(f => /^Academia - Video \d+ .*\.mp4$/.test(f))
    .map(f => ({ archivo: f, n: parseInt(f.match(/Video (\d+)/)[1], 10) }))
    .sort((a, b) => a.n - b.n);

  const estado = leerEstado();
  const pendientes = videos.filter(v => !estado.subidos[v.archivo]);

  console.log(`${videos.length} videos · ${pendientes.length} pendientes · se subirán hasta ${LIMITE}`);
  if (!pendientes.length) { console.log('Todo subido.'); return; }

  let token = null, cuenta = '';
  if (!DRY) ({ token, cuenta } = await tokenFresco());
  if (cuenta) console.log('Canal autorizado:', cuenta);

  let hechos = 0;
  for (const v of pendientes) {
    if (hechos >= LIMITE) break;
    const base = path.join(ESCRITORIO, v.archivo.replace(/\.mp4$/, ''));
    const txt = base.replace(/ - [^-]*$/, '') + ' - YouTube.txt';
    const txtReal = fs.existsSync(txt) ? txt : base + ' - YouTube.txt';
    if (!fs.existsSync(txtReal)) { console.log(`⚠️  ${v.archivo}: sin archivo de metadatos, se omite`); continue; }

    const meta = parsearMeta(fs.readFileSync(txtReal, 'utf8'));
    const lista = CATEGORIAS.find(c => v.n <= c.hasta).playlist;
    const srt = base + '.srt';

    console.log(`\n[${v.n}] ${meta.titulo}`);
    console.log(`     playlist: ${lista} · etiquetas: ${meta.tags.length} · subtítulos: ${fs.existsSync(srt) && !SIN_SUBS ? 'sí' : 'no'}`);
    if (DRY) { hechos++; continue; }

    try {
      const videoId = await subirVideo(token, path.join(ESCRITORIO, v.archivo), meta);
      console.log(`     ✓ subido: https://youtu.be/${videoId} (privado)`);

      if (fs.existsSync(srt) && !SIN_SUBS) {
        const ok = await subirSubtitulos(token, videoId, srt);
        console.log(`     ${ok ? '✓' : '⚠️'} subtítulos`);
      }
      const listaId = await playlistId(token, lista, estado);
      const enLista = await aPlaylist(token, videoId, listaId);
      console.log(`     ${enLista ? '✓' : '⚠️'} añadido a la playlist`);

      estado.subidos[v.archivo] = { videoId, fecha: new Date().toISOString(), playlist: lista };
      guardarEstado(estado);
      hechos++;
    } catch (e) {
      console.error(`     ✗ ${e.message}`);
      guardarEstado(estado);
      if (e.cuota) {
        console.log('\nCuota diaria agotada. Vuelve a ejecutar mañana: retoma donde quedó.');
        break;
      }
    }
  }

  const restantes = videos.length - Object.keys(estado.subidos).length;
  console.log(`\nListo. Subidos en total: ${Object.keys(estado.subidos).length}/${videos.length}${restantes ? ` · quedan ${restantes}` : ''}`);
  if (!DRY && restantes) console.log('Ejecuta de nuevo mañana para continuar (la cuota se reinicia a medianoche hora del Pacífico).');
})();
