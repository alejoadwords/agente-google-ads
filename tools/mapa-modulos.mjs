#!/usr/bin/env node
// tools/mapa-modulos.mjs — dibuja el mapa de la API leyendo el código.
//
//   node tools/mapa-modulos.mjs > .claude/skills/soporte/modulos.md
//
// Se genera en vez de escribirse a mano porque un mapa escrito a mano envejece
// sin avisar, y un mapa viejo en una sesión de soporte hace perder más tiempo
// del que ahorra. Aquí lo peor que puede pasar es que falte un comentario.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function ficheros(dir) {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return ficheros(ruta);
    return n.endsWith('.js') ? [ruta] : [];
  });
}

// La primera línea de comentario que dice algo, saltándose el nombre del
// fichero cuando la cabecera empieza repitiéndolo.
function descripcion(txt, ruta, nombre) {
  for (const bruta of txt.split('\n').slice(0, 14)) {
    let l = bruta.trim();
    if (!l.startsWith('//')) continue;
    l = l.replace(/^\/+\s?/, '').trim();
    // Muchas cabeceras empiezan repitiendo la ruta o el nombre del fichero;
    // eso no describe nada, así que se quita y se sigue mirando.
    if (l.startsWith(ruta)) l = l.slice(ruta.length).replace(/^[—–:-]\s*/, '').trim();
    else if (l.startsWith(nombre)) l = l.slice(nombre.length).replace(/^[—–:-]\s*/, '').trim();
    if (/^[─—–=-]+$/.test(l)) continue;   // líneas de separación
    if (l.length > 12) return l.replace(/\|/g, '/');   // la barra rompe la tabla
  }
  return '';
}

const todos = ficheros('api').sort();
const compartidos = todos.filter((f) => f.split('/').pop().startsWith('_'));
const puntos = todos.filter((f) => !f.split('/').pop().startsWith('_'));

const fila = (f) => {
  const txt = readFileSync(f, 'utf8');
  const nombre = f.split('/').pop();
  const edge = txt.includes("runtime: 'edge'") ? 'edge' : 'node';
  const tablas = [...new Set([...txt.matchAll(/\/rest\/v1\/([a-z_]+)/g)].map((m) => m[1]))]
    .filter((t) => t !== 'rpc').sort();
  return `| \`${f}\` | ${edge} | ${descripcion(txt, f, nombre) || '—'} | ${tablas.slice(0, 5).join(', ') || '—'} |`;
};

const hoy = new Date().toISOString().slice(0, 10);
console.log(`# Mapa de la API

Generado el ${hoy} desde el código con \`node tools/mapa-modulos.mjs\`. No se
edita a mano: se vuelve a generar.

**${puntos.length} endpoints** y **${compartidos.length} módulos compartidos**.

Dos reglas del despliegue que explican fallos raros:

- Un módulo \`api/_*.js\` **solo puede importarse desde funciones edge**. Desde
  una función Node revienta el build o el arranque.
- El catch-all de \`vercel.json\` devuelve **200 con el shell de la app** para
  cualquier ruta que no empiece por \`/api\`. Comprobar por contenido, nunca por
  código de estado.

## Endpoints

| Fichero | Entorno | Qué hace | Tablas que toca |
|---|---|---|---|
${puntos.map(fila).join('\n')}

## Módulos compartidos

| Fichero | Entorno | Qué hace | Tablas que toca |
|---|---|---|---|
${compartidos.map(fila).join('\n')}`);
