
let mem={},hist=[],onDone=false,obStep=0,loading=false,clientStage='sin definir';
const MAX_HIST_MESSAGES = 8; // máximo de mensajes enviados a Claude (4 turnos)
let pendingImg=null; // {base64, mediaType, name}
let clerkInstance=null,sessionToken=null,userPlan='free';
let lastParrillaText=''; // Guarda la última parrilla generada para exportar a Sheets
// Declaración temprana para evitar ReferenceError en getProfileKey
let adsActiveAccount = null;
// Contexto de cliente activo para usuarios Plan Agencia y Pro
let activeClientContext = null; // { clientId, clientName, clientIndustry, monthlyBudget, notes }
let pendingAgentAfterSetup = null; // agentKey a abrir después de que Pro complete su perfil

// Sistema de límites de imágenes
let imageUsage = { generated: 0, limit: 2 }; // Plan gratuito: 2 imágenes en 7 días

// Usuarios con acceso especial (admin/testing)
const ADMIN_EMAILS = [
  'alejandro.gonzalez.ads@gmail.com',
  'alejandro@acuarius.app',
  'admin@acuarius.app',
  'test@acuarius.app'
];

function isAdminUser() {
  if (!clerkInstance?.user?.primaryEmailAddress?.emailAddress) return false;
  return ADMIN_EMAILS.includes(clerkInstance.user.primaryEmailAddress.emailAddress.toLowerCase());
}

// Funciones de límites
function loadImageUsage() {
  if (userPlan === 'pro' || isAdminUser()) {
    imageUsage = { generated: 0, limit: 999 }; // Ilimitado para Pro y Admin
    return;
  }
  try {
    const saved = localStorage.getItem('acuarius_image_usage');
    if (saved) {
      const data = JSON.parse(saved);
      // Verificar si han pasado 7 días (reset del trial)
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (now - data.timestamp > sevenDays) {
        // Reset después de 7 días
        imageUsage = { generated: 0, limit: 2, timestamp: now };
        saveImageUsage();
      } else {
        imageUsage = { generated: data.generated || 0, limit: 2, timestamp: data.timestamp };
      }
    } else {
      // Primera vez
      imageUsage = { generated: 0, limit: 2, timestamp: Date.now() };
      saveImageUsage();
    }
  } catch (e) {
    imageUsage = { generated: 0, limit: 2, timestamp: Date.now() };
  }
}

function saveImageUsage() {
  try {
    localStorage.setItem('acuarius_image_usage', JSON.stringify(imageUsage));
  } catch (e) {}
}

function canGenerateImage() {
  loadImageUsage();
  return userPlan === 'pro' || isAdminUser() || imageUsage.generated < imageUsage.limit;
}

function incrementImageUsage() {
  if (userPlan !== 'pro' && !isAdminUser()) {
    imageUsage.generated++;
    saveImageUsage();
  }
}

function showImageLimitReached() {
  const remaining = Math.max(0, imageUsage.limit - imageUsage.generated);
  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = 
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>' +
    '</div>' +
    '<div style="max-width:400px">' +
      '<div style="background:linear-gradient(135deg,#EF4444,#DC2626);border-radius:14px;padding:20px;color:white;margin-bottom:12px">' +
        '<div style="font-size:16px;font-weight:700;margin-bottom:6px">🔒 Límite de imágenes alcanzado</div>' +
        '<div style="font-size:13px;margin-bottom:14px;opacity:0.9">Usaste tus ' + imageUsage.limit + ' imágenes gratuitas del período de prueba.</div>' +
        '<div style="font-size:12px;background:rgba(255,255,255,0.15);padding:12px;border-radius:8px;margin-bottom:14px">' +
          '<strong>Plan Pro - $19/mes:</strong><br>' +
          '✓ Imágenes ilimitadas<br>' +
          '✓ Diseño profesional con cuestionario<br>' +
          '✓ Formatos feed + stories automático<br>' +
          '✓ 5 variaciones por pedido' +
        '</div>' +
        '<button onclick="window.open(\'/pricing.html\',\'_blank\')" style="width:100%;padding:12px;background:white;color:#DC2626;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">🚀 Actualizar a Pro</button>' +
      '</div>' +
      '<button onclick="showProPreview()" style="padding:8px 16px;background:var(--border);color:var(--muted);border:none;border-radius:8px;font-size:12px;cursor:pointer">Ver ejemplo de calidad Pro →</button>' +
    '</div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function showProPreview() {
  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = 
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>' +
    '</div>' +
    '<div style="max-width:400px">' +
      '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px">🎨 Ejemplo de calidad Pro</div>' +
      '<div style="border-radius:12px;overflow:hidden;border:1px solid var(--border);background:#f8f9fa">' +
        '<img src="data:image/png;base64,/mnt/user-data/uploads/toxina_botulinica_1.png" style="width:100%;height:auto;display:block" alt="Ejemplo diseño Pro"/>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-top:8px;text-align:center">Diseño profesional con logo integrado, jerarquía tipográfica y layout de agencia</div>' +
    '</div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

const OB_STEPS_BY_AGENT = {
  'google-ads': [
    {q:'¿Cuál es el nombre y URL de tu negocio?',ph:'Ej: Mi Empresa · www.miempresa.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['E-commerce / Retail','Servicios profesionales','Salud / Bienestar','Educación / Cursos','Tecnología / SaaS','Inmobiliaria','Restaurantes / Food','Otro sector']},
    {q:'¿Cuál es tu producto o servicio principal?',ph:'Ej: Software de gestión contable para PYMEs',key:'producto',type:'input'},
    {q:'¿Cuál es tu presupuesto mensual en Google Ads?',key:'presupuesto',type:'opts',opts:['Menos de $500 USD','$500 – $2.000 USD','$2.000 – $10.000 USD','Más de $10.000 USD']},
    {q:'¿Cuál es tu objetivo principal de campaña?',key:'objetivo',type:'opts',opts:['Generar leads / contactos','Ventas directas (e-commerce)','Tráfico al sitio web','Llamadas telefónicas','Reconocimiento de marca']},
    {q:'¿Cuál es tu mercado geográfico objetivo?',ph:'Ej: Colombia, México, toda Latinoamérica...',key:'mercado',type:'input'},
    {q:'¿En qué etapa estás con Google Ads?',key:'etapa',type:'opts',opts:['Empezando desde cero','Campaña activa (menos de 1 mes)','Campaña activa 1–3 meses','Más de 3 meses de experiencia']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores?',ph:'Ej: Empresa A, Empresa B (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ],
  'meta-ads': [
    {q:'¿Cuál es el nombre y URL de tu negocio?',ph:'Ej: Mi Empresa · www.miempresa.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['E-commerce / Retail','Servicios profesionales','Salud / Bienestar','Educación / Cursos','Tecnología / SaaS','Inmobiliaria','Restaurantes / Food','Otro sector']},
    {q:'¿Cuál es tu producto o servicio principal?',ph:'Ej: Ropa deportiva para mujeres',key:'producto',type:'input'},
    {q:'¿Cuál es tu presupuesto mensual en Meta Ads?',key:'presupuesto',type:'opts',opts:['Menos de $300 USD','$300 – $1.000 USD','$1.000 – $5.000 USD','Más de $5.000 USD']},
    {q:'¿Cuál es tu objetivo principal en Meta?',key:'objetivo',type:'opts',opts:['Generar leads / contactos','Ventas en tienda online','Mensajes por WhatsApp / DM','Tráfico al sitio web','Reconocimiento de marca']},
    {q:'¿Cuál es tu mercado geográfico objetivo?',ph:'Ej: Colombia, México, toda Latinoamérica...',key:'mercado',type:'input'},
    {q:'¿En qué etapa estás con Meta Ads?',key:'etapa',type:'opts',opts:['Empezando desde cero','Cuenta activa (menos de 1 mes)','Cuenta activa 1–3 meses','Más de 3 meses de experiencia']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores?',ph:'Ej: Empresa A, Empresa B (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ],
  'seo': [
    {q:'¿Cuál es el nombre y URL de tu sitio web?',ph:'Ej: Mi Empresa · www.miempresa.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['E-commerce / Retail','Servicios profesionales','Salud / Bienestar','Educación / Cursos','Tecnología / SaaS','Inmobiliaria','Restaurantes / Food','Otro sector']},
    {q:'¿Cuál es tu producto o servicio principal a posicionar?',ph:'Ej: Consultoría contable para PYMEs en Bogotá',key:'producto',type:'input'},
    {q:'¿En qué país o ciudad quieres posicionarte principalmente?',ph:'Ej: Colombia, Bogotá, México DF, toda LatAm...',key:'mercado',type:'input'},
    {q:'¿Cuál es tu objetivo principal con el SEO?',key:'objetivo',type:'opts',opts:['Atraer más visitas orgánicas','Generar leads desde Google','Posicionar mi marca localmente','Superar a mi competencia en Google','Aparecer en IAs como ChatGPT y Gemini']},
    {q:'¿En qué etapa está tu SEO actualmente?',key:'etapa',type:'opts',opts:['Sitio nuevo, sin trabajo SEO previo','Tengo SEO básico pero sin resultados claros','Tengo tráfico orgánico pero quiero escalarlo','Tengo SEO activo y quiero auditarlo']},
    {q:'¿Cuál es tu mayor desafío SEO hoy?',key:'desafio',type:'opts',opts:['No sé por qué keywords posicionar','Mi sitio no aparece en Google','Tengo visitas pero no convierten','No sé cómo crear contenido optimizado','Quiero aparecer en respuestas de IAs']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores online?',ph:'Ej: Empresa A, Empresa B (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ],
  'tiktok-ads': [
    {q:'¿Cuál es el nombre y URL de tu negocio?',ph:'Ej: Mi Empresa · www.miempresa.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['E-commerce / Retail','Servicios profesionales','Salud / Bienestar','Educación / Cursos','Tecnología / SaaS','Inmobiliaria','Restaurantes / Food','Otro sector']},
    {q:'¿Cuál es tu producto o servicio principal?',ph:'Ej: Curso de maquillaje online',key:'producto',type:'input'},
    {q:'¿Cuál es tu presupuesto mensual en TikTok Ads?',key:'presupuesto',type:'opts',opts:['Menos de $300 USD','$300 – $1.000 USD','$1.000 – $5.000 USD','Más de $5.000 USD']},
    {q:'¿Cuál es tu objetivo principal en TikTok?',key:'objetivo',type:'opts',opts:['Ventas directas','Generar leads','Tráfico al sitio web','Reconocimiento de marca','Crecimiento de comunidad']},
    {q:'¿Cuál es tu mercado geográfico objetivo?',ph:'Ej: Colombia, México, toda Latinoamérica...',key:'mercado',type:'input'},
    {q:'¿En qué etapa estás con TikTok Ads?',key:'etapa',type:'opts',opts:['Empezando desde cero','Cuenta activa (menos de 1 mes)','Cuenta activa 1–3 meses','Más de 3 meses de experiencia']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores?',ph:'Ej: Empresa A, Empresa B (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ],
  'linkedin-ads': [
    {q:'¿Cuál es el nombre y URL de tu negocio?',ph:'Ej: Mi Empresa · www.miempresa.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['Tecnología / SaaS','Consultoría / Servicios profesionales','Recursos Humanos / Reclutamiento','Finanzas / Seguros','Salud corporativa','Educación ejecutiva','Manufactura / Industrial','Otro sector B2B']},
    {q:'¿Cuál es tu producto o servicio principal?',ph:'Ej: Software de gestión de proyectos para empresas',key:'producto',type:'input'},
    {q:'¿Cuál es tu presupuesto mensual en LinkedIn Ads?',key:'presupuesto',type:'opts',opts:['Menos de $500 USD','$500 – $2.000 USD','$2.000 – $10.000 USD','Más de $10.000 USD']},
    {q:'¿Cuál es tu objetivo principal en LinkedIn?',key:'objetivo',type:'opts',opts:['Generar leads B2B calificados','Reconocimiento de marca empresarial','Reclutar talento específico','Promover eventos o webinars','Nutrir contactos del pipeline']},
    {q:'¿Cuál es tu mercado geográfico objetivo?',ph:'Ej: Colombia, México, toda Latinoamérica...',key:'mercado',type:'input'},
    {q:'¿En qué etapa estás con LinkedIn Ads?',key:'etapa',type:'opts',opts:['Empezando desde cero','Cuenta activa (menos de 1 mes)','Cuenta activa 1–3 meses','Más de 3 meses de experiencia']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores?',ph:'Ej: Empresa A, Empresa B (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ],
  'consultor': [
    {q:'¿Cuál es el nombre y URL de tu negocio?',ph:'Ej: Mi Empresa · www.miempresa.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['E-commerce / Retail','Servicios profesionales','Salud / Bienestar','Educación / Cursos','Tecnología / SaaS','Inmobiliaria','Restaurantes / Food','Otro sector']},
    {q:'¿Cuál es tu presupuesto mensual total en marketing digital?',key:'presupuesto',type:'opts',opts:['No lo tengo claro aún','Menos de $300 USD','$300 – $1.000 USD','$1.000 – $5.000 USD','Más de $5.000 USD']},
    {q:'¿Cuál es tu objetivo principal de negocio ahora?',key:'objetivo',type:'opts',opts:['Conseguir más clientes / leads','Aumentar ventas online','Fortalecer la marca','Escalar a nuevos mercados','Reducir costo de adquisición']},
    {q:'¿En qué canales de marketing estás activo actualmente?',key:'canales',type:'multi',opts:['Ninguno todavía','Redes sociales orgánicas','Google Ads','Meta Ads (Facebook/Instagram)','TikTok','SEO','Email marketing','WhatsApp Business']},
    {q:'¿Cuál es tu mayor reto en marketing hoy?',key:'desafio',type:'opts',opts:['No sé por dónde empezar','Tengo canales pero no dan resultados','No sé cómo distribuir el presupuesto','Quiero escalar pero sin desperdiciar dinero','Necesito medir mejor mis resultados']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores?',ph:'Ej: Empresa A, Empresa B (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ],
  'social': [
    {q:'¿Cuál es el nombre y URL de tu negocio?',ph:'Ej: Mi Tienda · www.mitienda.com',key:'negocio',type:'input'},
    {q:'¿En qué industria opera tu negocio?',key:'industria',type:'opts',opts:['E-commerce / Retail','Servicios profesionales','Salud / Bienestar','Educación / Cursos','Tecnología / SaaS','Inmobiliaria','Restaurantes / Food','Otro sector']},
    {q:'¿Quién es tu cliente ideal?',ph:'Ej: Mujeres 25-40 años, Colombia, interesadas en moda sostenible',key:'audiencia',type:'input'},
    {q:'¿Cuál es tu objetivo principal en redes sociales?',key:'objetivo',type:'opts',opts:['Atraer nuevos clientes','Construir comunidad y engagement','Posicionar mi marca','Vender directamente desde redes','Generar tráfico a mi web']},
    {q:'¿En qué redes sociales tienes presencia actualmente?',key:'redes_actuales',type:'multi',opts:['Ninguna todavía','Instagram','Facebook','TikTok','LinkedIn','YouTube','X (Twitter)','Pinterest']},
    {q:'¿Con qué frecuencia publicas contenido actualmente?',key:'frecuencia',type:'opts',opts:['No publico nada aún','Menos de 1 vez por semana','1-2 veces por semana','3-5 veces por semana','Diariamente']},
    {q:'¿Tienes equipo o recursos para crear contenido?',key:'recursos',type:'opts',opts:['Solo yo, con el celular','Tengo diseñador o editor','Tengo agencia o community manager','Tengo presupuesto para contratar']},
    {q:'¿Cuál es el tono de comunicación de tu marca?',key:'tono',type:'opts',opts:['Profesional y formal','Cercano y conversacional','Moderno y aspiracional','Directo y sin rodeos','Divertido y creativo']},
    {q:'¿Quiénes son tus 2–3 principales competidores en redes?',ph:'Ej: @competidor1, @competidor2 (deja en blanco si no los conoces)',key:'competidores',type:'input'}
  ]
};

// Retorna los pasos de onboarding según el agente activo
function getObSteps() {
  return OB_STEPS_BY_AGENT[currentAgentCtx] || OB_STEPS_BY_AGENT['google-ads'];
}

// Compatibilidad con código existente
const obSteps = OB_STEPS_BY_AGENT['google-ads'];

// AUTH
function waitForClerk(t=6000){return new Promise((res,rej)=>{if(typeof Clerk!=='undefined')return res(window.Clerk);const s=Date.now(),iv=setInterval(()=>{if(typeof Clerk!=='undefined'){clearInterval(iv);res(window.Clerk)}else if(Date.now()-s>t){clearInterval(iv);rej(new Error('timeout'))}},50)})}
async function initAuth(){
  try {
    // Esperar a que Clerk cargue via data-clerk-publishable-key
    await new Promise((res,rej)=>{
      const s=Date.now();
      const iv=setInterval(()=>{
        if(window.Clerk&&window.Clerk.loaded){clearInterval(iv);res()}
        else if(window.Clerk&&!window.Clerk.loaded){window.Clerk.load().then(()=>{clearInterval(iv);res()}).catch(rej);clearInterval(iv)}
        else if(Date.now()-s>10000){clearInterval(iv);rej(new Error('timeout'))}
      },100)
    });
    clerkInstance=window.Clerk;
    clerkInstance.__pk='pk_live_Y2xlcmsuYWN1YXJpdXMuYXBwJA';
    if(!clerkInstance.user){
      window.location.href='/login.html';
      return false;
    }
    try { sessionToken = await clerkInstance.session.getToken(); } catch(e){}
    userPlan = clerkInstance.user.publicMetadata?.plan || 'free';
    updateUserUI(clerkInstance.user);
    return true;
  } catch(e) {
    console.error('Auth error:', e.message);
    // Si el error es que no hay sesión activa → redirigir al login
    // Si es otro error (ej. carga de Clerk) → mostrar igualmente y dejar que el proxy maneje auth
    if(e.message && (e.message.includes('session') || e.message.includes('signed') || e.message.includes('401'))){
      window.location.href='/login.html';
      return false;
    }
    return true; // Continuar sin auth — el proxy rechazará si no hay token
  }
}
function updateUserUI(u){
  const name=u.firstName||u.emailAddresses?.[0]?.emailAddress?.split('@')[0]||'usuario';
  document.getElementById('hdr-user').textContent=name;
  const initials=(u.firstName?.[0]||'')+(u.lastName?.[0]||'');
  document.getElementById('hdr-avatar').textContent=initials||'AC';
  const badge=document.getElementById('plan-badge');
  if(badge){
    if(isAdminUser()) badge.textContent='admin';
    else badge.textContent=userPlan==='pro'?'pro':userPlan==='agency'?'agency':'free · 7 días';
  }
  const greeting=document.getElementById('home-greeting');
  if(greeting){const h=new Date().getHours();const t=h<12?'buenos días':h<18?'buenas tardes':'buenas noches';greeting.textContent=`${t}, ${name} 👋`;}
}
async function logout(){if(clerkInstance){await clerkInstance.signOut();window.location.href='/login.html'}}

// INIT

const AGENT_GUIDES = {
  'google-ads': `hola, soy tu **agente de Google Ads** en acuarius.

estoy aquí para ayudarte a crear y optimizar campañas de Google Ads que generen resultados reales. esto es lo que puedo hacer por ti:

### lo que puedo hacer por ti
– **planeación de campaña** — estructura profesional desde cero según tus objetivos
– **keyword research** — palabras clave primarias, secundarias y negativas con intención de búsqueda
– **presupuesto** — recomendación de inversión basada en tu industria y CPC promedio
– **anuncios RSA** — 15 títulos y 4 descripciones optimizados para cada grupo de anuncios
– **anuncios Display** — copys y especificaciones para la red de display de Google
– **análisis y optimización** — revisión periódica con recomendaciones accionables
– **reportes** — informes completos de rendimiento de tu cuenta
– **hoja de ruta** — guía paso a paso de qué revisar en cada etapa (día 1, semana, mes...)

antes de empezar, necesito conocer tu negocio. son 9 preguntas rápidas — quedarán guardadas en tu perfil para todas las sesiones.`,

  'meta-ads': `hola, soy tu **agente de Meta Ads** en acuarius.

estoy aquí para ayudarte a crear campañas efectivas en Facebook e Instagram que conecten con tu audiencia y generen resultados medibles. esto es lo que puedo hacer por ti:

### lo que puedo hacer por ti
– **planeación de campaña** — estructura completa con objetivos, audiencias y formatos correctos
– **presupuesto** — distribución óptima entre campañas, conjuntos de anuncios y públicos
– **copys** — textos persuasivos adaptados al formato y objetivo de cada anuncio
– **anuncios gráficos** — especificaciones, textos y recomendaciones creativas para imagen
– **anuncios de video** — guiones, hooks y estructura para video en feed, stories y reels
– **análisis y optimización** — interpretación de métricas del Administrador de anuncios
– **reportes** — informes de rendimiento con conclusiones y próximos pasos

antes de empezar, necesito conocer tu negocio. son 9 preguntas rápidas — quedarán guardadas en tu perfil.`,

  'tiktok-ads': `hola, soy tu **agente de TikTok Ads** en acuarius.

estoy aquí para ayudarte a crear campañas en TikTok que impacten a audiencias jóvenes y generen resultados reales en la plataforma de mayor crecimiento del momento. esto es lo que puedo hacer por ti:

### lo que puedo hacer por ti
– **planeación de campaña** — estructura para In-Feed Ads, TopView, Spark Ads y más
– **presupuesto** — inversión recomendada según tu objetivo y el CPM promedio de TikTok
– **copys** — textos y hooks para capturar la atención en los primeros 3 segundos
– **anuncios gráficos** — especificaciones y textos para formatos de imagen en TikTok
– **anuncios de video** — guiones, estructura narrativa y tendencias de formato para TikTok
– **análisis y optimización** — métricas clave del TikTok Ads Manager
– **reportes** — informes de rendimiento adaptados a la plataforma

antes de empezar, necesito conocer tu negocio. son 9 preguntas rápidas — quedarán guardadas en tu perfil.`,

  'linkedin-ads': `hola, soy tu **agente de LinkedIn Ads** en acuarius.

estoy aquí para ayudarte a crear campañas B2B de alto impacto en LinkedIn, la plataforma con el mayor poder de segmentación profesional del mundo. esto es lo que puedo hacer por ti:

### lo que puedo hacer por ti
– **planeación de campaña** — estructura para Sponsored Content, Message Ads, Lead Gen Forms
– **presupuesto** — inversión recomendada considerando el CPL promedio de LinkedIn por industria
– **copys** — mensajes profesionales adaptados a audiencias ejecutivas y tomadores de decisión
– **anuncios gráficos** — especificaciones y textos para imagen en LinkedIn
– **anuncios de video** — guiones y estructura para video en feed de LinkedIn
– **análisis y optimización** — métricas del Campaign Manager de LinkedIn
– **reportes** — informes de rendimiento con enfoque en pipeline y lead quality

antes de empezar, necesito conocer tu negocio. son 9 preguntas rápidas — quedarán guardadas en tu perfil.`,

  'seo': `hola, soy tu **agente de SEO** en acuarius.

estoy aquí para ayudarte a mejorar el posicionamiento orgánico de tu sitio web en Google y en las IAs como ChatGPT, Claude y Gemini. esto es lo que puedo hacer por ti:

### lo que puedo hacer por ti
– **auditoría técnica** — analizo tu sitio y detecto problemas de velocidad, indexación, estructura y Core Web Vitals
– **investigación de keywords** — encontramos las palabras clave correctas por intención de búsqueda y oportunidad real en LatAm
– **optimización on-page** — mejoro tus title tags, meta descriptions, H1, estructura y contenido para posicionar más rápido
– **análisis de competencia** — identifico qué hacen tus competidores orgánicos y cómo superarlos
– **estrategia de contenidos** — creo un plan editorial SEO con temas, keywords y calendario
– **seguimiento de posiciones** — te ayudo a monitorear rankings y métricas en Google Search Console
– **posicionamiento en IAs (AEO)** — te ayudo a aparecer en las respuestas de ChatGPT, Claude, Gemini y Perplexity — el SEO del futuro

antes de empezar, necesito conocer tu negocio. son 9 preguntas rápidas — quedarán guardadas en tu perfil.`,

  'social': `hola, soy tu **agente de contenido para redes sociales** en acuarius.

mi trabajo es ayudarte a construir una estrategia de contenido real — no genérica. empezamos identificando en qué redes debes estar (y en cuáles no), definimos tu voz y tu parrilla, y te dejo con un plan listo para publicar.

### lo que puedo hacer por ti
– **diagnóstico de redes** — te digo exactamente en qué plataformas debe estar tu negocio y por qué
– **estrategia de contenido** — pilares, formatos, tono de marca y calendario editorial personalizado
– **parrilla mensual** — plan de publicación semana a semana con temas e ideas de contenido
– **guiones y copys** — textos listos para reels, carruseles, stories y posts
– **análisis de rendimiento** — qué métricas importan y cómo mejorar basado en datos

antes de empezar, necesito conocer tu negocio. son 9 preguntas rápidas — quedarán guardadas en tu perfil.`,

  'consultor': `hola, soy tu **consultor de marketing digital** en acuarius.

pienso en tu negocio de forma integral — sin sesgos hacia un canal específico. te ayudo a tomar decisiones estratégicas sobre dónde invertir, qué medir y cómo crecer de forma sostenible.

### lo que puedo hacer por ti
– **estrategia integral** — plan de marketing 360° adaptado a tu negocio y presupuesto
– **distribución de presupuesto** — cómo repartir tu inversión entre canales para maximizar ROI
– **diagnóstico de canales** — qué plataformas te convienen y cuáles no para tu caso
– **medición y ROI** — cómo saber si tu marketing está funcionando y qué ajustar
– **stack de herramientas** — qué herramientas necesitas y cuáles son prescindibles

antes de empezar, necesito entender tu situación. son 8 preguntas rápidas — quedarán guardadas en tu perfil.`
};

// Alias para compatibilidad
const SYSTEM_GUIDES = AGENT_GUIDES;

function showAgentGuide(agentKey) { openAgent(agentKey); }

// Genera clave de localStorage con userId para aislar perfiles por usuario
function getProfileKey(agentKey) {
  const uid = clerkInstance?.user?.id || 'anon';
  // Si hay un cliente de agencia activo, el perfil es independiente por cliente
  if (agencyActiveClientId) {
    return `acuarius_profile_${uid}_${agencyActiveClientId}_${agentKey}`;
  }
  return `acuarius_profile_${uid}_${agentKey}`;
}

// ── Helpers de persistencia en Supabase ──────────────────────────────────────

// ── HISTORIAL DE CONVERSACIONES ──────────────────────────────────────────────

let currentConvId = null;
let convSaveTimer = null;

async function getAuthHeaders() {
  let sessionToken = null;
  if (clerkInstance && clerkInstance.session) {
    try { sessionToken = await clerkInstance.session.getToken(); } catch(e) {}
  }
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
  return headers;
}

async function saveCurrentConversation() {
  if (!hist || hist.length < 2) return;
  if (!currentAgentCtx) return;
  try {
    const headers = await getAuthHeaders();
    const body = { agent: currentAgentCtx, messages: hist };
    if (currentConvId) body.conversationId = currentConvId;
    const res = await fetch('/api/profile?type=conversations&action=save', {
      method: 'POST', headers: headers, body: JSON.stringify(body)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.id && !currentConvId) currentConvId = data.id;
      loadRecentConversations();
    }
  } catch(e) { console.warn('saveCurrentConversation error:', e); }
}


async function loadRecentConversations() {
  const sectionEl = document.getElementById('recientes-section');
  const listEl = document.getElementById('recientes-list');
  if (!listEl || !sectionEl) return;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/profile?type=conversations&action=list&limit=20', { headers: headers });
    if (!res.ok) return;
    const data = await res.json();
    const convs = data.conversations || [];
    if (convs.length === 0) { sectionEl.style.display = 'none'; return; }
    sectionEl.style.display = 'block';
    listEl.innerHTML = convs.map(function(c) {
      const isActive = c.id === currentConvId;
      const label = agentLabelsHist[c.agent] || c.agent;
      const title = esc(c.title || 'Conversación');
      return '<div class="sb-hist-item' + (isActive ? ' active' : '') + '" onclick="loadConversation(\'' + c.id + '\',\'' + c.agent + '\')" title="' + title + '">' +
        '<div style="display:flex;flex-direction:column;flex:1;min-width:0;gap:1px">' +
        '<div class="sb-hist-title" style="font-size:11px">' + title + '</div>' +
        '<div style="font-size:10px;color:var(--muted2)">' + label + '</div>' +
        '</div>' +
        '<span class="sb-hist-del" onclick="event.stopPropagation();deleteConversation(\'' + c.id + '\',\'' + c.agent + '\')" title="eliminar">×</span>' +
        '</div>';
    }).join('');
  } catch(e) { console.warn('loadRecentConversations error:', e); }
}

// loadConvHistory: load global recents (agent-specific section hidden)
async function loadConvHistory(agentKey) {
  return loadRecentConversations();
}


async function loadConversation(convId, agentKey) {
  if (convId === currentConvId) return;
  try {
    const headers = await getAuthHeaders();
    const res = await fetch('/api/profile?type=conversations&action=get&id=' + convId, { headers: headers });
    if (!res.ok) return;
    const data = await res.json();
    const conv = data.conversation;
    if (!conv) return;
    if (currentConvId && hist.length >= 2) await saveCurrentConversation();
    if (currentAgentCtx !== agentKey) await openAgent(agentKey);
    currentConvId = convId;
    hist = conv.messages || [];
    const area = document.getElementById('chat-area');
    area.innerHTML = '';
    for (var i = 0; i < hist.length; i++) {
      const msg = hist[i];
      if (msg.role === 'user') {
        const txt = typeof msg.content === 'string' ? msg.content : ((msg.content.find && msg.content.find(function(c){return c.type==='text';})) || {text:'[imagen]'}).text;
        addUser(txt);
      } else if (msg.role === 'assistant') {
        addAgent(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      }
    }
    onDone = true;
    loadRecentConversations();
    scrollB();
  } catch(e) { console.warn('loadConversation error:', e); }
}

async function startNewConversation(agentKey) {
  if (currentConvId && hist.length >= 2) await saveCurrentConversation();
  currentConvId = null;
  await openAgent(agentKey);
}

async function deleteConversation(convId, agentKey) {
  try {
    const headers = await getAuthHeaders();
    await fetch('/api/profile?type=conversations&action=delete&id=' + convId, { method: 'DELETE', headers: headers });
    if (convId === currentConvId) currentConvId = null;
    loadRecentConversations();
  } catch(e) { console.warn('deleteConversation error:', e); }
}


// ── RECIENTES GLOBALES ────────────────────────────────────────────────────────
var agentShortLabel = {
  'google-ads': 'Google Ads',
  'meta-ads': 'Meta Ads',
  'seo': 'SEO',
  'social': 'Redes',
  'consultor': 'Consultor',
  'tiktok-ads': 'TikTok'
};

async function loadRecentConversations() {
  var panel = document.getElementById('sb-recents-panel');
  var listEl = document.getElementById('sb-recents-list');
  if (!panel || !listEl) return;
  try {
    var headers = await getAuthHeaders();
    var res = await fetch('/api/profile?type=conversations&action=list&limit=10', { headers: headers });
    if (!res.ok) return;
    var data = await res.json();
    var convs = data.conversations || [];
    if (convs.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    listEl.innerHTML = convs.map(function(c) {
      var isActive = c.id === currentConvId;
      var title = esc(c.title || 'Conversación');
      var badge = agentShortLabel[c.agent] || c.agent;
      return '<div class="sb-recent-item' + (isActive ? ' active' : '') + '" onclick="loadConversation(\'' + c.id + '\',\'' + c.agent + '\')" title="' + title + '">' +
        '<div class="sb-hist-dot"></div>' +
        '<div class="sb-recent-title">' + title + '</div>' +
        '<span class="sb-recent-badge">' + badge + '</span>' +
        '<span class="sb-recent-del" onclick="event.stopPropagation();deleteConversation(\'' + c.id + '\',\'' + c.agent + '\');loadRecentConversations()" title="eliminar">×</span>' +
        '</div>';
    }).join('');
  } catch(e) { console.warn('loadRecentConversations error:', e); }
}
// ── FIN RECIENTES ─────────────────────────────────────────────────────────────

// ── PANEL MULTI-CLIENTE (AGENCIA) ─────────────────────────────────────────────

const AGENCY_CLIENT_LIMIT = 10; // Plan Agencia estándar
const AGENCY_COLORS = ['#1E2BCC','#7C3AED','#059669','#D97706','#DC2626','#0891B2','#DB2777','#65A30D','#9333EA','#EA580C'];

let agencyClients = [];         // lista cargada de Supabase / localStorage
let agencyEditingId = null;     // null = nuevo, string = editando
let agencySelectedHealth = 'gris';
let agencyActiveClientId = null; // cliente en contexto de chat actual

// ── Inicialización ──────────────────────────────────────────────────────────
async function agencyInit() {
  const isAgency = userPlan === 'agency' || isAdminUser();
  const isPro    = !isAdminUser() && userPlan !== 'agency';

  const agencyBtn = document.getElementById('sb-agency-btn');
  const proBtn    = document.getElementById('sb-pro-btn');
  if (agencyBtn) agencyBtn.style.display = isAgency ? 'block' : 'none';
  if (proBtn)    proBtn.style.display    = isPro    ? 'block' : 'none';

  if (!isAgency && !isPro) return;
  await agencyLoadClients();
  if (isAgency) agencyUpdateSidebarCount();

  // Pro: auto-activar perfil de negocio si ya existe
  if (isPro && agencyClients.length > 0) {
    const proClient = agencyClients.find(c => c.id === 'pro_main') || agencyClients[0];
    if (proClient) {
      agencyActiveClientId = proClient.id;
      activeClientContext = {
        clientId:       proClient.id,
        clientName:     proClient.name || '',
        clientIndustry: proClient.industria || proClient.business || '',
        monthlyBudget:  proClient.presupuesto || '',
        notes:          proClient.descripcion || '',
      };
      // Actualizar sidebar con nombre del negocio
      proUpdateSidebarLabel(proClient);
      // Personalizar saludo en home
      if (document.getElementById('home-consultor-hero')) renderClientHomeGreeting(proClient);
    }
  }

  // Pro sin perfil → mostrar banner en home para usuarios existentes
  if (isPro && agencyClients.length === 0) {
    if (document.getElementById('home-consultor-hero')) renderProHomeBanner();
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────
function agencyGetStorageKey() {
  const uid = clerkInstance?.user?.id || 'anon';
  return `acuarius_agency_clients_${uid}`;
}

async function agencyLoadClients() {
  try {
    const headers = {};
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    const res = await fetch('/api/profile?type=agency_clients', { headers });
    if (res.ok) {
      const { data } = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        agencyClients = data;
        agencyPersistLocal();
        return;
      }
    }
  } catch(e) {}
  // Fallback localStorage
  try {
    const raw = localStorage.getItem(agencyGetStorageKey());
    agencyClients = raw ? JSON.parse(raw) : [];
  } catch(e) { agencyClients = []; }
}

async function agencyPersistRemote() {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    await fetch('/api/profile?type=agency_clients', {
      method: 'POST', headers,
      body: JSON.stringify({ data: agencyClients })
    });
  } catch(e) {}
}

function agencyPersistLocal() {
  try { localStorage.setItem(agencyGetStorageKey(), JSON.stringify(agencyClients)); } catch(e) {}
}

async function agencyPersist() {
  agencyPersistLocal();
  await agencyPersistRemote();
}

// ── Render ────────────────────────────────────────────────────────────────────
function agencyRender() {
  const grid = document.getElementById('agency-grid');
  const empty = document.getElementById('agency-empty');
  const total = agencyClients.length;
  const limit = isAdminUser() ? 999 : AGENCY_CLIENT_LIMIT;

  // Stats
  document.getElementById('ag-stat-total').textContent = total;
  document.getElementById('ag-stat-verde').textContent = agencyClients.filter(c => c.health === 'verde').length;
  document.getElementById('ag-stat-alerta').textContent = agencyClients.filter(c => c.health === 'amarillo' || c.health === 'rojo').length;

  // Limit bar
  const pct = Math.min(100, Math.round((total / limit) * 100));
  const fill = document.getElementById('agency-limit-fill');
  const txt  = document.getElementById('agency-limit-text');
  if (fill) { fill.style.width = pct + '%'; fill.className = 'agency-limit-fill' + (pct >= 100 ? ' danger' : pct >= 80 ? ' warning' : ''); }
  if (txt)  txt.textContent = `${total} / ${limit === 999 ? '∞' : limit} clientes`;

  // Add btn state
  const addBtn = document.getElementById('agency-add-btn');
  if (addBtn) { addBtn.disabled = total >= limit && !isAdminUser(); }

  // Sidebar count
  agencyUpdateSidebarCount();

  if (total === 0) {
    if (empty) empty.style.display = 'block';
    // Clear cards except empty
    const cards = grid.querySelectorAll('.agency-card');
    cards.forEach(c => c.remove());
    return;
  }
  if (empty) empty.style.display = 'none';

  // Build cards
  const existing = {};
  grid.querySelectorAll('.agency-card').forEach(c => { existing[c.dataset.id] = c; });
  const rendered = new Set();

  agencyClients.forEach((client, idx) => {
    rendered.add(client.id);
    const color = AGENCY_COLORS[idx % AGENCY_COLORS.length];
    const initials = (client.name || '?').split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    const avatarStyle = client.logo
      ? `background:${color};background-image:url('${client.logo}');background-size:cover;background-position:center`
      : `background:${color}`;
    const avatarContent = client.logo ? '' : initials;
    const healthClass = client.health || 'gris';
    const healthLabels = { verde: 'Bien', amarillo: 'Atención', rojo: 'Urgente', gris: 'Sin definir' };
    const dateStr = client.createdAt ? new Date(client.createdAt).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : '';

    const html = `
      <div class="agency-card-top">
        <div class="agency-card-avatar" style="${avatarStyle}">${avatarContent}</div>
        <div class="agency-card-menu">
          <button class="agency-card-menu-btn" onclick="agencyToggleDropdown(event,'dd-${client.id}')" title="opciones">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
          </button>
          <div class="agency-card-dropdown" id="dd-${client.id}">
            <div class="agency-card-dd-item" onclick="agencyEditClient('${client.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              editar
            </div>
            <div class="agency-card-dd-item" onclick="agencyChangeHealth('${client.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              cambiar estado
            </div>
            <div class="agency-card-dd-item danger" onclick="agencyDeleteClient('${client.id}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              eliminar
            </div>
          </div>
        </div>
      </div>
      <div class="agency-card-name" title="${esc(client.name)}">${esc(client.name)}</div>
      <div class="agency-card-business">${esc(client.business || 'Sin descripción')}</div>
      <div class="agency-card-footer">
        <div class="agency-health ${healthClass}" onclick="agencyChangeHealth('${client.id}')">
          <div class="agency-health-dot"></div>
          ${healthLabels[healthClass] || 'Sin definir'}
        </div>
        <button class="agency-report-btn" onclick="warOpen('${client.id}')" title="Generar reporte para WhatsApp">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
          reporte
        </button>
      </div>
      <div class="agency-card-agents">
        <span class="agency-agents-label">Abrir en</span>
        <button class="agency-agent-chip google" title="Google Ads" onclick="openAgentForClient('google-ads',agencyClients.find(x=>x.id==='${client.id}'))">G</button>
        <button class="agency-agent-chip meta" title="Meta Ads" onclick="openAgentForClient('meta-ads',agencyClients.find(x=>x.id==='${client.id}'))">f</button>
        <button class="agency-agent-chip seo" title="SEO" onclick="openAgentForClient('seo',agencyClients.find(x=>x.id==='${client.id}'))">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </button>
        <button class="agency-agent-chip consultor" title="Consultor" onclick="openAgentForClient('consultor',agencyClients.find(x=>x.id==='${client.id}'))">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        </button>
        <button class="agency-agent-chip vista" title="Vista general" onclick="agencyOpenClient('${client.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
      </div>
    `;

    if (existing[client.id]) {
      existing[client.id].innerHTML = html;
    } else {
      const card = document.createElement('div');
      card.className = 'agency-card';
      card.dataset.id = client.id;
      card.innerHTML = html;
      grid.appendChild(card);
    }
  });

  // Remove stale cards
  Object.keys(existing).forEach(id => {
    if (!rendered.has(id)) existing[id].remove();
  });
}

function agencyUpdateSidebarCount() {
  const el = document.getElementById('sb-agency-count');
  if (el) el.textContent = agencyClients.length;
}

// ── Brief profesional multi-paso ─────────────────────────────────────────────
let briefCurrentStep = 0;
const BRIEF_TOTAL_STEPS = 8;
let briefLogoDataUrl = null; // base64 del logo del cliente

function agencyOpenModal(editId = null) {
  const isPro  = !isAdminUser() && userPlan !== 'agency';
  const limit  = isAdminUser() ? 999 : isPro ? 1 : AGENCY_CLIENT_LIMIT;
  // Pro solo puede tener 1 perfil; si ya existe, siempre abrir en edición
  const resolvedEditId = isPro && !editId && agencyClients.length > 0
    ? (agencyClients.find(c => c.id === 'pro_main')?.id || agencyClients[0].id)
    : editId;
  if (!resolvedEditId && agencyClients.length >= limit && !isPro) {
    alert(`Has alcanzado el límite de ${limit} clientes en tu plan. Contacta a soporte para ampliar tu plan.`);
    return;
  }
  agencyEditingId = resolvedEditId;
  agencySelectedHealth = 'gris';
  briefCurrentStep = 0;
  briefLogoDataUrl = null;

  if (isPro) {
    document.getElementById('agency-modal-title').textContent = resolvedEditId ? 'Editar perfil de mi negocio' : 'Perfil de mi negocio';
    document.getElementById('agency-modal-sub').textContent = resolvedEditId
      ? 'Actualiza la información de tu negocio para mantener el contexto actualizado'
      : 'Esta información personaliza todos los agentes de Acuarius para tu negocio';
  } else {
    document.getElementById('agency-modal-title').textContent = resolvedEditId ? 'Editar brief de cliente' : 'Brief de cliente';
    document.getElementById('agency-modal-sub').textContent = resolvedEditId
      ? 'Actualiza la información del perfil del cliente'
      : 'Completa el perfil para que todos los agentes tengan contexto desde el inicio';
  }

  // Reset todos los campos
  const fieldIds = ['ag-f-name','ag-f-pais','ag-f-ciudad','ag-f-web',
    'ag-f-descripcion','ag-f-industria','ag-f-modelo','ag-f-ticket','ag-f-ciclo','ag-f-competidores',
    'ag-f-audiencia','ag-f-edad','ag-f-genero','ag-f-problema','ag-f-diferenciador',
    'ag-f-presupuesto','ag-f-pixel','ag-f-funciono','ag-f-nofunciono',
    'ag-f-kpi','ag-f-meta-costo','ag-f-crm','ag-f-resultados',
    'ag-f-propuesta','ag-f-keywords-marca','ag-f-evitar','ag-f-notas',
    'ag-f-colores','ag-f-productos'];
  fieldIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Reset chips
  document.querySelectorAll('.agency-chip').forEach(c => c.classList.remove('sel'));
  // Reset health
  document.querySelectorAll('.agency-health-opt').forEach(o => o.className = 'agency-health-opt');
  document.querySelector('[data-val="gris"]').className = 'agency-health-opt selected-gris';
  // Reset logo preview
  agencyResetLogoPreview();

  // Cargar datos si es edición
  if (resolvedEditId) {
    const c = agencyClients.find(x => x.id === resolvedEditId);
    if (c) briefFillForm(c);
  }

  briefGoStep(0);
  document.getElementById('agency-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('ag-f-name')?.focus(), 100);
}

function briefFillForm(c) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  set('ag-f-name', c.name);
  set('ag-f-pais', c.pais);
  set('ag-f-ciudad', c.ciudad);
  set('ag-f-web', c.web);
  set('ag-f-descripcion', c.descripcion);
  set('ag-f-industria', c.industria);
  set('ag-f-modelo', c.modelo);
  set('ag-f-ticket', c.ticket);
  set('ag-f-ciclo', c.ciclo);
  set('ag-f-competidores', c.competidores);
  set('ag-f-audiencia', c.audiencia);
  set('ag-f-edad', c.edad);
  set('ag-f-genero', c.genero);
  set('ag-f-problema', c.problema);
  set('ag-f-diferenciador', c.diferenciador);
  set('ag-f-presupuesto', c.presupuesto);
  set('ag-f-pixel', c.pixel);
  set('ag-f-funciono', c.funciono);
  set('ag-f-nofunciono', c.nofunciono);
  set('ag-f-kpi', c.kpi);
  set('ag-f-meta-costo', c.metaCosto);
  set('ag-f-crm', c.crm);
  set('ag-f-resultados', c.resultados);
  set('ag-f-propuesta', c.propuesta);
  set('ag-f-keywords-marca', c.keywordsMarca);
  set('ag-f-evitar', c.evitar);
  set('ag-f-notas', c.notes);
  set('ag-f-colores', c.colores);
  set('ag-f-productos', c.productos);
  // Chip estilo visual
  if (c.estiloVisual) document.querySelectorAll('[data-g="estilo-visual"]').forEach(ch => { if (ch.textContent.trim() === c.estiloVisual) ch.classList.add('sel'); });
  // Chips
  if (c.canales) c.canales.split(', ').forEach(v => {
    document.querySelectorAll('[data-g="canales"]').forEach(ch => { if (ch.textContent.trim() === v) ch.classList.add('sel'); });
  });
  if (c.objetivo) document.querySelectorAll('[data-g="objetivo"]').forEach(ch => { if (ch.textContent.trim() === c.objetivo) ch.classList.add('sel'); });
  if (c.tono) document.querySelectorAll('[data-g="tono"]').forEach(ch => { if (ch.textContent.trim() === c.tono) ch.classList.add('sel'); });
  if (c.tipoOferta) document.querySelectorAll('[data-g="tipo-oferta"]').forEach(ch => { if (ch.textContent.trim().includes(c.tipoOferta.replace(/^[^\s]+\s/,'').split('/')[0].trim())) ch.classList.add('sel'); });
  // Chips multiselección edad
  if (c.edad) c.edad.split(', ').forEach(v => {
    document.querySelectorAll('[data-g="edad"]').forEach(ch => { if (ch.textContent.trim() === v) ch.classList.add('sel'); });
  });
  // Chips reporte
  if (c.frecuenciaReporte) document.querySelectorAll('[data-g="frecuencia-reporte"]').forEach(ch => { if (ch.textContent.trim() === c.frecuenciaReporte) ch.classList.add('sel'); });
  if (c.canalReporte) document.querySelectorAll('[data-g="canal-reporte"]').forEach(ch => { if (ch.textContent.trim() === c.canalReporte) ch.classList.add('sel'); });
  // Contacto
  set('ag-f-contacto-nombre', c.contactoNombre);
  set('ag-f-contacto-cargo', c.contactoCargo);
  set('ag-f-whatsapp', c.whatsapp);
  set('ag-f-email', c.email);
  set('ag-f-contacto2', c.contacto2);
  // Logo
  if (c.logo) {
    briefLogoDataUrl = c.logo;
    agencyShowLogoPreview(c.logo);
  }
  agencySelectHealth(c.health || 'gris');
}

function briefGoStep(step) {
  briefCurrentStep = step;
  // Panels
  document.querySelectorAll('.agency-step-panel').forEach((p, i) => {
    p.classList.toggle('active', i === step);
  });
  // Pills nav
  document.querySelectorAll('.agency-step-pill').forEach((p, i) => {
    p.className = 'agency-step-pill' + (i === step ? ' active' : i < step ? ' done' : '');
  });
  // Progress bar
  const pct = Math.round(((step + 1) / BRIEF_TOTAL_STEPS) * 100);
  const fill = document.getElementById('brief-progress');
  if (fill) fill.style.width = pct + '%';
  // Buttons
  const prev = document.getElementById('brief-btn-prev');
  const next = document.getElementById('brief-btn-next');
  if (prev) prev.style.display = step === 0 ? 'none' : 'block';
  if (next) {
    if (step === BRIEF_TOTAL_STEPS - 1) {
      next.textContent = 'guardar cliente';
    } else {
      next.textContent = 'continuar →';
    }
  }
  // Scroll body al top
  const body = document.querySelector('.agency-modal-body');
  if (body) body.scrollTop = 0;
}

function agencyGoStep(step) {
  // Solo permite ir a pasos ya completados (hacia atrás) o el actual
  if (step <= briefCurrentStep) briefGoStep(step);
}

function agencyBriefNext() {
  // Validar paso actual antes de avanzar
  if (briefCurrentStep === 0) {
    const name = document.getElementById('ag-f-name')?.value.trim();
    if (!name) {
      document.getElementById('ag-f-name')?.focus();
      document.getElementById('ag-f-name')?.style && (document.getElementById('ag-f-name').style.borderColor = 'var(--danger)');
      setTimeout(() => { const el = document.getElementById('ag-f-name'); if (el) el.style.borderColor = ''; }, 2000);
      return;
    }
  }
  if (briefCurrentStep < BRIEF_TOTAL_STEPS - 1) {
    briefGoStep(briefCurrentStep + 1);
  } else {
    agencySaveClient();
  }
}

function agencyBriefPrev() {
  if (briefCurrentStep > 0) briefGoStep(briefCurrentStep - 1);
}

function agencyToggleChip(chip) {
  chip.classList.toggle('sel');
}

function agencyToggleChipSingle(chip) {
  const group = chip.dataset.g;
  document.querySelectorAll(`.agency-chip[data-g="${group}"]`).forEach(c => c.classList.remove('sel'));
  chip.classList.add('sel');
}

function agencyCloseModal() {
  document.getElementById('agency-modal').style.display = 'none';
  agencyEditingId = null;
  briefCurrentStep = 0;
  briefLogoDataUrl = null;
}

// ── Logo del cliente ──────────────────────────────────────────────────────────
function agencyHandleLogo(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { alert('El logo debe ser menor a 2MB.'); return; }
  const reader = new FileReader();
  reader.onload = function(e) {
    briefLogoDataUrl = e.target.result;
    agencyShowLogoPreview(briefLogoDataUrl);
  };
  reader.readAsDataURL(file);
  input.value = ''; // reset so same file can be re-selected
}

function agencyShowLogoPreview(dataUrl) {
  const preview = document.getElementById('logo-preview');
  const placeholder = document.getElementById('logo-placeholder');
  const removeWrap = document.getElementById('logo-remove-wrap');
  if (!preview) return;
  placeholder.style.display = 'none';
  // Remove old img if any
  const oldImg = preview.querySelector('img');
  if (oldImg) oldImg.remove();
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:10px';
  preview.appendChild(img);
  if (removeWrap) removeWrap.style.display = '';
}

function agencyRemoveLogo() {
  briefLogoDataUrl = null;
  agencyResetLogoPreview();
}

function agencyResetLogoPreview() {
  const preview = document.getElementById('logo-preview');
  const placeholder = document.getElementById('logo-placeholder');
  const removeWrap = document.getElementById('logo-remove-wrap');
  if (!preview) return;
  const oldImg = preview.querySelector('img');
  if (oldImg) oldImg.remove();
  if (placeholder) placeholder.style.display = '';
  if (removeWrap) removeWrap.style.display = 'none';
}

// ── Conectar plataformas desde el brief ───────────────────────────────────────
function agencyConnectPlatform(platform) {
  const metaToken = sessionStorage.getItem('meta_access_token');
  const adsToken  = sessionStorage.getItem('ads_access_token');

  // Si ya está conectado, no cerrar el modal — solo informar y dejar continuar
  if (platform === 'meta' && metaToken) {
    alert('✅ Tu cuenta de Meta Ads ya está conectada. Guarda el cliente y luego selecciona la cuenta publicitaria correcta desde la configuración del agente de Meta Ads.');
    return;
  }
  if (platform === 'google' && adsToken) {
    alert('✅ Tu cuenta de Google Ads ya está conectada. Guarda el cliente para continuar.');
    return;
  }

  // No conectado: guardar el formulario en localStorage antes del redirect
  try {
    const formSnapshot = briefReadForm();
    localStorage.setItem('acuarius_pending_brief', JSON.stringify({
      formData:  formSnapshot,
      editingId: agencyEditingId || null,
      health:    agencySelectedHealth || 'gris',
      platform,
      ts:        Date.now(),
    }));
  } catch(e) {}

  agencyCloseModal();

  if (platform === 'meta') {
    // Redirigir al OAuth de Meta
    const uid = clerkInstance?.user?.id || '';
    window.location.href = '/api/meta-auth' + (uid ? '?userId=' + encodeURIComponent(uid) : '');
  } else {
    openSettings();
    setTimeout(function() {
      alert('Ve a la sección Google Ads en configuración para conectar tu cuenta.');
    }, 600);
  }
}

// Restaurar brief pendiente si el usuario volvió de un OAuth
(function restorePendingBrief() {
  const raw = localStorage.getItem('acuarius_pending_brief');
  if (!raw) return;
  try {
    const saved = JSON.parse(raw);
    // Descartar si tiene más de 30 min (evitar restaurar un formulario viejo)
    if (Date.now() - saved.ts > 30 * 60 * 1000) { localStorage.removeItem('acuarius_pending_brief'); return; }
    // Solo restaurar si el OAuth fue exitoso (meta_token en sessionStorage)
    const metaOK = saved.platform === 'meta' && !!sessionStorage.getItem('meta_access_token');
    const googleOK = saved.platform === 'google' && !!sessionStorage.getItem('ads_access_token');
    if (!metaOK && !googleOK) return;
    localStorage.removeItem('acuarius_pending_brief');
    // Esperar a que la app esté lista antes de abrir el modal
    setTimeout(function() {
      try {
        agencyOpenAddClient(saved.editingId);
        setTimeout(function() {
          if (saved.formData) briefFillForm(saved.formData);
          if (saved.health) agencySelectHealth(saved.health);
          // Ir al último paso directamente
          briefGoStep(BRIEF_TOTAL_STEPS - 1);
        }, 300);
      } catch(e) {}
    }, 2000);
  } catch(e) { localStorage.removeItem('acuarius_pending_brief'); }
})();

function agencySelectHealth(val) {
  agencySelectedHealth = val;
  document.querySelectorAll('.agency-health-opt').forEach(o => {
    o.className = 'agency-health-opt' + (o.dataset.val === val ? ` selected-${val}` : '');
  });
}

function briefReadForm() {
  const val = id => document.getElementById(id)?.value.trim() || '';
  const chips = g => [...document.querySelectorAll(`.agency-chip[data-g="${g}"].sel`)].map(c => c.textContent.trim()).join(', ');
  return {
    name:             val('ag-f-name'),
    pais:             val('ag-f-pais'),
    ciudad:           val('ag-f-ciudad'),
    web:              val('ag-f-web'),
    descripcion:      val('ag-f-descripcion'),
    industria:        val('ag-f-industria'),
    modelo:           val('ag-f-modelo'),
    ticket:           val('ag-f-ticket'),
    ciclo:            val('ag-f-ciclo'),
    competidores:     val('ag-f-competidores'),
    audiencia:        val('ag-f-audiencia'),
    edad:             chips('edad'),       // multiselección via chips
    genero:           val('ag-f-genero'),
    problema:         val('ag-f-problema'),
    diferenciador:    val('ag-f-diferenciador'),
    canales:          chips('canales'),
    presupuesto:      val('ag-f-presupuesto'),
    pixel:            val('ag-f-pixel'),
    funciono:         val('ag-f-funciono'),
    nofunciono:       val('ag-f-nofunciono'),
    objetivo:         chips('objetivo'),
    kpi:              val('ag-f-kpi'),
    metaCosto:        val('ag-f-meta-costo'),
    crm:              val('ag-f-crm'),
    resultados:       val('ag-f-resultados'),
    tono:             chips('tono'),
    tipoOferta:       chips('tipo-oferta'),
    estiloVisual:     chips('estilo-visual'),
    colores:          val('ag-f-colores'),
    productos:        val('ag-f-productos'),
    propuesta:        val('ag-f-propuesta'),
    keywordsMarca:    val('ag-f-keywords-marca'),
    evitar:           val('ag-f-evitar'),
    notes:            val('ag-f-notas'),
    // Paso 7 — Contacto
    contactoNombre:   val('ag-f-contacto-nombre'),
    contactoCargo:    val('ag-f-contacto-cargo'),
    whatsapp:         val('ag-f-whatsapp'),
    email:            val('ag-f-email'),
    contacto2:        val('ag-f-contacto2'),
    frecuenciaReporte:chips('frecuencia-reporte'),
    canalReporte:     chips('canal-reporte'),
    // Logo
    logo:             briefLogoDataUrl || null,
    health:           agencySelectedHealth,
    // Campos legacy para compatibilidad con renderCard
    business:         val('ag-f-industria') || val('ag-f-descripcion').slice(0, 60),
  };
}

async function agencySaveClient() {
  const btn = document.getElementById('brief-btn-next');
  if (btn) { btn.disabled = true; btn.textContent = 'guardando...'; }
  const now = new Date().toISOString();
  const data = briefReadForm();
  if (!data.name) {
    if (btn) { btn.disabled = false; btn.textContent = 'guardar cliente'; }
    briefGoStep(0);
    return;
  }

  const isPro = !isAdminUser() && userPlan !== 'agency';

  if (agencyEditingId) {
    const idx = agencyClients.findIndex(c => c.id === agencyEditingId);
    if (idx !== -1) agencyClients[idx] = { ...agencyClients[idx], ...data, updatedAt: now };
  } else {
    // Pro siempre usa id fijo 'pro_main'
    const newId = isPro ? 'pro_main' : 'ac_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
    agencyClients.push({ id: newId, ...data, createdAt: now, updatedAt: now });
  }

  await agencyPersist();
  agencyCloseModal();

  if (isPro) {
    // Auto-activar perfil y personalizar experiencia
    const proClient = agencyClients.find(c => c.id === 'pro_main') || agencyClients[0];
    if (proClient) {
      agencyActiveClientId = proClient.id;
      activeClientContext = {
        clientId:       proClient.id,
        clientName:     proClient.name || '',
        clientIndustry: proClient.industria || proClient.business || '',
        monthlyBudget:  proClient.presupuesto || '',
        notes:          proClient.descripcion || '',
      };
      proUpdateSidebarLabel(proClient);
      renderClientHomeGreeting(proClient);
    }
    // Si hay un agente pendiente, abrirlo ahora
    if (pendingAgentAfterSetup) {
      const ag = pendingAgentAfterSetup;
      pendingAgentAfterSetup = null;
      setTimeout(() => openAgent(ag), 400);
    }
  } else {
    agencyRender();
  }

  if (btn) { btn.disabled = false; btn.textContent = 'guardar cliente'; }
}

function agencyEditClient(id) {
  agencyCloseAllDropdowns();
  agencyOpenModal(id);
}

// Eliminar cliente desde la barra de contexto activo (botón en header)
async function agencyResetClientProfile(id) {
  const c = agencyClients.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Eliminar el perfil de "${c.name}"?\n\nEsto borrará:\n• El perfil del cliente\n• El entrenamiento de todos los agentes\n• El historial de conversaciones\n• El progreso de la hoja de ruta\n\nPodrás crear un perfil nuevo inmediatamente.`)) return;
  agencyExitClientContext();
  await agencyDeleteClient(id, true); // true = skip second confirm
}

async function agencyDeleteClient(id, skipConfirm = false) {
  agencyCloseAllDropdowns();
  const c = agencyClients.find(x => x.id === id);
  if (!c) return;
  if (!skipConfirm && !confirm(`¿Eliminar el perfil de "${c.name}"?\n\nEsto borrará el entrenamiento de todos los agentes y el historial de conversaciones de este cliente.`)) return;
  agencyClients = agencyClients.filter(x => x.id !== id);
  // Limpiar todo el localStorage relacionado con este cliente
  try {
    const uid = clerkInstance?.user?.id || 'anon';
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.includes(`_${id}`)) localStorage.removeItem(k);
    }
  } catch(e) {}
  await agencyPersist();
  agencyRender();
}

// ── Health change inline ──────────────────────────────────────────────────────
function agencyChangeHealth(id) {
  agencyCloseAllDropdowns();
  const c = agencyClients.find(x => x.id === id);
  if (!c) return;
  const order = ['verde','amarillo','rojo','gris'];
  const next = order[(order.indexOf(c.health || 'gris') + 1) % order.length];
  c.health = next;
  c.updatedAt = new Date().toISOString();
  agencyPersist();
  agencyRender();
}

// ── Abrir cliente en contexto de chat ────────────────────────────────────────
async function agencyOpenClient(id) {
  agencyCloseAllDropdowns();
  const c = agencyClients.find(x => x.id === id);
  if (!c) return;

  // Setear el clientId activo
  agencyActiveClientId = id;

  // Setear activeClientContext para inyeccion en system prompt
  activeClientContext = {
    clientId:       c.id,
    clientName:     c.client_name || c.name || '',
    clientIndustry: c.client_industry || c.industria || c.business || '',
    monthlyBudget:  c.monthly_budget || c.presupuesto || '',
    notes:          c.notes || c.descripcion || '',
  };

  // Ir a la pantalla de inicio con saludo personalizado del cliente
  showView('home');
  agencyShowContextBar(c);
  renderClientHomeGreeting(c);
}

function renderClientHomeGreeting(client) {
  // Personalizar el saludo con el nombre del cliente
  const greeting = document.getElementById('home-greeting');
  if (greeting) {
    const h = new Date().getHours();
    const t = h < 12 ? 'buenos días' : h < 18 ? 'buenas tardes' : 'buenas noches';
    greeting.textContent = `${t} — trabajando con ${client.name} 👋`;
  }

  // Reemplazar el hero del consultor con una bienvenida contextual del cliente
  const heroEl = document.getElementById('home-consultor-hero');
  if (!heroEl) return;

  const industria   = client.industria   || client.business || '';
  const descripcion = client.descripcion || '';
  const tono        = client.tono        || '';
  const canales     = client.canales     || '';
  const ciudad      = client.ciudad      ? ` · ${client.ciudad}` : '';
  const logoChar    = (client.name || 'C')[0].toUpperCase();

  // Construir contexto del cliente para mostrar en la bienvenida
  const contextLines = [
    industria ? `<span style="background:rgba(124,58,237,.12);color:#6D28D9;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600">${industria}</span>` : '',
    canales   ? `<span style="font-size:11px;color:#7C3AED;opacity:.8">Canales: ${canales}</span>` : '',
  ].filter(Boolean).join('  ');

  heroEl.innerHTML = `
    <div style="width:48px;height:48px;border-radius:14px;background:#7C3AED;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;font-size:20px;font-weight:700;color:#fff">
      ${client.logo ? `<img src="${client.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:14px"/>` : logoChar}
    </div>
    <div style="flex:1;min-width:0">
      <div style="font-size:15px;font-weight:700;color:#4C1D95;margin-bottom:4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${client.name}
        <span style="font-size:10px;font-weight:600;background:#7C3AED;color:#fff;padding:2px 8px;border-radius:20px;letter-spacing:.3px">CLIENTE ACTIVO</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">${contextLines}</div>
      ${descripcion ? `<div style="font-size:11.5px;color:#6D28D9;opacity:.85;line-height:1.4;margin-top:2px">${descripcion.slice(0, 120)}${descripcion.length > 120 ? '...' : ''}</div>` : ''}
    </div>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0;opacity:.7"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  `;

  // Mantener el onclick para que al hacer clic en el hero vaya al consultor con el cliente
  heroEl.onclick = () => openAgent('consultor');
}

function agencyShowContextBar(client) {
  // Remover barra anterior si existe
  const existing = document.getElementById('agency-ctx-bar');
  if (existing) existing.remove();

  const chatView = document.getElementById('view-chat');
  if (!chatView) return;

  const bar = document.createElement('div');
  bar.className = 'agency-ctx-bar';
  bar.id = 'agency-ctx-bar';
  bar.innerHTML = `
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3.87-3.87"/></svg>
    <span class="agency-ctx-name">Trabajando con: <strong>${esc(client.name)}</strong></span>
    <span style="color:var(--muted);font-size:11px">${esc(client.business || '')}</span>
    <button class="agency-ctx-report" onclick="warOpen(agencyActiveClientId)" title="Generar reporte para WhatsApp">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      reporte WA
    </button>
    <button class="agency-ctx-exit" onclick="agencyResetClientProfile(agencyActiveClientId)" title="Eliminar perfil y reiniciar entrenamiento de agentes" style="background:transparent;border:1px solid rgba(239,68,68,.35);color:#EF4444;font-size:10.5px;font-weight:600;padding:3px 9px;border-radius:20px;cursor:pointer;font-family:var(--font);margin-right:2px;transition:all .15s" onmouseover="this.style.background='rgba(239,68,68,.08)'" onmouseout="this.style.background='transparent'">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:middle;margin-right:3px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>eliminar perfil
    </button>
    <button class="agency-ctx-exit" onclick="agencyExitClientContext()" title="Salir del contexto de este cliente">✕ salir</button>
  `;
  // Insertar después de la barra de navegación (nav), antes del chat-area
  chatView.insertBefore(bar, chatView.firstChild);
}

function agencyLoadClientHistory(clientId) {
  try {
    const uid = clerkInstance?.user?.id || 'anon';
    const key = `acuarius_history_${uid}_${clientId}_${currentAgentCtx || 'google-ads'}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw);
      hist = saved;
      // Renderizar mensajes anteriores brevemente
      if (saved.length > 0) {
        const chatArea = document.getElementById('chat-area');
        if (chatArea) {
          const note = document.createElement('div');
          note.style.cssText = 'text-align:center;padding:12px 0;font-size:12px;color:var(--muted2);border-bottom:1px solid var(--border2);margin-bottom:8px';
          note.textContent = `${saved.filter(m=>m.role==='user').length} consultas anteriores con este cliente`;
          chatArea.appendChild(note);
        }
      }
    }
  } catch(e) {}
}

function agencySaveClientHistory() {
  if (!agencyActiveClientId) return;
  try {
    const uid = clerkInstance?.user?.id || 'anon';
    const key = `acuarius_history_${uid}_${agencyActiveClientId}_${currentAgentCtx || 'google-ads'}`;
    localStorage.setItem(key, JSON.stringify(hist.slice(-40))); // últimos 40 mensajes
  } catch(e) {}
}

function agencyExitClientContext() {
  // Limpiar contexto de cliente
  agencyActiveClientId = null;
  const bar = document.getElementById('agency-ctx-bar');
  if (bar) bar.remove();
  // Volver al panel de clientes
  showView('agency');
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function agencyToggleDropdown(event, ddId) {
  event.stopPropagation();
  agencyCloseAllDropdowns();
  const dd = document.getElementById(ddId);
  if (dd) dd.classList.toggle('open');
}

function agencyCloseAllDropdowns() {
  document.querySelectorAll('.agency-card-dropdown.open').forEach(d => d.classList.remove('open'));
}

function agencyOpenAgentDropdown(event, ddId) {
  event.stopPropagation();
  agencyCloseAllDropdowns();
  const dd = document.getElementById(ddId);
  if (dd) dd.classList.toggle('open');
}

// Cerrar dropdowns al hacer click fuera
document.addEventListener('click', agencyCloseAllDropdowns);

// ── Hook en sendMsg para guardar historial del cliente activo ─────────────────
// (Se engancha al flujo existente de sendMsg — guardado al recibir respuesta)
function agencyOnMessageReceived() {
  if (agencyActiveClientId) agencySaveClientHistory();
}

// ── FIN PANEL AGENCIA ─────────────────────────────────────────────────────────

// ── REPORTE WHATSAPP ──────────────────────────────────────────────────────────

const WAR_PLATFORMS = {
  google:   { name: 'Google Ads',   color: '#4285F4' },
  meta:     { name: 'Meta Ads',     color: '#1877F2' },
  tiktok:   { name: 'TikTok Ads',  color: '#010101' },
  linkedin: { name: 'LinkedIn Ads', color: '#0A66C2' },
};

// KPIs por plataforma — los más relevantes de cada una
const WAR_KPIS_BY_PLATFORM = {
  google: [
    { id:'inversion',      label:'Inversión total',   prefix:'$' },
    { id:'impresiones',    label:'Impresiones' },
    { id:'clics',          label:'Clics' },
    { id:'ctr',            label:'CTR',               suffix:'%' },
    { id:'cpc',            label:'CPC promedio',      prefix:'$' },
    { id:'conversiones',   label:'Conversiones' },
    { id:'cpa',            label:'CPA',               prefix:'$' },
    { id:'roas',           label:'ROAS',              suffix:'x' },
    { id:'quality_score',  label:'Quality Score' },
    { id:'impression_share',label:'Impression Share', suffix:'%' },
  ],
  meta: [
    { id:'inversion',      label:'Inversión total',   prefix:'$' },
    { id:'alcance',        label:'Alcance' },
    { id:'impresiones',    label:'Impresiones' },
    { id:'frecuencia',     label:'Frecuencia' },
    { id:'cpm',            label:'CPM',               prefix:'$' },
    { id:'clics',          label:'Clics (link)' },
    { id:'ctr',            label:'CTR (link)',         suffix:'%' },
    { id:'leads',          label:'Leads' },
    { id:'cpr',            label:'Costo por resultado',prefix:'$' },
    { id:'roas',           label:'ROAS',              suffix:'x' },
  ],
  tiktok: [
    { id:'inversion',      label:'Inversión total',   prefix:'$' },
    { id:'impresiones',    label:'Impresiones' },
    { id:'alcance',        label:'Alcance' },
    { id:'reproducciones', label:'Reproducciones' },
    { id:'vtr',            label:'VTR (View-Through)', suffix:'%' },
    { id:'cpv',            label:'CPV',               prefix:'$' },
    { id:'clics',          label:'Clics' },
    { id:'ctr',            label:'CTR',               suffix:'%' },
    { id:'conversiones',   label:'Conversiones' },
    { id:'cpa',            label:'CPA',               prefix:'$' },
  ],
  linkedin: [
    { id:'inversion',      label:'Inversión total',   prefix:'$' },
    { id:'impresiones',    label:'Impresiones' },
    { id:'clics',          label:'Clics' },
    { id:'ctr',            label:'CTR',               suffix:'%' },
    { id:'cpc',            label:'CPC',               prefix:'$' },
    { id:'leads_b2b',      label:'Leads calificados' },
    { id:'cpl_b2b',        label:'CPL',               prefix:'$' },
    { id:'aperturas',      label:'Aperturas de mensaje' },
    { id:'conexiones',     label:'Solicitudes de conexión' },
  ],
};

// Estado de KPIs seleccionados por plataforma (incluye personalizados)
let warSelectedKpis = {}; // { google: ['inversion','clics',...], meta: [...] }
let warCustomKpis   = {}; // { google: [{id:'custom_0', label:'Mi métrica'}], ... }

let warClientId = null;
let warStep = 0;
let warPeriod = 'mes';
let warGeneratedText = null;
const WAR_TOTAL_STEPS = 5;

function warOpen(clientId) {
  const client = agencyClients.find(c => c.id === clientId);
  if (!client) return;
  warClientId = clientId;
  warStep = 0;
  warPeriod = 'mes';
  warGeneratedText = null;
  warSelectedKpis = {};
  warCustomKpis   = {};

  // Pre-seleccionar KPIs más importantes de cada plataforma
  Object.keys(WAR_KPIS_BY_PLATFORM).forEach(plat => {
    const defaults = ['inversion','clics','conversiones','cpa','roas','leads','ctr','alcance'];
    warSelectedKpis[plat] = WAR_KPIS_BY_PLATFORM[plat]
      .filter(k => defaults.includes(k.id))
      .map(k => k.id);
    warCustomKpis[plat] = [];
  });

  document.getElementById('war-title').textContent = 'Reporte: ' + client.name;
  const hasWa = client.whatsapp;
  document.getElementById('war-sub').textContent = hasWa
    ? 'Se enviará a ' + (client.contactoNombre || client.name) + ' · ' + client.whatsapp
    : 'Genera el reporte y cópialo para enviarlo por WhatsApp';

  // Reset preview
  document.getElementById('war-generating').style.display = 'none';
  document.getElementById('war-preview-wrap').style.display = 'none';

  warGoStep(0);
  document.getElementById('war-overlay').style.display = 'flex';
}

function warGoStep(step) {
  warStep = step;
  document.querySelectorAll('.war-step').forEach((s, i) => s.classList.toggle('active', i === step));
  document.querySelectorAll('.war-tab').forEach((t, i) => {
    t.className = 'war-tab' + (i === step ? ' active' : i < step ? ' done' : '');
  });

  // Footer buttons
  const prev = document.getElementById('war-btn-prev');
  const next = document.getElementById('war-btn-next');
  const copy = document.getElementById('war-btn-copy');
  const wa   = document.getElementById('war-btn-wa');
  const info = document.getElementById('war-footer-info');

  prev.style.display = step === 0 ? 'none' : 'block';
  copy.style.display = 'none';
  wa.style.display   = 'none';

  if (step === WAR_TOTAL_STEPS - 1) {
    next.style.display = 'none';
    if (warGeneratedText) {
      copy.style.display = 'flex';
      const client = agencyClients.find(c => c.id === warClientId);
      if (client?.whatsapp) wa.style.display = 'flex';
    } else {
      next.style.display = 'block';
      next.textContent = 'Generar reporte';
      next.style.background = '#25D366';
    }
    info.textContent = warGeneratedText ? 'Reporte listo ✓' : '';
  } else {
    next.style.display = 'block';
    next.textContent = 'continuar →';
    next.style.background = '';
    info.textContent = '';
  }

  // Build KPI step when arriving at step 1
  if (step === 1) warBuildKpiStep();
  // Build metrics form when arriving at step 3
  if (step === 3) warBuildMetricsForm();

  // Scroll to top
  const body = document.querySelector('.war-body');
  if (body) body.scrollTop = 0;
}

function warNext() {
  if (warStep === 0) {
    const sel = document.querySelectorAll('.war-platform-card.sel');
    if (sel.length === 0) { alert('Selecciona al menos una plataforma.'); return; }
  }
  if (warStep === 1) {
    const sel = document.querySelectorAll('.war-kpi-chip.sel');
    if (sel.length === 0) { alert('Selecciona al menos un KPI.'); return; }
  }
  if (warStep === 2 && warPeriod === 'custom') {
    const from = document.getElementById('war-date-from')?.value;
    const to   = document.getElementById('war-date-to')?.value;
    if (!from || !to) { alert('Selecciona el rango de fechas.'); return; }
  }
  if (warStep === WAR_TOTAL_STEPS - 1) {
    warGenerate(); return;
  }
  if (warStep < WAR_TOTAL_STEPS - 1) warGoStep(warStep + 1);
}

function warPrev() {
  if (warStep > 0) {
    warGeneratedText = null;
    warGoStep(warStep - 1);
  }
}

function warTogglePlatform(card) {
  card.classList.toggle('sel');
}

function warToggleKpi(chip) {
  const plat = chip.dataset.plat;
  const kpi  = chip.dataset.kpi;
  chip.classList.toggle('sel');
  if (chip.classList.contains('sel')) {
    if (!warSelectedKpis[plat]) warSelectedKpis[plat] = [];
    if (!warSelectedKpis[plat].includes(kpi)) warSelectedKpis[plat].push(kpi);
  } else {
    warSelectedKpis[plat] = (warSelectedKpis[plat] || []).filter(k => k !== kpi);
  }
}

function warAddCustomKpi(plat) {
  const label = prompt('Nombre de la métrica personalizada:');
  if (!label || !label.trim()) return;
  const id = 'custom_' + Date.now();
  if (!warCustomKpis[plat]) warCustomKpis[plat] = [];
  warCustomKpis[plat].push({ id, label: label.trim() });
  if (!warSelectedKpis[plat]) warSelectedKpis[plat] = [];
  warSelectedKpis[plat].push(id);
  // Re-render KPI step
  warBuildKpiStep();
}

function warBuildKpiStep() {
  const container = document.getElementById('war-kpi-sections');
  if (!container) return;
  const platforms = [...document.querySelectorAll('.war-platform-card.sel')].map(c => c.dataset.plat);

  const platIcons = {
    google:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>',
    meta:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    tiktok:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="#010101"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.78a4.85 4.85 0 01-1.01-.09z"/></svg>',
    linkedin: '<svg width="14" height="14" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/></svg>',
  };

  container.innerHTML = platforms.map(plat => {
    const platInfo = WAR_PLATFORMS[plat] || { name: plat };
    const kpis     = WAR_KPIS_BY_PLATFORM[plat] || [];
    const customs  = warCustomKpis[plat] || [];
    const selected = warSelectedKpis[plat] || [];

    const standardChips = kpis.map(k =>
      '<div class="war-kpi-chip' + (selected.includes(k.id) ? ' sel' : '') + '" data-plat="' + plat + '" data-kpi="' + k.id + '" onclick="warToggleKpi(this)">' + k.label + '</div>'
    ).join('');

    const customChips = customs.map(k =>
      '<div class="war-kpi-chip sel" style="border-style:dashed" data-plat="' + plat + '" data-kpi="' + k.id + '" onclick="warToggleKpi(this)">' + k.label + ' ✕</div>'
    ).join('');

    return '<div style="margin-bottom:18px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--text)">' + (platIcons[plat]||'') + platInfo.name + '</div>' +
        '<button onclick="warAddCustomKpi(\'' + plat + '\')" style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;font-family:var(--font);font-weight:600">+ personalizada</button>' +
      '</div>' +
      '<div class="war-kpi-grid">' + standardChips + customChips + '</div>' +
    '</div>';
  }).join('');
}

function warSetPeriod(btn) {
  document.querySelectorAll('.war-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  warPeriod = btn.dataset.p;
  const customDates = document.getElementById('war-custom-dates');
  if (customDates) customDates.style.display = warPeriod === 'custom' ? 'block' : 'none';
}

function warBuildMetricsForm() {
  const container = document.getElementById('war-metrics-container');
  if (!container) return;
  const platforms = [...document.querySelectorAll('.war-platform-card.sel')].map(c => c.dataset.plat);
  const platIcons = {
    google:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>',
    meta:'<svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    tiktok:'<svg width="16" height="16" viewBox="0 0 24 24" fill="#010101"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.78a4.85 4.85 0 01-1.01-.09z"/></svg>',
    linkedin:'<svg width="16" height="16" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/></svg>',
  };
  container.innerHTML = platforms.map(plat => {
    const platInfo = WAR_PLATFORMS[plat] || { name: plat };
    const selKpis  = warSelectedKpis[plat] || [];
    const customK  = warCustomKpis[plat]   || [];
    const allKpis  = [...(WAR_KPIS_BY_PLATFORM[plat] || []), ...customK];
    const labelMap = {};
    allKpis.forEach(k => { labelMap[k.id] = k.label; });
    const fields = selKpis.map(kid => {
      const label = labelMap[kid] || kid;
      return '<div class="war-metric-field"><label>' + label + '</label><input type="text" id="war-' + plat + '-' + kid + '" placeholder="ej. 1200"></div>';
    }).join('');
    return '<div class="war-platform-section"><div class="war-platform-header">' + (platIcons[plat]||'') + '<span class="war-platform-label">' + platInfo.name + '</span></div><div class="war-metrics-grid">' + fields + '</div></div>';
  }).join('');
}

function warGetMetricData() {
  const platforms = [...document.querySelectorAll('.war-platform-card.sel')].map(c => c.dataset.plat);
  const result = {};
  const kpisPerPlat = {};
  platforms.forEach(plat => {
    result[plat] = {};
    kpisPerPlat[plat] = warSelectedKpis[plat] || [];
    kpisPerPlat[plat].forEach(kpi => {
      const el = document.getElementById('war-' + plat + '-' + kpi);
      result[plat][kpi] = el?.value.trim() || '';
    });
  });
  return { platforms, kpis: kpisPerPlat, data: result };
}

function warCalcDates() {
  // Calcula las fechas reales según el período seleccionado
  const today = new Date();
  const fmt = d => d.toISOString().slice(0, 10); // YYYY-MM-DD
  const fmtHuman = d => d.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });

  if (warPeriod === 'custom') {
    const from = document.getElementById('war-date-from')?.value || '';
    const to   = document.getElementById('war-date-to')?.value   || '';
    if (from && to) {
      const dFrom = new Date(from + 'T00:00:00');
      const dTo   = new Date(to   + 'T00:00:00');
      return { from, to, label: fmtHuman(dFrom) + ' al ' + fmtHuman(dTo) };
    }
    return { from: null, to: null, label: 'período personalizado' };
  }

  let dFrom, dTo;
  if (warPeriod === 'semana') {
    // Lunes al domingo de la semana anterior
    const day = today.getDay(); // 0=dom, 1=lun...
    const diffToLastMonday = day === 0 ? 6 : day - 1; // días desde el lunes actual
    dTo   = new Date(today); dTo.setDate(today.getDate() - diffToLastMonday - 1); // domingo anterior
    dFrom = new Date(dTo);   dFrom.setDate(dTo.getDate() - 6);                    // lunes anterior
  } else if (warPeriod === 'mes') {
    // Mes calendario anterior completo
    dFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    dTo   = new Date(today.getFullYear(), today.getMonth(), 0);
  } else { // trimestre
    // Trimestre anterior completo
    const q = Math.floor(today.getMonth() / 3); // 0-3
    const qStart = q === 0 ? -3 : (q - 1) * 3; // mes inicio trimestre anterior
    dFrom = new Date(today.getFullYear(), qStart < 0 ? today.getFullYear() - 1 : today.getFullYear(), qStart < 0 ? 9 : qStart, 1);
    dFrom = new Date(today.getFullYear() - (q === 0 ? 1 : 0), q === 0 ? 9 : (q - 1) * 3, 1);
    dTo   = new Date(today.getFullYear() - (q === 0 ? 1 : 0), q === 0 ? 12 : q * 3, 0);
  }

  return {
    from:  fmt(dFrom),
    to:    fmt(dTo),
    label: fmtHuman(dFrom) + ' al ' + fmtHuman(dTo)
  };
}

function warPeriodLabel() {
  return warCalcDates().label;
}

let warReportUrl = null; // URL pública del reporte guardado en Supabase

async function warGenerate() {
  const client = agencyClients.find(c => c.id === warClientId);
  if (!client) return;

  const { platforms, kpis, data } = warGetMetricData();
  const dates  = warCalcDates(); // fechas reales calculadas
  const periodo = dates.label;   // "3 de noviembre al 17 de noviembre de 2025"

  // Build metrics summary for prompt — usa los labels reales de cada plataforma
  const metricsText = platforms.map(plat => {
    const platName = WAR_PLATFORMS[plat]?.name || plat;
    const selKpis  = kpis[plat] || [];
    const allKpisInfo = [...(WAR_KPIS_BY_PLATFORM[plat] || []), ...(warCustomKpis[plat] || [])];
    const labelMap = {};
    allKpisInfo.forEach(k => { labelMap[k.id] = { label: k.label, prefix: k.prefix, suffix: k.suffix }; });

    const vals = selKpis.map(kid => {
      const v = data[plat][kid];
      if (!v) return null;
      const info = labelMap[kid] || { label: kid };
      const formatted = info.prefix ? info.prefix + v : v + (info.suffix || '');
      return info.label + ': ' + formatted;
    }).filter(Boolean).join(' | ');
    return platName + ':\n' + (vals || 'Sin datos ingresados');
  }).join('\n\n');

  // Client context from brief
  const clientCtx = [
    'Cliente: ' + client.name,
    client.industria  ? 'Industria: ' + client.industria : '',
    client.objetivo   ? 'Objetivo principal: ' + client.objetivo : '',
    client.kpi        ? 'KPI acordado: ' + client.kpi + (client.metaCosto ? ' · Meta: ' + client.metaCosto : '') : '',
    client.resultados ? 'Resultados esperados: ' + client.resultados : '',
    client.propuesta  ? 'Propuesta de valor: ' + client.propuesta : '',
  ].filter(Boolean).join('\n');

  const prompt =
    'Eres el especialista de marketing de una agencia digital. Redacta el mensaje de WhatsApp que acompaña el envío del reporte de campañas del ' + periodo + ' al cliente.\n\n' +
    'CONTEXTO DEL CLIENTE:\n' + clientCtx + '\n\n' +
    'DATOS DEL PERÍODO (' + periodo + '):\n' + metricsText + '\n\n' +
    'INSTRUCCIONES:\n' +
    '- Saludo breve (1 línea) con el período\n' +
    '- Para cada plataforma, resume 2-3 métricas clave con *negritas* en los números (formato WhatsApp)\n' +
    '- 1-2 líneas de interpretación: si los resultados van bien, regular o necesitan ajuste\n' +
    '- Menciona que adjuntas el reporte completo con el enlace que vendrá a continuación\n' +
    '- Cierre con disposición para reunión o preguntas\n' +
    '- Máximo 200 palabras, tono profesional pero cercano\n' +
    '- NO menciones "Acuarius"\n' +
    '- Emojis con moderación (máx 4)\n\n' +
    'Devuelve ÚNICAMENTE el texto del mensaje WhatsApp, sin comillas ni explicaciones.';

  // Show loading
  warReportUrl = null;
  document.getElementById('war-btn-next').style.display = 'none';
  document.getElementById('war-generating').style.display = 'block';
  document.getElementById('war-preview-wrap').style.display = 'none';

  try {
    // 1. Generar texto con IA
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;

    const r = await fetch('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        system: 'Eres un especialista en marketing digital que redacta reportes ejecutivos concisos para agencias en Latinoamérica. Respondes siempre en español.',
        userPlan
      })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);

    // Leer stream SSE
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = '', fullText = '', streamDone = false;
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const sseLines = sseBuffer.split('\n');
      sseBuffer = sseLines.pop();
      for (const line of sseLines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6).trim());
          if (evt.delta !== undefined) fullText += evt.delta;
          if (evt.done && evt.full !== undefined) { fullText = evt.full; streamDone = true; }
        } catch {}
      }
    }
    const text = fullText.trim();
    if (!text) throw new Error('Sin respuesta del modelo');

    warGeneratedText = text;

    // 2. Guardar reporte en Supabase y obtener URL pública
    try {
      const dateFrom = dates.from || document.getElementById('war-date-from')?.value || null;
      const dateTo   = dates.to   || document.getElementById('war-date-to')?.value   || null;
      const rptHeaders = { 'Content-Type': 'application/json' };
      if (sessionToken) rptHeaders['Authorization'] = 'Bearer ' + sessionToken;

      const rptRes = await fetch('/api/report', {
        method: 'POST', headers: rptHeaders,
        body: JSON.stringify({
          clientId:    client.id,
          clientName:  client.name,
          agencyName:  null, // futuro: nombre de la agencia del usuario
          platforms,
          kpis,           // { google: ['inversion','clics',...], meta: [...] }
          metrics:     data,
          period:      warPeriod,
          dateFrom,
          dateTo,
          summary:     text,
        })
      });
      if (rptRes.ok) {
        const { url } = await rptRes.json();
        warReportUrl = url || null;
      }
    } catch (e) {
      console.warn('warGenerate: no se pudo guardar el reporte en Supabase:', e);
      // No es fatal — el texto ya está generado
    }

    warShowPreview(text, warReportUrl);

  } catch (err) {
    console.error('warGenerate error:', err);
    document.getElementById('war-generating').style.display = 'none';
    document.getElementById('war-btn-next').style.display = 'block';
    document.getElementById('war-btn-next').textContent = 'Generar reporte';
    document.getElementById('war-btn-next').style.background = '#25D366';
    alert('Error al generar el reporte. Verifica tu conexión e intenta de nuevo.');
  }
}

function warShowPreview(text, reportUrl) {
  document.getElementById('war-generating').style.display = 'none';

  // Texto completo del mensaje WA = resumen IA + link al reporte
  const fullMessage = reportUrl
    ? text + '\n\n📊 Ver reporte completo: ' + reportUrl
    : text;
  warGeneratedText = fullMessage;

  const formatted = fullMessage
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*(.*?)\*/g,'<b>$1</b>')
    .replace(/_(.*?)_/g,'<i>$1</i>')
    .replace(/\n/g,'<br>');

  document.getElementById('war-bubble-text').innerHTML = formatted;
  const now = new Date();
  document.getElementById('war-bubble-time').textContent =
    now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ' ✓✓';

  document.getElementById('war-preview-wrap').style.display = 'block';

  // Footer
  document.getElementById('war-btn-copy').style.display = 'flex';
  const client = agencyClients.find(c => c.id === warClientId);
  if (client?.whatsapp) document.getElementById('war-btn-wa').style.display = 'flex';
  const infoEl = document.getElementById('war-footer-info');
  infoEl.innerHTML = reportUrl
    ? 'Reporte guardado · <a href="' + reportUrl + '" target="_blank" style="color:var(--blue);text-decoration:none;font-weight:600">ver enlace</a>'
    : 'Reporte listo ✓';
}

function warSend() {
  if (!warGeneratedText) return;
  const client = agencyClients.find(c => c.id === warClientId);
  const phone  = client?.whatsapp?.replace(/[\s\-\(\)]/g,'') || '';
  const url = phone
    ? 'https://wa.me/' + phone + '?text=' + encodeURIComponent(warGeneratedText)
    : 'https://wa.me/?text=' + encodeURIComponent(warGeneratedText);
  window.open(url, '_blank');
}

function warCopy() {
  if (!warGeneratedText) return;
  navigator.clipboard.writeText(warGeneratedText).then(() => {
    const btn = document.getElementById('war-btn-copy');
    const orig = btn.innerHTML;
    btn.innerHTML = '✓ copiado';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  });
}

function warClose() {
  document.getElementById('war-overlay').style.display = 'none';
  warClientId = null;
  warGeneratedText = null;
  warReportUrl = null;
}

// ── FIN REPORTE WHATSAPP ──────────────────────────────────────────────────────

// ── PRODUCT TOUR ──────────────────────────────────────────────────────────────

var TOUR_STEPS = [
  {
    title: 'Bienvenido a Acuarius 👋',
    desc: 'Tu plataforma de agentes de marketing con IA para Latinoamérica. Este tour rápido te muestra cómo sacarle el máximo provecho.',
    target: null,
    position: 'center'
  },
  {
    title: 'Tu centro de comando',
    desc: 'Desde esta pantalla puedes elegir el agente con el que quieres trabajar. También puedes hacerlo desde el menú lateral — es exactamente lo mismo.',
    target: 'view-home',
    position: 'center'
  },
  {
    title: 'Consultor de Marketing',
    desc: '¿No sabes por dónde empezar? El Consultor analiza tu negocio y te dice qué canales priorizar, cómo distribuir tu presupuesto y qué hacer primero.',
    target: 'home-consultor-hero',
    position: 'bottom'
  },
  {
    title: 'Agentes especializados',
    desc: 'Cada agente domina un canal: Google Ads, Meta Ads, SEO, TikTok y más. Haz clic en cualquiera para empezar a trabajar con él.',
    target: 'home-agents-grid',
    position: 'top'
  },
  {
    title: 'Menú lateral',
    desc: 'Aquí tienes acceso rápido a todos los agentes. Haz clic en cualquiera para ver sus acciones disponibles y empezar una conversación.',
    target: 'sidebar',
    position: 'right'
  },
  {
    title: 'Hoja de ruta',
    desc: 'Cada agente tiene una hoja de ruta con checklists por etapa: qué configurar, qué optimizar y qué métricas revisar según en qué momento estás.',
    target: 'rm-panel',
    position: 'left',
    onEnter: function() { openAgent('google-ads'); setTimeout(openRoadmap, 600); },
    onExit: function() { document.getElementById('rm-panel').classList.remove('open'); document.getElementById('rm-panel-overlay').classList.remove('open'); }
  },
  {
    title: 'Conecta tus plataformas',
    desc: 'Desde Configuración puedes conectar tu cuenta de Google Ads y Meta Ads. Cuando están conectadas, los agentes pueden leer tus datos en tiempo real.',
    target: 'settings-panel',
    position: 'settings',
    onEnter: function() { openSettings(); },
    onExit: function() { document.getElementById('settings-panel').style.display='none'; document.getElementById('settings-overlay').style.display='none'; }
  },
  {
    title: 'Historial de conversaciones',
    desc: 'Todas tus consultas quedan guardadas aquí. Puedes retomar cualquier conversación anterior exactamente donde la dejaste.',
    target: 'sb-recents-panel',
    position: 'right-safe'
  },
  {
    title: '¡Listo para empezar! 🚀',
    desc: 'Tu perfil de negocio se guarda automáticamente. Cada agente lo usa para darte respuestas personalizadas. ¡Elige un agente y empieza!',
    target: 'mem-card',
    position: 'right-safe'
  }
];

var tourStep = 0;
var tourActive = false;

function tourStart() {
  if (tourActive) return;
  tourActive = true;
  tourStep = 0;
  var overlay = document.getElementById('tour-overlay');
  var tooltip = document.getElementById('tour-tooltip');
  var spotlight = document.getElementById('tour-spotlight');
  overlay.style.display = 'block';
  if (tooltip) tooltip.style.display = '';
  if (spotlight) { spotlight.style.opacity = ''; spotlight.style.boxShadow = ''; }
  overlay.classList.add('active');
  document.getElementById('tour-backdrop').classList.add('active');
  
  // Build dots
  var dots = document.getElementById('tour-dots');
  dots.innerHTML = TOUR_STEPS.map(function(_, i) {
    return '<div class="tour-dot" id="tour-dot-' + i + '"></div>';
  }).join('');
  
  tourShow(0);
}

function tourShow(idx) {
  // Call onExit of previous step
  var prevStep = TOUR_STEPS[tourStep];
  if (idx !== tourStep && prevStep && prevStep.onExit) {
    try { prevStep.onExit(); } catch(e) {}
  }
  tourStep = idx;
  var step = TOUR_STEPS[idx];
  var total = TOUR_STEPS.length;
  // Call onEnter of new step
  if (step.onEnter) {
    setTimeout(function() { try { step.onEnter(); } catch(e) {} }, 100);
  }
  
  // Update text
  document.getElementById('tour-step-label').textContent = 'paso ' + (idx + 1) + ' de ' + total;
  document.getElementById('tour-title').textContent = step.title;
  document.getElementById('tour-desc').textContent = step.desc;
  
  // Update dots
  TOUR_STEPS.forEach(function(_, i) {
    var d = document.getElementById('tour-dot-' + i);
    if (d) d.className = 'tour-dot' + (i === idx ? ' active' : '');
  });
  
  // Update button
  var btn = document.getElementById('tour-btn-next');
  if (idx === total - 1) {
    btn.innerHTML = 'empezar <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  } else {
    btn.innerHTML = 'siguiente <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M6 2l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  
  // Position spotlight and tooltip
  tourPosition(step);
}

function tourPosition(step) {
  var spotlight = document.getElementById('tour-spotlight');
  var tooltip = document.getElementById('tour-tooltip');
  var pad = 8;
  
  if (step.position === 'center') {
    // No spotlight — just center tooltip
    spotlight.style.opacity = '0';
    spotlight.style.width = '0';
    spotlight.style.height = '0';
    tooltip.style.top = '50%';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
    return;
  }
  
  var el = document.getElementById(step.target);
  if (!el) {
    spotlight.style.opacity = '0';
    tooltip.style.top = '50%';
    tooltip.style.left = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
    return;
  }
  
  var rect = el.getBoundingClientRect();
  
  // Spotlight
  spotlight.style.opacity = '1';
  spotlight.style.left = (rect.left - pad) + 'px';
  spotlight.style.top = (rect.top - pad) + 'px';
  spotlight.style.width = (rect.width + pad * 2) + 'px';
  spotlight.style.height = (rect.height + pad * 2) + 'px';
  tooltip.style.transform = 'none';
  
  var ttw = 300;
  var tth = 200; // approx
  var margin = 16;
  
  var winH = window.innerHeight;
  var winW = window.innerWidth;
  if (step.position === 'left') {
    tooltip.style.left = Math.max(16, rect.left - ttw - margin - pad) + 'px';
    tooltip.style.top = Math.max(16, Math.min(rect.top + rect.height / 2 - tth / 2, winH - tth - 16)) + 'px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
  } else if (step.position === 'left-panel') {
    tooltip.style.left = Math.max(16, rect.left - ttw - margin) + 'px';
    tooltip.style.top = Math.max(80, Math.min(rect.top + 80, winH - tth - 16)) + 'px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
  } else if (step.position === 'settings') {
    // Position tooltip just to the left of the settings panel, near top
    setTimeout(function() {
      var panel = document.getElementById('settings-panel');
      if (!panel) return;
      var pr = panel.getBoundingClientRect();
      var tt = document.getElementById('tour-tooltip');
      tt.style.left = Math.max(16, pr.left - ttw - 20) + 'px';
      tt.style.top = Math.max(80, pr.top + 60) + 'px';
      tt.style.right = 'auto';
      tt.style.bottom = 'auto';
    }, 400);
    // Initial position while panel animates in
    tooltip.style.left = (winW - 520 - ttw - 20) + 'px';
    tooltip.style.top = '80px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
  } else if (step.position === 'right') {
    tooltip.style.left = (rect.right + margin + pad) + 'px';
    tooltip.style.top = Math.max(16, Math.min(rect.top + rect.height / 2 - tth / 2, winH - tth - 16)) + 'px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
  } else if (step.position === 'right-safe') {
    // Sidebar elements — always visible, never below viewport
    tooltip.style.left = Math.min(rect.right + margin + pad, winW - ttw - 16) + 'px';
    tooltip.style.top = Math.max(80, Math.min(rect.top, winH - tth - 24)) + 'px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
    // Scroll element into view
    if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (step.position === 'bottom') {
    tooltip.style.top = Math.min(rect.bottom + margin + pad, winH - tth - 16) + 'px';
    tooltip.style.left = Math.max(16, Math.min(rect.left + rect.width / 2 - ttw / 2, winW - ttw - 16)) + 'px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
  } else if (step.position === 'top') {
    tooltip.style.top = Math.max(16, rect.top - tth - margin - pad) + 'px';
    tooltip.style.left = Math.max(16, Math.min(rect.left + rect.width / 2 - ttw / 2, winW - ttw - 16)) + 'px';
    tooltip.style.right = 'auto';
    tooltip.style.bottom = 'auto';
  }
}

function tourNext() {
  if (tourStep >= TOUR_STEPS.length - 1) {
    tourEnd();
    return;
  }
  tourShow(tourStep + 1);
}

function tourSkip() {
  tourEnd();
}

function tourEnd() {
  tourActive = false;
  // Call onExit of current step if any
  var curStep = TOUR_STEPS[tourStep];
  if (curStep && curStep.onExit) { try { curStep.onExit(); } catch(e) {} }
  var overlay = document.getElementById('tour-overlay');
  var backdrop = document.getElementById('tour-backdrop');
  var spotlight = document.getElementById('tour-spotlight');
  var tooltip = document.getElementById('tour-tooltip');
  overlay.classList.remove('active');
  backdrop.classList.remove('active');
  spotlight.style.opacity = '0';
  spotlight.style.boxShadow = 'none';
  spotlight.style.width = '0';
  spotlight.style.height = '0';
  if (tooltip) tooltip.style.display = 'none';
  if (overlay) { overlay.style.display = 'none'; overlay.style.pointerEvents = 'none'; }
  if (backdrop) { backdrop.style.background = 'rgba(0,0,0,0)'; backdrop.style.pointerEvents = 'none'; }
  // Mark as seen
  try {
    localStorage.setItem('acuarius_tour_done', '1');
    sessionStorage.setItem('acuarius_tour_done', '1');
  } catch(e) {}
}

function tourShouldShow() {
  try {
    // Check both localStorage and sessionStorage
    if (localStorage.getItem('acuarius_tour_done')) return false;
    if (sessionStorage.getItem('acuarius_tour_done')) return false;
    return true;
  } catch(e) { return false; }
}

// ── FIN TOUR ──────────────────────────────────────────────────────────────────

async function dbSaveProfile(agentKey, data) {
  // Clave de Supabase incluye el clientId si hay cliente de agencia activo
  const scopedAgent = agencyActiveClientId ? `client_${agencyActiveClientId}_${agentKey}` : agentKey;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    await fetch(`/api/profile?type=profile&agent=${encodeURIComponent(scopedAgent)}`, {
      method: 'POST', headers, body: JSON.stringify({ data })
    });
    localStorage.setItem(getProfileKey(agentKey), JSON.stringify(data));
  } catch(e) {
    console.warn('dbSaveProfile error:', e);
    localStorage.setItem(getProfileKey(agentKey), JSON.stringify(data));
  }
}

async function dbLoadProfile(agentKey) {
  const scopedAgent = agencyActiveClientId ? `client_${agencyActiveClientId}_${agentKey}` : agentKey;
  try {
    const headers = {};
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
    const res = await fetch(`/api/profile?type=profile&agent=${encodeURIComponent(scopedAgent)}`, { headers });
    if (res.ok) {
      const { data } = await res.json();
      if (data && Object.keys(data).length > 0) return data;
    }
  } catch(e) {
    console.warn('dbLoadProfile error:', e);
  }
  // Fallback localStorage — clave exacta incluye clientId si hay cliente activo
  const exactKey = getProfileKey(agentKey);
  const val = localStorage.getItem(exactKey);
  if (val) {
    try {
      const parsed = JSON.parse(val);
      if (parsed && Object.keys(parsed).length > 0) return parsed;
    } catch {}
  }
  // Si hay clientId activo, NO hacer fallback al perfil del usuario principal → lanzar onboarding
  if (agencyActiveClientId) return null;
  // Fallback legacy solo para usuario principal
  const uid = clerkInstance?.user?.id || 'anon';
  const keysToTry = [
    `acuarius_profile_${uid}_${agentKey}`,
    `acuarius_profile_anon_${agentKey}`,
  ];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.includes(`_${agentKey}`) && k.startsWith('acuarius_profile_') && !k.includes('_client_')) {
      if (!keysToTry.includes(k)) keysToTry.push(k);
    }
  }
  for (const key of keysToTry) {
    const v = localStorage.getItem(key);
    if (v) {
      try {
        const parsed = JSON.parse(v);
        if (parsed && Object.keys(parsed).length > 0) {
          const currentKey = `acuarius_profile_${uid}_${agentKey}`;
          if (key !== currentKey) localStorage.setItem(currentKey, v);
          return parsed;
        }
      } catch {}
    }
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

// Abre un agente: carga perfil si existe, lanza onboarding si no
async function openAgent(agentKey) {
  setAgentContext(agentKey);
  showView('chat');
  updateActiveClientBar();
  // Esperar a que Clerk esté listo Y tenga usuario antes de cargar perfil
  if (!clerkInstance?.user?.id) {
    await new Promise(res => {
      const iv = setInterval(() => {
        if (clerkInstance?.user?.id) { clearInterval(iv); res(); }
      }, 100);
      setTimeout(() => { clearInterval(iv); res(); }, 5000); // max 5s
    });
  }

  // Sidebar sync is handled by toggleAgent — openAgent only manages chat

  const area = document.getElementById('chat-area');
  area.innerHTML = '';
  hist = [];
  currentConvId = null;

  const profile = await dbLoadProfile(agentKey);

  if (profile) {
    try {
      Object.assign(mem, typeof profile === 'string' ? JSON.parse(profile) : profile);
      updateMem();
      onDone = true;
      clientStage = mapStage(mem.etapa);
      document.getElementById('mem-card').style.display = 'block';
      document.getElementById('m-stage').textContent = clientStage;
      const agentLabels = {'google-ads':'Google Ads','meta-ads':'Meta Ads','tiktok-ads':'TikTok Ads','linkedin-ads':'LinkedIn Ads','seo':'SEO','social':'Contenido para Redes','consultor':'Consultor de Marketing'};
      const negocioShort = mem.negocio ? mem.negocio.split('·')[0].trim() : '—';
      addAgent(`hola de nuevo. todo listo para **${negocioShort}**.\n\n¿en qué trabajamos hoy?`);
      if (agentKey === 'meta-ads')     { setTimeout(showMetaActionCards, 400); setTimeout(showMetaAdsDashboard, 600); }
      if (agentKey === 'google-ads')   { setTimeout(showGoogleAdsActionCards, 400); setTimeout(showGoogleAdsDashboard, 600); }
      if (agentKey === 'consultor')    { setTimeout(showConsultorActionCards, 400); }
      if (agentKey === 'seo')          { setTimeout(showSeoActionCards, 400); }
      if (agentKey === 'social')       { setTimeout(showSocialActionCards, 400); }
      if (agentKey === 'tiktok-ads')   { setTimeout(showTikTokActionCards, 400); }
      if (agentKey === 'linkedin-ads') { setTimeout(showLinkedInActionCards, 400); }
      setTimeout(function(){ loadRecentConversations(); }, 700);
      return;
    } catch(e) {
      console.warn('openAgent profile load error:', e);
      // si falla, lanzar onboarding
    }
  }
  launchOnboarding(agentKey);
}

// Lanza onboarding para agente sin perfil
function briefBuildMem(client) {
  // Construye el objeto mem del agente a partir del brief profesional del cliente
  const parts = [];
  if (client.descripcion) parts.push(client.descripcion);
  if (client.industria) parts.push('Industria: ' + client.industria);
  if (client.modelo) parts.push('Modelo: ' + client.modelo);
  if (client.pais) parts.push((client.ciudad ? client.ciudad + ', ' : '') + client.pais);
  return {
    negocio:       client.name || '',
    industria:     client.industria || client.business || '',
    descripcion:   client.descripcion || '',
    objetivo:      client.objetivo || '',
    presupuesto:   client.presupuesto || '',
    etapa:         '',
    // Campos extendidos del brief
    web:           client.web || '',
    audiencia:     client.audiencia || '',
    edad:          client.edad || '',
    genero:        client.genero || '',
    problema:      client.problema || '',
    diferenciador: client.diferenciador || '',
    canales:       client.canales || '',
    kpi:           client.kpi || '',
    metaCosto:     client.metaCosto || '',
    crm:           client.crm || '',
    resultados:    client.resultados || '',
    tono:          client.tono || '',
    propuesta:     client.propuesta || '',
    keywordsMarca: client.keywordsMarca || '',
    evitar:        client.evitar || '',
    competidores:  client.competidores || '',
    ciclo:         client.ciclo || '',
    ticket:        client.ticket || '',
    funciono:      client.funciono || '',
    nofunciono:    client.nofunciono || '',
    pixel:         client.pixel || '',
    notas:         client.notes || '',
    pais:          client.pais || '',
    ciudad:        client.ciudad || '',
    // Contacto (útil para reportes y seguimiento)
    whatsapp:      client.whatsapp || '',
    email:         client.email || '',
    contacto:      client.contactoNombre ? (client.contactoNombre + (client.contactoCargo ? ' · ' + client.contactoCargo : '')) : '',
    frecuenciaReporte: client.frecuenciaReporte || '',
    canalReporte:  client.canalReporte || '',
  };
}

function briefSummaryForAgent(client, agentKey) {
  // Genera un saludo y resumen inicial personalizado por agente usando los datos del brief
  const nombre = client.name || 'el cliente';
  const negocio = client.descripcion || client.business || client.industria || '';
  const pais = [client.ciudad, client.pais].filter(Boolean).join(', ');
  const presupuesto = client.presupuesto ? `Presupuesto: **${client.presupuesto}/mes**` : '';
  const objetivo = client.objetivo ? `Objetivo: **${client.objetivo}**` : '';
  const kpi = client.kpi ? `KPI principal: **${client.kpi}**${client.metaCosto ? ' · Meta: ' + client.metaCosto : ''}` : '';
  const audiencia = client.audiencia ? `Audiencia: ${client.audiencia}` : '';
  const canales = client.canales ? `Canales activos: ${client.canales}` : '';
  const competidores = client.competidores ? `Competidores: ${client.competidores}` : '';
  const tono = client.tono ? `Tono de marca: **${client.tono}**` : '';
  const propuesta = client.propuesta ? `Propuesta de valor: *"${client.propuesta}"*` : '';
  const funciono = client.funciono ? `Lo que ha funcionado: ${client.funciono}` : '';
  const nofunciono = client.nofunciono ? `Lo que NO ha funcionado: ${client.nofunciono}` : '';
  const resultados = client.resultados ? `Resultados esperados: ${client.resultados}` : '';

  const parts = [];
  parts.push('perfil cargado para **' + nombre + '**' + (pais ? ' \u00b7 ' + pais : '') + '.');
  if (negocio) parts.push(negocio);
  const kpis = [presupuesto, objetivo, kpi].filter(Boolean).join(' \u00b7 ');
  if (kpis) parts.push(kpis);
  const ctx2 = [audiencia, canales, competidores].filter(Boolean).join(' | ');
  if (ctx2) parts.push(ctx2);
  const brand = [tono, propuesta, funciono, nofunciono, resultados].filter(Boolean).join(' | ');
  if (brand) parts.push(brand);
  const lines = parts.join('\n').trim();

  const agentGreetings = {
    'google-ads':  '\n\n¿con qué empezamos en Google Ads?',
    'meta-ads':    '\n\n¿qué trabajamos hoy en Meta Ads?',
    'seo':         '\n\n¿por dónde arrancamos con el SEO?',
    'social':      '\n\n¿qué contenido creamos hoy?',
    'consultor':   '\n\n¿en qué te puedo ayudar?',
    'tiktok-ads':  '\n\n¿arrancamos con TikTok Ads?',
  };
  return lines + (agentGreetings[agentKey] || '\n\n¿en qué trabajamos hoy?');
}

function launchOnboarding(agentKey) {
  const isPro = !isAdminUser() && userPlan !== 'agency';

  // Pro sin perfil de negocio → mostrar card de configuración
  if (isPro && agencyClients.length === 0 && !agencyActiveClientId) {
    pendingAgentAfterSetup = agentKey;
    renderProSetupCard(agentKey);
    return;
  }

  // Pro con perfil → auto-activar y usar como contexto (igual que agencia)
  if (isPro && agencyClients.length > 0 && !agencyActiveClientId) {
    const proClient = agencyClients.find(c => c.id === 'pro_main') || agencyClients[0];
    if (proClient) {
      agencyActiveClientId = proClient.id;
      activeClientContext = {
        clientId:       proClient.id,
        clientName:     proClient.name || '',
        clientIndustry: proClient.industria || proClient.business || '',
        monthlyBudget:  proClient.presupuesto || '',
        notes:          proClient.descripcion || '',
      };
      launchOnboarding(agentKey); // Re-llamar con contexto activo
      return;
    }
  }

  // Si hay un cliente de agencia activo con brief completo, no hacer onboarding — usar brief como contexto
  if (agencyActiveClientId) {
    const client = agencyClients.find(c => c.id === agencyActiveClientId);
    if (client && client.name) {
      mem = briefBuildMem(client);
      hist = [];
      onDone = true;
      obStep = 0;
      updateMem();
      document.getElementById('mem-card').style.display = 'block';
      document.getElementById('m-stage').textContent = clientStage;
      const summary = briefSummaryForAgent(client, agentKey);
      addAgent(summary);
      if (agentKey === 'meta-ads')     { setTimeout(showMetaActionCards, 400); setTimeout(showMetaAdsDashboard, 600); }
      if (agentKey === 'google-ads')   { setTimeout(showGoogleAdsActionCards, 400); setTimeout(showGoogleAdsDashboard, 600); }
      if (agentKey === 'consultor')    { setTimeout(showConsultorActionCards, 400); }
      if (agentKey === 'seo')          { setTimeout(showSeoActionCards, 400); }
      if (agentKey === 'social')       { setTimeout(showSocialActionCards, 400); }
      if (agentKey === 'tiktok-ads')   { setTimeout(showTikTokActionCards, 400); }
      if (agentKey === 'linkedin-ads') { setTimeout(showLinkedInActionCards, 400); }
      setTimeout(function(){ loadRecentConversations(); }, 700);
      // Guardar el perfil del brief como perfil del agente para este cliente
      setTimeout(function(){ dbSaveProfile(agentKey, mem); }, 800);
      return;
    }
  }
  // Sin cliente de agencia — flujo normal: siempre lanzar cuestionario para usuarios sin perfil
  mem = {}; hist = []; onDone = false; obStep = 0;
  document.getElementById('mem-card').style.display = 'none';
  const guide = AGENT_GUIDES[agentKey] || AGENT_GUIDES['google-ads'];
  addAgent(guide);
  setTimeout(() => renderOb(), 600);
}

// ── Configuración de negocio para usuarios Pro ────────────────────────────────

// Banner en home para usuarios existentes Pro sin perfil de negocio configurado
function renderProHomeBanner() {
  const heroEl = document.getElementById('home-consultor-hero');
  if (!heroEl) return;

  heroEl.innerHTML =
    '<div style="display:flex;align-items:flex-start;gap:14px;width:100%">' +
      '<div style="width:42px;height:42px;border-radius:12px;background:#7C3AED;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>' +
      '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:13px;font-weight:700;color:#4C1D95;margin-bottom:4px;display:flex;align-items:center;gap:8px">' +
          '✨ Novedad: Perfil de negocio unificado' +
          '<span style="font-size:10px;background:#7C3AED;color:#fff;padding:2px 7px;border-radius:20px;font-weight:600">NUEVO</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#6D28D9;line-height:1.5;margin-bottom:10px">' +
          'Configura tu negocio una sola vez y todos los agentes tendrán contexto completo desde el primer mensaje.' +
        '</div>' +
        '<button onclick="proOpenSetupModal()" style="padding:8px 16px;background:#7C3AED;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font);display:inline-flex;align-items:center;gap:6px" onmouseover="this.style.opacity=\'.85\'" onmouseout="this.style.opacity=\'1\'">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
          'Configurar mi negocio' +
        '</button>' +
      '</div>' +
    '</div>';

  // Clic en el hero también abre el modal
  heroEl.style.cursor = 'default';
  heroEl.onclick = null;
}

function renderProSetupCard(agentKey) {
  const chatBox = document.getElementById('chat-area');
  if (!chatBox) return;

  const agentNames = {
    'google-ads': 'Google Ads', 'meta-ads': 'Meta Ads', 'tiktok-ads': 'TikTok Ads',
    'seo': 'SEO', 'social': 'Contenido para Redes', 'consultor': 'Consultor',
  };
  const agentName = agentNames[agentKey] || 'este agente';

  const el = document.createElement('div');
  el.className = 'msg agent';
  el.innerHTML =
    '<div style="background:var(--bg);border:2px solid #7C3AED;border-radius:16px;padding:24px;max-width:500px;width:100%">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:18px">' +
        '<div style="width:44px;height:44px;border-radius:12px;background:#7C3AED;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:15px;font-weight:700;color:var(--text)">Antes de empezar con ' + agentName + '</div>' +
          '<div style="font-size:12px;color:var(--muted2);margin-top:2px">Configura el perfil de tu negocio una sola vez</div>' +
        '</div>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--muted);line-height:1.6;margin:0 0 16px">' +
        'Para que todos los agentes tengan contexto desde el primer mensaje — industria, audiencia, presupuesto, competencia y tono de marca — necesitamos conocer tu negocio.' +
      '</p>' +
      '<div style="background:#F5F3FF;border-radius:10px;padding:14px;margin-bottom:18px;display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
        '<div style="font-size:11px;color:#6D28D9;display:flex;align-items:center;gap:6px"><span>✓</span> Nombre e industria</div>' +
        '<div style="font-size:11px;color:#6D28D9;display:flex;align-items:center;gap:6px"><span>✓</span> Presupuesto y objetivos</div>' +
        '<div style="font-size:11px;color:#6D28D9;display:flex;align-items:center;gap:6px"><span>✓</span> Audiencia objetivo</div>' +
        '<div style="font-size:11px;color:#6D28D9;display:flex;align-items:center;gap=6px"><span>✓</span> Competencia y tono</div>' +
        '<div style="font-size:11px;color:#6D28D9;display:flex;align-items:center;gap:6px"><span>✓</span> Canales activos</div>' +
        '<div style="font-size:11px;color:#6D28D9;display:flex;align-items:center;gap:6px"><span>✓</span> Lo que funciona (y lo que no)</div>' +
      '</div>' +
      '<button onclick="proOpenSetupModal()" style="width:100%;padding:12px;background:#7C3AED;color:#fff;border:none;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:8px;transition:opacity .15s" onmouseover="this.style.opacity=\'.88\'" onmouseout="this.style.opacity=\'1\'">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
        'Configurar mi negocio ahora' +
      '</button>' +
      '<div style="text-align:center;margin-top:10px;font-size:11px;color:var(--muted2)">Solo toma ~5 minutos · Se guarda para siempre</div>' +
    '</div>';
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function proOpenSetupModal() {
  // Abrir el modal de brief en modo "Mi negocio" para usuarios Pro
  const proClient = agencyClients.find(c => c.id === 'pro_main');
  agencyOpenModal(proClient ? 'pro_main' : null);
}

function proUpdateSidebarLabel(client) {
  const nameEl = document.getElementById('sb-pro-name');
  if (nameEl && client && client.name) nameEl.textContent = client.name;
}

// Cards de acción para Meta Ads
function showMetaActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:stretch;max-width:100%;width:100%;padding:0';

  // helper para cards estándar
  function card(icon, title, desc, onclick) {
    return '<div onclick="' + onclick + '" style="border:1.5px solid var(--border);border-radius:14px;padding:20px 18px;cursor:pointer;background:var(--bg);transition:all .15s;display:flex;flex-direction:column;justify-content:flex-end;min-height:110px" ' +
      'onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 16px rgba(30,43,204,.08)\'" ' +
      'onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\';this.style.boxShadow=\'\'">' +
      '<div style="font-size:26px;margin-bottom:10px">' + icon + '</div>' +
      '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">' + title + '</div>' +
      '<div style="font-size:11px;color:var(--muted2);line-height:1.4">' + desc + '</div>' +
      '</div>';
  }

  el.innerHTML =
    // Header
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
      '<div style="width:32px;height:32px;flex-shrink:0;overflow:hidden;border-radius:8px">' + logoSvg + '</div>' +
      '<div>' +
        '<div style="font-size:15px;font-weight:700;color:var(--text)">Agente Meta Ads</div>' +
        '<div style="font-size:12px;color:var(--muted2)">¿en qué trabajamos hoy?</div>' +
      '</div>' +
    '</div>' +

    // Fila 1: 2 cards destacadas (Publicar campaña + Video ad)
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +

      // Publicar campaña — azul Meta
      '<div onclick="dismissMetaCards(this);launchMetaCampaignFlow()" style="border:2px solid #1877F2;border-radius:14px;padding:20px 18px;cursor:pointer;background:linear-gradient(135deg,#e8f0fe 0%,#dbeafe 100%);transition:all .15s;display:flex;flex-direction:column;justify-content:flex-end;min-height:110px" ' +
        'onmouseover="this.style.background=\'linear-gradient(135deg,#d0e4fd 0%,#bfdbfe 100%)\';this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 20px rgba(24,119,242,.2)\'" ' +
        'onmouseout="this.style.background=\'linear-gradient(135deg,#e8f0fe 0%,#dbeafe 100%)\';this.style.transform=\'\';this.style.boxShadow=\'\'">' +
        '<div style="font-size:26px;margin-bottom:10px">🚀</div>' +
        '<div style="font-size:13px;font-weight:700;color:#1877F2;margin-bottom:3px">Publicar campaña</div>' +
        '<div style="font-size:11px;color:#1877F2;opacity:.8;line-height:1.4">Tengo mis creativos listos y quiero publicar en Facebook o Instagram</div>' +
      '</div>' +

      // Video ad con IA — púrpura
      '<div onclick="dismissMetaCards(this);showVideoAdFormWithContext()" style="border:2px solid #7C3AED;border-radius:14px;padding:20px 18px;cursor:pointer;background:linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%);transition:all .15s;display:flex;flex-direction:column;justify-content:flex-end;min-height:110px" ' +
        'onmouseover="this.style.background=\'linear-gradient(135deg,#EDE9FE 0%,#DDD6FE 100%)\';this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 4px 20px rgba(124,58,237,.2)\'" ' +
        'onmouseout="this.style.background=\'linear-gradient(135deg,#F5F3FF 0%,#EDE9FE 100%)\';this.style.transform=\'\';this.style.boxShadow=\'\'">' +
        '<div style="font-size:26px;margin-bottom:10px">🎬</div>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">' +
          '<div style="font-size:13px;font-weight:700;color:#7C3AED">Crear video ad con IA</div>' +
          '<span style="font-size:9px;background:#7C3AED;color:#fff;padding:2px 6px;border-radius:8px;font-weight:700">NUEVO</span>' +
        '</div>' +
        '<div style="font-size:11px;color:#6D28D9;opacity:.85;line-height:1.4">Video real para Reels o TikTok con Seedance 2.0</div>' +
      '</div>' +

    '</div>' +

    // Fila 2: 3 cards estándar
    '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px">' +
      card('🖼️', 'Crear anuncios de imagen', 'Creativos profesionales para Facebook e Instagram', 'showMetaImageSubCards(this)') +
      card('📋', 'Planear campaña', 'Estructura, objetivos, audiencias y presupuesto', 'dismissMetaCards(this);qSend(\'Ayúdame a planear una campaña completa de Meta Ads (Facebook e Instagram) para mi negocio\')') +
      card('📊', 'Analizar campañas', 'Métricas, optimización y recomendaciones de mejora', 'dismissMetaCards(this);qSend(\'Analizar el rendimiento de mis campañas de Meta Ads y dame recomendaciones de optimización\')') +
    '</div>' +

    // Fila 3: 2 cards estándar
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      card('✍️', 'Crear copys', 'Textos persuasivos para feed, stories y carrusel', 'dismissMetaCards(this);qSend(\'Crear copys profesionales para anuncios de Meta Ads (Facebook e Instagram) para mi negocio\')') +
      card('🩺', 'Diagnosticar campañas', 'Pega tus métricas y te digo dónde estás perdiendo dinero', 'dismissMetaCards(this);showDiagnosticInput(\'meta-ads\')') +
    '</div>';

  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

// Cards de acción para Google Ads
function showGoogleAdsActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--text)">¿qué quieres hacer?</div>' +
    '</div>' +
    '<div style="width:100%;max-width:520px;padding-left:40px">' +

      // Card 0: Crear campaña — destacada full-width
      '<div onclick="dismissGoogleAdsCards(this);launchGoogleCampaignFlow()" style="border:2px solid #1E2BCC;border-radius:14px;padding:18px 20px;cursor:pointer;background:linear-gradient(135deg,#e8eafc 0%,#dbeafe 100%);transition:all .15s;margin-bottom:8px;display:flex;align-items:center;gap:14px" onmouseover="this.style.background=\'#d6d9f7\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.background=\'linear-gradient(135deg,#e8eafc 0%,#dbeafe 100%)\';this.style.transform=\'\'">' +
        '<div style="font-size:28px">🚀</div>' +
        '<div>' +
          '<div style="font-size:14px;font-weight:700;color:#1E2BCC">Crear campaña en Google Ads</div>' +
          '<div style="font-size:12px;color:#4B5ECC;margin-top:2px">Wizard guiado: keywords, RSA y segmentación en minutos</div>' +
        '</div>' +
      '</div>' +

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +

      // Card 1: Analizar y optimizar campaña
      '<div onclick="dismissGoogleAdsCards(this);qSend(\'ANALIZAR Y OPTIMIZAR mi cuenta de Google Ads - necesito una auditoría profesional completa de mis campañas actuales con análisis de métricas, identificación de problemas y recomendaciones priorizadas de mejora\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">' +
        '<div style="font-size:18px;margin-bottom:6px">🔍</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Analizar y optimizar campaña</div>' +
        '<div style="font-size:11px;color:var(--muted2)">Auditoría completa y recomendaciones de mejora</div>' +
      '</div>' +

      // Card 2: Planificar campaña
      '<div onclick="dismissGoogleAdsCards(this);showPlanningQuestionnaire()" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">' +
        '<div style="font-size:18px;margin-bottom:6px">📋</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Planificar campaña</div>' +
        '<div style="font-size:11px;color:var(--muted2)">Estrategia completa y recomendación de presupuesto</div>' +
      '</div>' +

      // Card 3: Crear lista de palabras clave
      '<div onclick="dismissGoogleAdsCards(this);qSend(\'CREAR LISTA DE PALABRAS CLAVE - Antes de generar las keywords, necesito saber: ¿Para qué tipo de campaña o producto/servicio específico necesitas las palabras clave? ¿Es para una campaña nueva o para optimizar una existente?\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">' +
        '<div style="font-size:18px;margin-bottom:6px">🎯</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Crear palabras clave</div>' +
        '<div style="font-size:11px;color:var(--muted2)">Keywords positivas + negativas por categorías</div>' +
      '</div>' +

      // Card 4: Crear anuncios RSA
      '<div onclick="dismissGoogleAdsCards(this);qSend(\'CREAR ANUNCIOS RSA - Para generar los headlines y descriptions más efectivos, necesito saber: ¿Para qué producto/servicio específico son estos anuncios RSA? ¿Tienes keywords principales ya definidas? ¿Es para una campaña nueva o reemplazo de anuncios existentes?\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">' +
        '<div style="font-size:18px;margin-bottom:6px">✍️</div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Crear anuncios RSA</div>' +
        '<div style="font-size:11px;color:var(--muted2)">Headlines y descriptions con estructura AIDA</div>' +
      '</div>' +

      // Card 5: Diagnosticar cuenta — full width, destacada
      '<div onclick="dismissGoogleAdsCards(this);showDiagnosticInput(\'google-ads\')" style="border:2px solid var(--blue-md);border-radius:12px;padding:14px 16px;cursor:pointer;background:var(--blue-lt);transition:all .15s;grid-column:1/-1" onmouseover="this.style.borderColor=\'var(--blue)\';this.style.background=\'#E0E3FC\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'\'\'>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="font-size:22px">🩺</div>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:700;color:var(--blue);margin-bottom:2px">Diagnosticar cuenta</div>' +
            '<div style="font-size:11px;color:var(--blue);opacity:.75">Pega tus métricas y te digo exactamente dónde estás perdiendo dinero</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>' +   // cierra grid 2-col
    '</div>';    // cierra contenedor externo
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

// Cuestionario interactivo para planificación de campaña
function showPlanningQuestionnaire() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  
  var el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML =
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg + '</div>' +
    '<div style="max-width:500px;width:100%">' +
      '<div style="background:#F9FAFB;border:1px solid var(--border);border-radius:12px;padding:20px">' +
        '<h4 style="margin:0 0 16px 0;font-size:15px;font-weight:700;color:var(--text)">📋 Planificación de Campaña</h4>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:18px">Completemos los datos para crear tu estrategia de Google Ads</div>' +
        
        // Paso 1: Objetivo principal
        '<div id="planning-step-1" class="planning-step">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">1. ¿Cuál es tu objetivo principal?</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="objetivo" value="leads" onchange="selectObjective(this)" style="margin:0">' +
              '<span>🎯 <strong>Generar leads</strong> - Formularios, llamadas, cotizaciones</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="objetivo" value="ventas" onchange="selectObjective(this)" style="margin:0">' +
              '<span>🛒 <strong>Generar ventas</strong> - E-commerce, compras online</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="objetivo" value="trafico" onchange="selectObjective(this)" style="margin:0">' +
              '<span>📈 <strong>Aumentar tráfico</strong> - Visitas al sitio web</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="objetivo" value="local" onchange="selectObjective(this)" style="margin:0">' +
              '<span>📍 <strong>Negocio local</strong> - Visitas a tienda física</span>' +
            '</label>' +
          '</div>' +
        '</div>' +

        // Paso 2: Presupuesto (oculto inicialmente)
        '<div id="planning-step-2" class="planning-step" style="display:none">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">2. ¿Cuál es tu presupuesto mensual?</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="presupuesto" value="100-300" onchange="selectBudget(this)" style="margin:0">' +
              '<span>💰 <strong>$100 - $300 USD</strong> - Presupuesto inicial</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="presupuesto" value="300-1000" onchange="selectBudget(this)" style="margin:0">' +
              '<span>💰 <strong>$300 - $1,000 USD</strong> - Presupuesto medio</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="presupuesto" value="1000+" onchange="selectBudget(this)" style="margin:0">' +
              '<span>💰 <strong>$1,000+ USD</strong> - Presupuesto alto</span>' +
            '</label>' +
          '</div>' +
        '</div>' +

        // Paso 3: Mercado objetivo (oculto inicialmente)
        '<div id="planning-step-3" class="planning-step" style="display:none">' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">3. ¿En qué mercado quieres anunciar?</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="mercado" value="colombia" onchange="selectMarket(this)" style="margin:0">' +
              '<span>🇨🇴 <strong>Colombia</strong></span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="mercado" value="mexico" onchange="selectMarket(this)" style="margin:0">' +
              '<span>🇲🇽 <strong>México</strong></span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="mercado" value="argentina" onchange="selectMarket(this)" style="margin:0">' +
              '<span>🇦🇷 <strong>Argentina</strong></span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px;border:1px solid #E0E0E0;border-radius:6px;font-size:12px" onmouseover="this.style.background=\'#F3F4F6\'" onmouseout="this.style.background=\'white\'">' +
              '<input type="radio" name="mercado" value="otro" onchange="selectMarket(this)" style="margin:0">' +
              '<span>🌎 <strong>Otro país</strong></span>' +
            '</label>' +
          '</div>' +
          '<button onclick="generatePlanningStrategy()" id="generate-planning-btn" style="width:100%;padding:12px;background:#10B981;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer" disabled>🚀 Generar estrategia completa</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

var planningData = {};

function selectObjective(input) {
  planningData.objetivo = input.value;
  // Highlight selected
  document.querySelectorAll('input[name="objetivo"]').forEach(radio => {
    radio.parentElement.style.borderColor = radio.checked ? 'var(--blue)' : '#E0E0E0';
    radio.parentElement.style.background = radio.checked ? 'var(--blue-lt)' : 'white';
  });
  setTimeout(() => {
    document.getElementById('planning-step-2').style.display = 'block';
    document.getElementById('planning-step-2').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }, 300);
}

function selectBudget(input) {
  planningData.presupuesto = input.value;
  document.querySelectorAll('input[name="presupuesto"]').forEach(radio => {
    radio.parentElement.style.borderColor = radio.checked ? 'var(--blue)' : '#E0E0E0';
    radio.parentElement.style.background = radio.checked ? 'var(--blue-lt)' : 'white';
  });
  setTimeout(() => {
    document.getElementById('planning-step-3').style.display = 'block';
    document.getElementById('planning-step-3').scrollIntoView({behavior: 'smooth', block: 'nearest'});
  }, 300);
}

function selectMarket(input) {
  planningData.mercado = input.value;
  document.querySelectorAll('input[name="mercado"]').forEach(radio => {
    radio.parentElement.style.borderColor = radio.checked ? 'var(--blue)' : '#E0E0E0';
    radio.parentElement.style.background = radio.checked ? 'var(--blue-lt)' : 'white';
  });
  document.getElementById('generate-planning-btn').disabled = false;
  document.getElementById('generate-planning-btn').style.background = '#10B981';
}

function generatePlanningStrategy() {
  // Construir prompt detallado con los datos recolectados
  const prompt = `PLANIFICAR CAMPAÑA COMPLETA con estos datos específicos:

**OBJETIVO:** ${planningData.objetivo}
**PRESUPUESTO MENSUAL:** ${planningData.presupuesto} USD 
**MERCADO:** ${planningData.mercado}
**NEGOCIO:** ${mem.negocio || 'por definir'}
**INDUSTRIA:** ${mem.industria || 'por definir'}

Necesito una estrategia integral de Google Ads que incluya:
1. Estructura de campañas recomendada
2. Distribución de presupuesto diario/semanal  
3. Tipos de keywords y match types
4. Estimación de CPCs para ${planningData.mercado}
5. Cronograma de implementación (primeros 30 días)
6. Métricas objetivo realistas para el presupuesto

Personaliza todo según el mercado de ${planningData.mercado} y el objetivo de ${planningData.objetivo}.`;

  document.getElementById('cin').value = prompt;
  sendMsg();
  
  // Reset data
  planningData = {};
}

function dismissGoogleAdsCards(el) {
  var msg = el.closest('.msg');
  if (msg) msg.style.display = 'none';
}

// Cards de retorno — Consultor de Marketing
function showConsultorActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var pasos = [
    { icon: '🗺️', titulo: 'Diagnóstico de canales', desc: '¿Dónde invertir tu presupuesto? Te digo qué plataformas priorizar.', prompt: 'Analiza mi situación y dime qué canales de marketing digital debo priorizar ahora mismo' },
    { icon: '💰', titulo: 'Distribución de presupuesto', desc: 'Cómo repartir tu inversión entre canales para el máximo resultado.', prompt: 'Ayúdame a definir cómo distribuir mi presupuesto de marketing digital entre los mejores canales' },
    { icon: '📋', titulo: 'Plan de 30 días', desc: 'Acciones concretas para las próximas 4 semanas, listas para ejecutar.', prompt: 'Crea un plan de marketing digital detallado para los próximos 30 días para mi negocio, con acciones semanales específicas' },
    { icon: '📊', titulo: 'Métricas que importan', desc: 'Qué números seguir y cómo interpretar si tu marketing funciona.', prompt: 'Explícame qué métricas clave debo medir en mi marketing digital y cómo interpretarlas para tomar mejores decisiones' },
  ];
  var cards = pasos.map(function(p) {
    return '<div class="next-step-card" onclick="this.closest(\'.msg\').style.display=\'none\';qSend(\'' + p.prompt.replace(/'/g,"\\'") + '\')">' +
      '<div class="next-step-icon">' + p.icon + '</div>' +
      '<div class="next-step-title">' + p.titulo + '</div>' +
      '<div class="next-step-desc">' + p.desc + '</div>' +
    '</div>';
  }).join('');
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--text)">¿por dónde empezamos?</div>' +
    '</div>' +
    '<div style="padding-left:40px"><div class="next-steps-grid">' + cards + '</div></div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

// Cards de retorno — SEO
function showSeoActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var pasos = [
    { icon: '🔍', titulo: 'Investigación de keywords', desc: 'Palabras clave con mayor potencial para tu negocio y mercado.', prompt: 'Haz una investigación de palabras clave para mi negocio y dime cuáles priorizar' },
    { icon: '🏥', titulo: 'Auditoría SEO rápida', desc: 'Los problemas técnicos que más están afectando tu posicionamiento.', prompt: 'Ayúdame a identificar los principales problemas SEO de mi sitio web y cómo corregirlos' },
    { icon: '✍️', titulo: 'Estrategia de contenido', desc: 'Qué artículos crear para atraer tráfico orgánico calificado.', prompt: 'Crea una estrategia de contenido SEO para los próximos 3 meses para mi negocio' },
    { icon: '🤖', titulo: 'Optimización para IAs (AEO)', desc: 'Cómo aparecer cuando alguien le pregunta a ChatGPT o Gemini sobre tu industria.', prompt: 'Explícame cómo optimizar mi sitio para que aparezca en las respuestas de IAs como ChatGPT, Claude y Gemini' },
    { icon: '🔎', titulo: 'Analizar competencia', desc: 'Quién aparece antes que tú y qué mensajes están usando.', prompt: 'Haz un análisis de competencia para mi negocio en los resultados de búsqueda' },
  ];
  var cards = pasos.map(function(p) {
    return '<div class="next-step-card" onclick="this.closest(\'.msg\').style.display=\'none\';qSend(\'' + p.prompt.replace(/'/g,"\\'") + '\')">' +
      '<div class="next-step-icon">' + p.icon + '</div>' +
      '<div class="next-step-title">' + p.titulo + '</div>' +
      '<div class="next-step-desc">' + p.desc + '</div>' +
    '</div>';
  }).join('');
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--text)">¿qué trabajamos hoy?</div>' +
    '</div>' +
    '<div style="padding-left:40px"><div class="next-steps-grid">' + cards + '</div></div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

// Cards de retorno — Social Media
function showSocialActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var pasos = [
    { icon: '🎯', titulo: 'Estrategia de contenido', desc: 'Pilares temáticos, voz de marca y frecuencia por red social.', prompt: 'Crea una estrategia de contenido completa para mi negocio: pilares temáticos, voz de marca, tipos de contenido y frecuencia recomendada por red.' },
    { icon: '✍️', titulo: 'Copys y guiones', desc: 'Textos listos para publicar esta semana en tus redes.', prompt: 'Crea copys y guiones listos para publicar: posts para feed, guiones para reels y textos para stories. Adapta el tono a mi marca.' },
    { icon: '📅', titulo: 'Calendario editorial', desc: 'Plan de publicaciones para los próximos 30 días.', prompt: 'Crea un calendario editorial de 30 días para mis redes sociales con temas, formatos y días de publicación' },
    { icon: '📈', titulo: 'Análisis de métricas', desc: 'Qué números medir y cómo mejorar tu alcance orgánico.', prompt: 'Explícame qué métricas de redes sociales debo medir y cómo mejorar mi alcance orgánico' },
  ];
  var cards = pasos.map(function(p) {
    return '<div class="next-step-card" onclick="this.closest(\'.msg\').style.display=\'none\';qSend(\'' + p.prompt.replace(/'/g,"\\'") + '\')">' +
      '<div class="next-step-icon">' + p.icon + '</div>' +
      '<div class="next-step-title">' + p.titulo + '</div>' +
      '<div class="next-step-desc">' + p.desc + '</div>' +
    '</div>';
  }).join('');
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--text)">¿qué creamos hoy?</div>' +
    '</div>' +
    '<div style="padding-left:40px"><div class="next-steps-grid">' + cards + '</div></div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function showMetaImageSubCards(parentCard) {
  // Ocultar las cards principales
  parentCard.closest('.msg').style.display = 'none';
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--text)">🖼️ Crear anuncios de imagen</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr;gap:8px;width:100%;max-width:520px;padding-left:40px">' +

      // Opción 1: Crear desde cero
      '<div onclick="dismissMetaCards(this);showDesignQuestionnaire()" style="border:1.5px solid var(--border);border-radius:12px;padding:16px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">' +
        '<div style="font-size:22px;margin-bottom:8px">✨</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:3px">Crear anuncio profesional</div>' +
        '<div style="font-size:11px;color:var(--muted2);line-height:1.4">La IA diseña creativos con tu marca, oferta y línea gráfica — listos para publicar en Meta</div>' +
      '</div>' +

      // Opción 2: Variaciones A/B de anuncio existente
      '<div onclick="dismissMetaCards(this);showAdVariationAB()" style="border:2px solid #059669;border-radius:12px;padding:16px 14px;cursor:pointer;background:#ECFDF5;transition:all .15s" onmouseover="this.style.background=\'#D1FAE5\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.background=\'#ECFDF5\';this.style.transform=\'\'">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="font-size:22px">🔄</div>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:700;color:#065F46;margin-bottom:2px">Variaciones A/B de anuncio existente <span style="font-size:10px;background:#059669;color:#fff;padding:1px 6px;border-radius:8px;margin-left:4px;font-weight:600">NUEVO</span></div>' +
            '<div style="font-size:11px;color:#047857;opacity:.9;line-height:1.4">Sube tu anuncio actual y la IA crea 2 variaciones optimizadas para test A/B</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>' +
    '<div style="padding-left:40px;margin-top:8px">' +
      '<button onclick="this.closest(\'.msg\').remove();showMetaActionCards()" style="background:none;border:none;color:var(--muted);font-size:11px;cursor:pointer;font-family:var(--font);padding:4px 0">← volver</button>' +
    '</div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function dismissMetaCards(el) {
  var msg = el.closest('.msg');
  if (msg) msg.style.display = 'none';
}

// Cards de acción para TikTok Ads
function showTikTokActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';

  var html = '';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
  html += '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--text)">¿qué quieres hacer?</div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;max-width:520px;padding-left:40px">';

  // Card 0: Crear video ad con IA — full width, destacada
  html += '<div onclick="dismissTikTokCards(this);showVideoAdFormWithContext()" style="border:2px solid #7C3AED;border-radius:12px;padding:14px 16px;cursor:pointer;background:#F5F3FF;transition:all .15s;grid-column:1/-1" onmouseover="this.style.background=\'#EDE9FE\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.background=\'#F5F3FF\';this.style.transform=\'\'">';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<div style="font-size:22px">🎬</div>';
  html += '<div>';
  html += '<div style="font-size:13px;font-weight:700;color:#7C3AED;margin-bottom:2px">Crear video ad con IA</div>';
  html += '<div style="font-size:11px;color:#7C3AED;opacity:.75">Genera un video publicitario para TikTok con Seedance 2.0</div>';
  html += '</div></div>';
  html += '</div>';

  // Card 1: Planear campaña
  html += '<div onclick="dismissTikTokCards(this);qSend(\'Ayúdame a planear una campaña completa de TikTok Ads para mi negocio: objetivo, estructura, audiencias, presupuesto y cronograma\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">';
  html += '<div style="font-size:18px;margin-bottom:6px">📋</div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Planear campaña</div>';
  html += '<div style="font-size:11px;color:var(--muted2)">Estructura, audiencias, objetivo y presupuesto</div>';
  html += '</div>';

  // Card 2: Crear guión de video
  html += '<div onclick="dismissTikTokCards(this);qSend(\'Crea un guión de video para TikTok Ads para mi negocio: hook de 3 segundos, desarrollo del mensaje y CTA. Quiero un video que convierta\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">';
  html += '<div style="font-size:18px;margin-bottom:6px">🎬</div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Crear guión de video</div>';
  html += '<div style="font-size:11px;color:var(--muted2)">Hook, desarrollo y CTA para In-Feed Ads</div>';
  html += '</div>';

  // Card 3: Copys para anuncios
  html += '<div onclick="dismissTikTokCards(this);qSend(\'Crea copys y textos profesionales para mis anuncios de TikTok Ads: texto del anuncio, overlays y variaciones para testear\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">';
  html += '<div style="font-size:18px;margin-bottom:6px">✍️</div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Crear copys</div>';
  html += '<div style="font-size:11px;color:var(--muted2)">Textos, overlays y variaciones para testear</div>';
  html += '</div>';

  // Card 4: Analizar campañas
  html += '<div onclick="dismissTikTokCards(this);qSend(\'Analiza el rendimiento de mis campañas de TikTok Ads y dame recomendaciones de optimización concretas\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">';
  html += '<div style="font-size:18px;margin-bottom:6px">📊</div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">Analizar campañas</div>';
  html += '<div style="font-size:11px;color:var(--muted2)">Métricas, optimización y recomendaciones</div>';
  html += '</div>';

  // Card 5: Diagnosticar — full width, destacada
  html += '<div onclick="dismissTikTokCards(this);showDiagnosticInput(\'tiktok-ads\')" style="border:2px solid var(--blue-md);border-radius:12px;padding:14px 16px;cursor:pointer;background:var(--blue-lt);transition:all .15s;grid-column:1/-1" onmouseover="this.style.borderColor=\'var(--blue)\';this.style.background=\'#E0E3FC\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'\'">';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<div style="font-size:22px">🩺</div>';
  html += '<div>';
  html += '<div style="font-size:13px;font-weight:700;color:var(--blue);margin-bottom:2px">Diagnosticar campañas</div>';
  html += '<div style="font-size:11px;color:var(--blue);opacity:.75">Pega tus métricas y te digo exactamente dónde estás perdiendo dinero</div>';
  html += '</div></div>';
  html += '</div>';

  html += '</div>';
  el.innerHTML = html;
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function dismissTikTokCards(el) {
  var msg = el.closest('.msg');
  if (msg) msg.style.display = 'none';
}


// ── MÓDULO DIAGNÓSTICO ──────────────────────────────────────────────────────
var diagImages = []; // array de { base64, mediaType, dataUrl, name }

function showDiagnosticInput(agent) {
  var isGoogle = agent === 'google-ads';
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var agentLabel = isGoogle ? 'Google Ads' : 'Meta Ads';
  var metricsHint = isGoogle
    ? 'Ej: impresiones 37,812 | clics 8,690 | CTR 22.98% | CPC COP479 | conversiones 144 | CPA COP28,740 | presupuesto COP85,000/día...'
    : 'Ej: alcance 45,000 | impresiones 120,000 | frecuencia 2.7 | CPM $8.50 | CTR 1.2% | ROAS 3.1 | conversiones 89 | costo/resultado $12...';
  var cancelFn = isGoogle ? 'showGoogleAdsActionCards()' : 'showMetaActionCards()';
  diagImages = [];

  var el = document.createElement('div');
  el.id = 'diagnostic-input-panel';
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';

  var html = '';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
  html += '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>';
  html += '<div>';
  html += '<div style="font-size:13px;font-weight:700;color:var(--text)">🩺 Diagnóstico de ' + agentLabel + '</div>';
  html += '<div style="font-size:11px;color:var(--muted2);margin-top:1px">Sube hasta 4 capturas o pega tus métricas — el agente analiza los datos reales</div>';
  html += '</div></div>';

  html += '<div style="padding-left:40px;width:100%;max-width:580px">';

  // Banner cuenta conectada / no conectada (solo Google)
  if (isGoogle) {
    if (adsActiveAccount) {
      html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#ECFDF5;border:1.5px solid #6EE7B7;border-radius:10px;margin-bottom:14px">';
      html += '<div style="font-size:16px">✅</div>';
      html += '<div style="flex:1"><div style="font-size:12px;font-weight:600;color:#065F46">Cuenta conectada: ' + adsActiveAccount.name + '</div>';
      html += '<div style="font-size:11px;color:#047857;margin-top:1px">Puedes subir capturas de pantalla de cualquier sección de tu cuenta</div></div>';
      html += '</div>';
    } else {
      html += '<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:#FFF7ED;border:1.5px solid #FED7AA;border-radius:10px;margin-bottom:14px">';
      html += '<div style="font-size:16px">🔗</div>';
      html += '<div style="flex:1">';
      html += '<div style="font-size:12px;font-weight:600;color:#92400E">Conecta tu cuenta para diagnóstico automático</div>';
      html += '<div style="font-size:11px;color:#B45309;margin-top:2px;margin-bottom:8px">Sin conexión, puedes subir capturas manualmente. Con tu cuenta conectada, el agente accede a los datos directamente.</div>';
      html += '<button onclick="connectGoogleAds()" style="padding:6px 12px;background:#F97316;color:white;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font)">Conectar cuenta de Google Ads →</button>';
      html += '</div></div>';
    }
  }

  html += '<div style="background:#F9FAFB;border:1.5px solid var(--border);border-radius:12px;padding:18px 20px">';

  // Sección capturas — multi-imagen
  html += '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px">📷 Capturas de pantalla <span style="font-weight:400;color:var(--muted2)">(hasta 4 — campañas, grupos, anuncios, keywords...)</span></div>';
  html += '<div id="diag-img-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px"></div>';
  html += '<label id="diag-add-img-btn" style="display:flex;align-items:center;gap:8px;padding:10px 14px;border:1.5px dashed var(--border);border-radius:8px;cursor:pointer;transition:background .15s">';
  html += '<div style="font-size:16px">➕</div>';
  html += '<div style="font-size:12px;color:var(--muted)">Agregar captura <span style="color:var(--muted2)">(PNG, JPG)</span></div>';
  html += '<input type="file" id="diag-file-input" accept="image/*" multiple style="display:none" onchange="diagAddImages(this)">';
  html += '</label>';

  // Separador
  html += '<div style="display:flex;align-items:center;gap:10px;margin:14px 0">';
  html += '<div style="flex:1;height:1px;background:var(--border)"></div>';
  html += '<div style="font-size:11px;color:var(--muted2)">o también</div>';
  html += '<div style="flex:1;height:1px;background:var(--border)"></div>';
  html += '</div>';

  // Textarea métricas
  html += '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px">📋 Pega tus métricas en texto</div>';
  html += '<textarea id="diag-textarea" placeholder="' + metricsHint + '" style="width:100%;min-height:90px;border:1.5px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;font-family:var(--font);color:var(--text);background:var(--bg);resize:vertical;outline:none;line-height:1.5"></textarea>';

  // Botones
  html += '<div style="display:flex;gap:8px;margin-top:14px">';
  html += '<button onclick="runDiagnostic(\'' + agent + '\')" style="flex:1;padding:10px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font)">Analizar ahora →</button>';
  html += '<button onclick="document.getElementById(\'diagnostic-input-panel\').remove();' + cancelFn + '" style="padding:10px 14px;background:transparent;color:var(--muted);border:1.5px solid var(--border);border-radius:8px;font-size:12px;cursor:pointer;font-family:var(--font)">Cancelar</button>';
  html += '</div>';

  html += '</div></div>';

  el.innerHTML = html;
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function diagAddImages(input) {
  var files = Array.from(input.files);
  var remaining = 4 - diagImages.length;
  if (remaining <= 0) return;
  files.slice(0, remaining).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      // Comprimir igual que el sistema principal
      var img = new Image();
      img.onload = function() {
        var MAX = 1280;
        var w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else { w = Math.round(w * MAX / h); h = MAX; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        var base64 = dataUrl.split(',')[1];
        var entry = { base64: base64, mediaType: 'image/jpeg', dataUrl: dataUrl, name: file.name };
        diagImages.push(entry);
        diagRenderGrid();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function diagRenderGrid() {
  var grid = document.getElementById('diag-img-grid');
  var addBtn = document.getElementById('diag-add-img-btn');
  if (!grid) return;
  grid.innerHTML = '';
  diagImages.forEach(function(img, i) {
    var cell = document.createElement('div');
    cell.style.cssText = 'position:relative;border-radius:8px;overflow:hidden;border:1px solid var(--border);aspect-ratio:16/9;background:#F3F4F6';
    cell.innerHTML = '<img src="' + img.dataUrl + '" style="width:100%;height:100%;object-fit:cover">' +
      '<button onclick="diagRemoveImage(' + i + ')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.55);border:none;border-radius:5px;color:white;font-size:10px;padding:2px 7px;cursor:pointer">✕</button>' +
      '<div style="position:absolute;bottom:4px;left:6px;font-size:10px;color:white;background:rgba(0,0,0,.4);padding:1px 5px;border-radius:4px;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + img.name + '</div>';
    grid.appendChild(cell);
  });
  if (addBtn) addBtn.style.display = diagImages.length >= 4 ? 'none' : 'flex';
}

function diagRemoveImage(i) {
  diagImages.splice(i, 1);
  diagRenderGrid();
}

async function runDiagnostic(agent) {
  var textarea = document.getElementById('diag-textarea');
  var metricsText = textarea ? textarea.value.trim() : '';
  var hasImages = diagImages.length > 0;

  if (!metricsText && !hasImages) {
    if (textarea) {
      textarea.style.borderColor = 'var(--danger)';
      textarea.placeholder = '⚠️ Agrega al menos una captura o pega tus métricas para continuar';
    }
    return;
  }

  // Ocultar panel
  var panel = document.getElementById('diagnostic-input-panel');
  if (panel) panel.remove();

  var isGoogle = agent === 'google-ads';
  var agentLabel = isGoogle ? 'Google Ads' : 'Meta Ads';

  // Construir prompt
  var diagPrompt = 'DIAGNÓSTICO DE CUENTA — ' + agentLabel.toUpperCase() + '\n\n';
  diagPrompt += 'Analiza los datos de ' + agentLabel + ' que te proporciono a continuación (capturas de pantalla y/o métricas en texto). ';
  diagPrompt += 'Lee cada imagen con atención — extrae todos los números, nombres de campañas, estados y tendencias que puedas ver. ';
  diagPrompt += 'Luego entrega un diagnóstico profesional con exactamente este formato:\n\n';
  diagPrompt += '## 🩺 Diagnóstico de ' + agentLabel + '\n\n';
  diagPrompt += '**Datos detectados:** [lista brevemente las métricas clave que lograste leer de las capturas/texto]\n\n';
  diagPrompt += '### 🔴 Problema #1: [nombre concreto]\n';
  diagPrompt += '**Qué está pasando:** [descripción en 1-2 oraciones basada en los datos reales]\n';
  diagPrompt += '**Impacto estimado:** [cuánto presupuesto se está desperdiciando o cuánta conversión se está perdiendo, con cifras si los datos lo permiten]\n';
  diagPrompt += '**Acción inmediata:** [qué hacer esta semana, específico y ejecutable]\n\n';
  diagPrompt += '### 🟡 Problema #2: [nombre concreto]\n';
  diagPrompt += '**Qué está pasando:** ...\n**Impacto estimado:** ...\n**Acción inmediata:** ...\n\n';
  diagPrompt += '### 🟢 Problema #3: [nombre concreto]\n';
  diagPrompt += '**Qué está pasando:** ...\n**Impacto estimado:** ...\n**Acción inmediata:** ...\n\n';
  diagPrompt += '### ✅ Plan de acción — próximas 2 semanas\n';
  diagPrompt += 'Las 3 acciones más importantes en orden de impacto, con semana estimada.\n\n';
  diagPrompt += '---\n';
  diagPrompt += 'Habla en español LatAm. Sé directo y usa los números reales que ves en los datos. Si algo no está claro en las capturas, indícalo y pide el dato específico.';

  if (metricsText) {
    diagPrompt += '\n\n**MÉTRICAS EN TEXTO:**\n' + metricsText;
  }
  if (hasImages) {
    diagPrompt += '\n\n**CAPTURAS ADJUNTAS:** ' + diagImages.length + ' imagen(es). Analiza cada una en detalle.';
  }

  // Construir content array con imágenes incluidas directamente (igual que sendMsg)
  var msgContent = [];
  diagImages.forEach(function(img) {
    msgContent.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  });
  msgContent.push({ type: 'text', text: diagPrompt });

  diagImages = [];

  // Push a hist y llamar directamente — sin addUser (el prompt no aparece en el chat)
  hist.push({ role: 'user', content: msgContent });
  await callClaude();
}
// ── FIN MÓDULO DIAGNÓSTICO ───────────────────────────────────────────────────


// Envía desde el chat libre de la pantalla de inicio
// =============================================
// AGENTE SEO
// =============================================

// =============================================
// CHAT GENERAL DEL HOME
// =============================================
const SYSTEM_GENERAL = `Eres Acuarius, un consultor senior de marketing digital disponible 24/7 para empresas de latinoamérica. Tienes expertise profundo en Google Ads, Meta Ads (Facebook e Instagram), TikTok Ads, LinkedIn Ads, SEO y estrategia de contenido para redes sociales.

Tu objetivo es responder cualquier pregunta de marketing digital de forma directa, práctica y accionable. No pides datos del negocio para responder — respondes con lo que el usuario da. Si necesitas más contexto, lo preguntas en una sola pregunta concisa al final.

REGLAS:
– Responde siempre en español
– Sé directo y práctico, sin rodeos
– Usa datos y benchmarks reales de LatAm cuando sea relevante
– Al final de tu respuesta, incluye exactamente esta línea si el tema es claramente de una plataforma específica:
  [AGENTE_SUGERIDO: google-ads] o [AGENTE_SUGERIDO: meta-ads] o [AGENTE_SUGERIDO: tiktok-ads] o [AGENTE_SUGERIDO: linkedin-ads] o [AGENTE_SUGERIDO: seo] o [AGENTE_SUGERIDO: social]
– Si la pregunta es general o cubre varias plataformas, NO incluyas [AGENTE_SUGERIDO]
– Nunca menciones que eres un agente de IA ni que tienes limitaciones`;





 // historial del chat general
let homeLoading = false;

async function homeChat() {
  const el = document.getElementById('home-cin');
  if (!el || homeLoading) return;
  const txt = el.value.trim();
  if (!txt) return;
  el.value = '';
  el.style.height = 'auto';

  // Mostrar área de chat en el home
  showHomeChatArea();
  appendHomeMsgUser(txt);
  homeHist.push({ role: 'user', content: txt });

  homeLoading = true;
  const loadId = appendHomeThinking();

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

    const r = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: homeHist.length > MAX_HIST_MESSAGES ? homeHist.slice(homeHist.length - MAX_HIST_MESSAGES) : homeHist,
        system: SYSTEM_GENERAL,
        userPlan
      })
    });

    if (!r.ok) {
      removeHomeThinking(loadId);
      appendHomeMsgAgent('error al procesar la respuesta. intenta de nuevo.', null);
      homeLoading = false; return;
    }

    // Leer stream SSE
    let homeReplyFinal = '';
    let homeStreamEl = null;
    const homeReader = r.body.getReader();
    const homeDecoder = new TextDecoder();
    let homeSseBuffer = '';
    let homeStreamDone = false;
    removeHomeThinking(loadId);

    while (!homeStreamDone) {
      const { done, value } = await homeReader.read();
      if (done) break;
      homeSseBuffer += homeDecoder.decode(value, { stream: true });
      const lines = homeSseBuffer.split('\n');
      homeSseBuffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const evt = JSON.parse(line.slice(6).trim());
          if (evt.error) { appendHomeMsgAgent('error al procesar la respuesta. intenta de nuevo.', null); homeLoading = false; return; }
          if (evt.delta !== undefined) {
            if (!homeStreamEl) {
              homeStreamEl = document.createElement('div');
              homeStreamEl.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
              homeStreamEl.innerHTML = `<div style="width:28px;height:28px;flex-shrink:0;overflow:hidden;border-radius:7px"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75" style="width:28px;height:28px;display:block"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg></div><div style="background:var(--bg);border:1px solid var(--border);border-radius:4px 14px 14px 14px;padding:12px 14px;font-size:13.5px;line-height:1.6;color:var(--text);flex:1" id="home-stream-text"></div>`;
              document.getElementById('home-chat-box').appendChild(homeStreamEl);
            }
            homeReplyFinal += evt.delta;
            const bbl = document.getElementById('home-stream-text');
            if (bbl) bbl.innerHTML = fmt(homeReplyFinal);
            const box = document.getElementById('home-chat-box');
            if (box) box.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }
          if (evt.done && evt.full !== undefined) { homeReplyFinal = evt.full; homeStreamDone = true; }
        } catch(_) {}
      }
    }

    // Reemplazar burbuja de stream con burbuja final (que incluye botón de agente sugerido)
    if (homeStreamEl) homeStreamEl.remove();
    let reply = homeReplyFinal || 'error al procesar. intenta de nuevo.';
    const agentMatch = reply.match(/\[AGENTE_SUGERIDO:\s*([\w-]+)\]/);
    let suggestedAgent = null;
    if (agentMatch) {
      suggestedAgent = agentMatch[1].trim();
      reply = reply.replace(agentMatch[0], '').trim();
    }
    homeHist.push({ role: 'assistant', content: reply });
    appendHomeMsgAgent(reply, suggestedAgent);

  } catch(e) {
    removeHomeThinking(loadId);
    appendHomeMsgAgent('error de conexión. verifica tu internet e intenta de nuevo.', null);
  }

  homeLoading = false;
}

function showHomeChatArea() {
  let chatBox = document.getElementById('home-chat-box');
  if (chatBox) return; // ya existe

  const wrap = document.querySelector('.home-wrap');
  const cinWrap = document.querySelector('.home-cin-wrap');

  // Crear el área de chat entre los agentes y el input
  chatBox = document.createElement('div');
  chatBox.id = 'home-chat-box';
  chatBox.style.cssText = 'width:100%;max-width:740px;display:flex;flex-direction:column;gap:14px;margin-bottom:20px;';
  wrap.insertBefore(chatBox, cinWrap);

  // Ocultar las cards de agentes y el título "o escribe directamente"
  const agentsGrid = document.querySelector('.home-agents');
  const orLabel = document.querySelector('.home-or');
  const homeSub = document.querySelector('.home-sub');
  if (agentsGrid) agentsGrid.style.display = 'none';
  if (orLabel) orLabel.style.display = 'none';
  if (homeSub) homeSub.textContent = 'consultor de marketing digital · acuarius';

  // Botón para volver a los agentes
  const backBtn = document.createElement('div');
  backBtn.style.cssText = 'width:100%;max-width:740px;margin-bottom:4px;';
  backBtn.innerHTML = `<button onclick="resetHomeChat()" style="font-size:11px;color:var(--muted);background:none;border:none;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:4px;padding:0">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
    ver agentes
  </button>`;
  wrap.insertBefore(backBtn, chatBox);
}

function appendHomeMsgUser(txt) {
  const box = document.getElementById('home-chat-box');
  if (!box) return;
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;justify-content:flex-end;';
  el.innerHTML = `<div style="background:var(--blue);color:#fff;border-radius:14px 4px 14px 14px;padding:10px 14px;font-size:13.5px;line-height:1.55;max-width:80%">${esc(txt)}</div>`;
  box.appendChild(el);
  box.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function appendHomeMsgAgent(txt, suggestedAgent) {
  const box = document.getElementById('home-chat-box');
  if (!box) return;

  const agentLabels = {
    'google-ads': 'Google Ads', 'meta-ads': 'Meta Ads',
    'tiktok-ads': 'TikTok Ads', 'linkedin-ads': 'LinkedIn Ads',
    'seo': 'SEO', 'social': 'Contenido para Redes', 'consultor': 'Consultor de Marketing'
  };

  const suggBtn = suggestedAgent ? `
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:11px;color:var(--muted2);margin-bottom:6px">¿quieres profundizar con el agente especializado?</div>
      <button onclick="continueWithAgent('${suggestedAgent}')" style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">
        Continuar con agente de ${agentLabels[suggestedAgent]||suggestedAgent}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      </button>
    </div>` : '';

  const el = document.createElement('div');
  el.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
  el.innerHTML = `
    <div style="width:28px;height:28px;flex-shrink:0;overflow:hidden;border-radius:7px">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75" style="width:28px;height:28px;display:block">
        <rect width="75" height="75" fill="#1E2BCC" rx="8"/>
        <path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/>
        <path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/>
        <circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/>
      </svg>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px 14px 14px 14px;padding:12px 14px;font-size:13.5px;line-height:1.6;color:var(--text);flex:1">${fmt(txt)}${suggBtn}</div>`;
  box.appendChild(el);
  box.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function appendHomeThinking() {
  const box = document.getElementById('home-chat-box');
  if (!box) return null;
  const id = 'ht_' + Date.now();
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'display:flex;gap:10px;align-items:flex-start;';
  el.innerHTML = `
    <div style="width:28px;height:28px;flex-shrink:0;overflow:hidden;border-radius:7px">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75" style="width:28px;height:28px;display:block"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>
    </div>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:4px 14px 14px 14px;padding:12px 16px">
      <div class="thinking-dots"><span></span><span></span><span></span></div>
    </div>`;
  box.appendChild(el);
  box.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return id;
}

function removeHomeThinking(id) {
  if (id) document.getElementById(id)?.remove();
}

// Continuar con agente específico — transfiere el historial
async function continueWithAgent(agentKey) {
  setAgentContext(agentKey);
  showView('chat');

  // Transferir historial del home al chat del agente
  hist = [...homeHist];
  onDone = true; // no lanzar onboarding

  // Cargar perfil si existe
  const profile = await dbLoadProfile(agentKey);
  if (profile) {
    try {
      Object.assign(mem, profile);
      updateMem();
      clientStage = mapStage(mem.etapa);
      document.getElementById('mem-card').style.display = 'block';
      document.getElementById('m-stage').textContent = clientStage;
    } catch(e) {}
  }

  // Reconstruir el chat visualmente con el historial
  const area = document.getElementById('chat-area');
  area.innerHTML = '';
  homeHist.forEach(msg => {
    if (msg.role === 'user') addUser(msg.content);
    else addAgent(msg.content);
  });

  // Mensaje de transición
  const agentLabels = {
    'google-ads':'Google Ads','meta-ads':'Meta Ads','tiktok-ads':'TikTok Ads',
    'linkedin-ads':'LinkedIn Ads','seo':'SEO','social':'Contenido para Redes','consultor':'Consultor de Marketing'
  };
  addAgent(`continuamos en el agente de **${agentLabels[agentKey]||agentKey}**. ¿en qué más te ayudo?`);
}

// Volver a la pantalla de inicio reseteando el chat general
function resetHomeChat() {
  homeHist = [];
  homeLoading = false;
  const box = document.getElementById('home-chat-box');
  if (box) box.remove();
  const backBtn = box?.previousSibling;
  // Restaurar UI del home
  const agentsGrid = document.querySelector('.home-agents');
  const orLabel = document.querySelector('.home-or');
  const homeSub = document.querySelector('.home-sub');
  if (agentsGrid) agentsGrid.style.display = '';
  if (orLabel) orLabel.style.display = '';
  if (homeSub) homeSub.textContent = '¿con qué agente quieres trabajar hoy?';
  // Remover botón de volver
  document.querySelectorAll('.home-wrap > div').forEach(el => {
    if (el.querySelector && el.querySelector('button[onclick="resetHomeChat()"]')) el.remove();
  });
}

window.onload = async () => {
  try {
    const ok = await initAuth();
    if(!ok) return;
  } catch(e) {
    console.warn('initAuth error:', e.message);
  }

  // Inicializar límites de imágenes
  loadImageUsage();

  // Vista inicial: panel de clientes para agencia/admin, home para el resto
  const isAgencyOnLoad = userPlan === 'agency' || isAdminUser();
  if (isAgencyOnLoad) {
    // Cargar clientes antes de mostrar el panel para que no aparezca vacío
    await agencyInit();
    showView('agency');
  } else {
    showView('home');
    setTimeout(function(){ agencyInit(); }, 400);
  }
  // Cargar recientes al iniciar
  setTimeout(function(){ loadRecentConversations(); }, 1000);
  // Mostrar tour si es la primera vez
  setTimeout(function(){ if (tourShouldShow()) tourStart(); }, 1500);
  // Actualizar badge de historial
  setTimeout(function(){ updateHistorialBadge(); }, 2000);
  // Restaurar conexiones desde Supabase si no hay token en sessionStorage
  setTimeout(function(){ restoreConnectionsFromSupabase(); }, 2500);
  // Inicializar alertas
  setTimeout(function(){ initAlertsBadge(); }, 3000);
};

// ONBOARDING
function renderOb(){const steps=getObSteps();const s=steps[obStep];const pct=(obStep/steps.length)*100;let inner;if(s.type==='input'){inner=`<input class="finput" id="oi" type="text" placeholder="${s.ph||''}" onkeydown="if(event.key==='Enter')nextStep()">"`;}else if(s.type==='multi'){inner=`<div class="opts">${s.opts.map(o=>`<button class="opt" onclick="toggleMultiOpt(this,'${o.replace(/'/g,"\'")}')" ><span>${o}</span></button>`).join('')}</div><div style="font-size:11px;color:var(--muted2);margin-top:6px;text-align:center">puedes elegir varias opciones</div>`;}else{inner=`<div class="opts">${s.opts.map(o=>`<button class="opt" onclick="selOpt(this,'${o.replace(/'/g,"\'")}')"><span>${o}</span></button>`).join('')}</div>`;}const html=`<div class="ob-card" id="obc"><div class="ob-title">configuración del perfil</div><div class="ob-sub">paso ${obStep+1} de ${steps.length}</div><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div><div class="step-lbl">pregunta ${obStep+1}</div><div class="step-q">${s.q}</div>${inner}<div class="step-nav">${obStep>0?'<button class="btn btn-g" onclick="prevStep()">← atrás</button>':''}<button class="btn btn-p" id="nxt" onclick="nextStep()" ${(s.type==='opts'||s.type==='multi')?'disabled':''}>${obStep<steps.length-1?'continuar →':'iniciar →'}</button></div></div>`;appendRaw(html);if(s.type==='input')setTimeout(()=>document.getElementById('oi')?.focus(),80);scrollB()}
function toggleMultiOpt(btn,val){btn.classList.toggle('sel');if(btn.classList.contains('sel'))btn.dataset.val=val;else delete btn.dataset.val;const anySelected=document.querySelectorAll('#obc .opt.sel').length>0;const nxt=document.getElementById('nxt');if(nxt)nxt.disabled=!anySelected;}
function selOpt(btn,val){btn.closest('.opts').querySelectorAll('.opt').forEach(b=>b.classList.remove('sel'));btn.classList.add('sel');btn.dataset.val=val;document.getElementById('nxt').disabled=false}
function nextStep(){const steps=getObSteps();const s=steps[obStep];let val;if(s.type==='input'){val=document.getElementById('oi')?.value?.trim();}else if(s.type==='multi'){const selected=[...document.querySelectorAll('#obc .opt.sel')].map(b=>b.dataset.val).filter(Boolean);val=selected.length>0?selected.join(', '):null;}else{val=document.querySelector('#obc .opt.sel')?.dataset?.val;}if(!val)return;mem[s.key]=val;document.getElementById('obc')?.remove();addUser(val);if(obStep<steps.length-1){obStep++;setTimeout(renderOb,250)}else{updateMem();finishOb()}}


function prevStep(){if(obStep>0){document.getElementById('obc')?.remove();obStep--;renderOb()}}
function finishOb(){finishObWithAccountSave()}
function mapStage(e){if(!e)return'sin definir';if(e.includes('cero'))return'día 1 — configuración';if(e.includes('menos de 1'))return'primera semana';if(e.includes('1–3'))return'meses 1–3';return'cuenta madura (+3 meses)'}
function updateMem(){document.getElementById('m-neg').textContent=mem.negocio?.split('·')[0]?.trim()||'—';document.getElementById('m-ind').textContent=mem.industria||'—';document.getElementById('m-pre').textContent=mem.presupuesto||'—';document.getElementById('m-obj').textContent=mem.objetivo?.split('/')[0]?.trim()||'—'}

// CHAT
function memCtx(){
  if(!Object.keys(mem).length) return 'perfil no completado aún.';
  // Campos del brief profesional de agencia
  const coreMap = {
    negocio:       'Cliente / Marca',
    descripcion:   'Descripción del negocio',
    industria:     'Industria / Sector',
    modelo:        'Modelo de negocio',
    pais:          'País',
    ciudad:        'Ciudad',
    web:           'Sitio web',
    ticket:        'Ticket promedio',
    ciclo:         'Ciclo de venta',
    presupuesto:   'Presupuesto mensual',
    objetivo:      'Objetivo principal',
    kpi:           'KPI primario',
    metaCosto:     'Meta de costo por resultado',
    resultados:    'Resultados esperados',
    crm:           'CRM / Seguimiento de leads',
    pixel:         'Pixel / Etiquetas instaladas',
    canales:       'Canales activos',
    audiencia:     'Audiencia objetivo',
    edad:          'Rango de edad',
    genero:        'Género predominante',
    problema:      'Problema que resuelve',
    diferenciador: 'Diferenciador / USP',
    competidores:  'Competidores',
    funciono:      'Lo que ha funcionado',
    nofunciono:    'Lo que NO ha funcionado / evitar',
    // Campos legacy de onboarding normal
    producto:      'Producto o servicio principal',
    mercado:       'Mercado geográfico',
    etapa:         'Etapa con el canal',
    desafio:       'Mayor reto actual',
    redes_actuales:'Redes sociales actuales',
    frecuencia:    'Frecuencia de publicación',
    recursos:      'Recursos de contenido',
  };
  const brandMap = {
    tono:          'Tono de marca',
    propuesta:     'Propuesta de valor única',
    keywordsMarca: 'Palabras clave de marca (usar siempre)',
    evitar:        'Palabras / temas a EVITAR',
    notas:         'Notas internas del account manager',
  };
  const coreLines = [];
  const brandLines = [];
  Object.entries(mem).forEach(([k,v]) => {
    if(!v || !v.toString().trim()) return;
    if(brandMap[k]) brandLines.push(`${brandMap[k]}: ${v}`);
    else if(coreMap[k]) coreLines.push(`${coreMap[k]}: ${v}`);
  });
  let ctx = coreLines.join('\n');
  if(brandLines.length){
    ctx += '\n\n--- IDENTIDAD DE MARCA (aplicar en TODOS los outputs) ---\n' + brandLines.join('\n');
    if(mem.tono) ctx += '\nIMPORTANTE: Usa SIEMPRE el tono "' + mem.tono + '" en copys, anuncios y recomendaciones.';
    if(mem.evitar && mem.evitar.trim()) ctx += '\nIMPORTANTE: Evitar en todos los outputs: ' + mem.evitar;
    if(mem.keywordsMarca && mem.keywordsMarca.trim()) ctx += '\nIMPORTANTE: Incorporar estas palabras/frases clave de marca cuando sea relevante: ' + mem.keywordsMarca;
    if(mem.competidores && mem.competidores.trim()) ctx += '\nCOMPETIDORES para diferenciación: ' + mem.competidores;
    if(mem.nofunciono && mem.nofunciono.trim()) ctx += '\nEVITAR (no ha funcionado): ' + mem.nofunciono;
  }
  return ctx || 'perfil no completado aún.';
}
async function sendMsg(){
  if(loading||((!onDone)&&!pendingImg))return;
  const el=document.getElementById('cin');
  const txt=el.value.trim();
  if(!txt && !pendingImg)return;
  el.value='';autoR(el);
  
  // Construir contenido del mensaje con imagen opcional
  let msgContent;
  if(pendingImg){
    msgContent=[];
    msgContent.push({type:'image',source:{type:'base64',media_type:pendingImg.mediaType,data:pendingImg.base64}});
    if(txt)msgContent.push({type:'text',text:txt});
    else msgContent.push({type:'text',text:'Analiza esta imagen de mi campaña de Google Ads.'});
    addUser(txt||'[Imagen adjunta]', pendingImg);
    clearImg();
  } else {
    // Enriquecer con datos competitivos si aplica
    const enriched = await enrichWithCompetitiveData(txt, currentAgentCtx).catch(() => txt);
    msgContent = enriched;
    addUser(txt); // mostrar el mensaje original sin el contexto extra
  }
  hist.push({role:'user',content:msgContent});
  // Ocultar tarjetas de acción rápida del agente social al primer envío
  if(currentAgentCtx==='social'){
    const socialBar=document.getElementById('social-action-bar');
    if(socialBar)socialBar.style.display='none';
  }
  await callClaude();
}

function handleImgSelect(input){
  const file=input.files[0];
  if(!file)return;
  if(file.size>10*1024*1024){alert('La imagen debe pesar menos de 10MB');return;}
  
  // Comprimir imagen antes de enviar para evitar timeouts
  const img=new Image();
  const url=URL.createObjectURL(file);
  img.onload=()=>{
    URL.revokeObjectURL(url);
    const MAX=1280; // máximo lado largo en px
    let w=img.width, h=img.height;
    if(w>MAX||h>MAX){
      if(w>h){h=Math.round(h*MAX/w);w=MAX;}
      else{w=Math.round(w*MAX/h);h=MAX;}
    }
    const canvas=document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    canvas.getContext('2d').drawImage(img,0,0,w,h);
    const dataUrl=canvas.toDataURL('image/jpeg',0.85);
    const base64=dataUrl.split(',')[1];
    pendingImg={base64,mediaType:'image/jpeg',name:file.name,dataUrl};
    console.log('Imagen lista:', w+'x'+h, Math.round(base64.length/1024)+'KB base64');
    // Indicador en el botón
    const btn=document.getElementById('attach-plus');
    if(btn)btn.classList.add('has-img');
    const cin=document.getElementById('cin');
    if(cin)cin.placeholder='imagen lista — escribe tu pregunta o envía directamente';
    showImgChip(file.name, dataUrl, base64.length);
  };
  img.onerror=()=>{alert('Error al cargar la imagen. Intenta con otro archivo.');};
  img.src=url;
  input.value='';
}

function clearImg(){
  pendingImg=null;
  document.getElementById('img-chip-bar')?.remove();
  const btn=document.getElementById('attach-plus');
  if(btn)btn.classList.remove('has-img');
  const cin=document.getElementById('cin');
  if(cin)cin.placeholder='pregunta al agente o adjunta una captura...';
}

function showImgChip(name, dataUrl, b64len){
  document.getElementById('img-chip-bar')?.remove();
  const kb=Math.round(b64len/1024*0.75); // base64 → KB aprox
  const sizeLabel=kb>1024?Math.round(kb/1024)+'MB':kb+'KB';
  const bar=document.createElement('div');
  bar.id='img-chip-bar';
  bar.innerHTML=`<div style="display:inline-flex;align-items:center;gap:8px;background:#fff;border:1.5px solid #E5E7EB;border-radius:10px;padding:5px 10px 5px 5px;max-width:200px;margin:6px 0 2px">
    <img src="${dataUrl}" style="width:32px;height:32px;min-width:32px;border-radius:6px;object-fit:cover;border:1px solid #E5E7EB;display:block" alt="preview">
    <div style="display:flex;flex-direction:column;gap:1px;min-width:0;flex:1">
      <span style="font-size:12px;font-weight:500;color:#0A0A0A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;display:block">${esc(name)}</span>
      <span style="font-size:11px;color:#6B7280">${sizeLabel}</span>
    </div>
    <button onclick="clearImg()" title="quitar" style="background:none;border:none;cursor:pointer;color:#9CA3AF;padding:2px;border-radius:4px;display:flex;align-items:center;flex-shrink:0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </div>`;
  // Insertar encima del cin-wrap dentro del chat-input-area
  const wrap=document.querySelector('.cin-wrap');
  if(wrap)wrap.parentNode.insertBefore(bar, wrap);
}

function toggleAttachMenu(e){
  e.stopPropagation();
  if(pendingImg){clearImg();return;}
  const menu=document.getElementById('attach-menu');
  const btn=document.getElementById('attach-plus');
  menu.classList.toggle('open');
  btn.classList.toggle('active',menu.classList.contains('open'));
}

function closeAttachMenu(){
  document.getElementById('attach-menu')?.classList.remove('open');
  document.getElementById('attach-plus')?.classList.remove('active');
}

async function captureScreen(){
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({preferCurrentTab:true});
    const track=stream.getVideoTracks()[0];
    const capture=new ImageCapture(track);
    const bitmap=await capture.grabFrame();
    track.stop();
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    canvas.getContext('2d').drawImage(bitmap,0,0);
    const dataUrl=canvas.toDataURL('image/jpeg',0.85);
    const base64=dataUrl.split(',')[1];
    pendingImg={base64,mediaType:'image/jpeg',name:'captura.jpg',dataUrl};
    const btn=document.getElementById('attach-plus');
    if(btn)btn.classList.add('has-img');
    showImgChip('captura.jpg', dataUrl, base64.length);
    const cin=document.getElementById('cin');
    if(cin)cin.placeholder='captura lista — escribe tu pregunta o envía directamente';
  } catch(e){
    if(e.name!=='NotAllowedError')alert('No se pudo capturar la pantalla. Usa "Subir imagen" en su lugar.');
  }
}

// Cerrar menú al hacer clic fuera
document.addEventListener('click',function(e){
  if(!document.getElementById('attach-wrap')?.contains(e.target))closeAttachMenu();
});
function qSend(txt){if(loading)return;if(!onDone)onDone=true;showView('chat');document.getElementById('cin').value=txt;sendMsg()}
function askAgent(stage){const msgs={dia:'Guíame paso a paso en la configuración del Día 1 de mi cuenta de Google Ads. Dime exactamente qué hacer primero.',semana:'Estoy en la primera semana de mi campaña. ¿Qué debería estar revisando ahora mismo y qué es lo más importante?',quincena:'Estoy terminando la primera quincena. ¿Cuáles son las optimizaciones más importantes que debo hacer ahora?',mes:'Se cumple el primer mes de mi campaña. ¿Qué métricas debo analizar y qué decisiones estratégicas debo tomar?',trimestre:'Llevo 2-3 meses con mi campaña. ¿Cómo escalo lo que está funcionando y qué nuevas campañas debería explorar?',semestre:'Tengo 6 meses de historial. Ayúdame a planificar el siguiente semestre y dame recomendaciones de cuenta madura.'};qSend(msgs[stage]||'Guíame en esta etapa de mi cuenta.')}
async function callClaude(){loading=true;document.getElementById('sbtn').disabled=true;const tid=addThinking();const agentLabels={'google-ads':'Google Ads','meta-ads':'Meta Ads (Facebook e Instagram)','tiktok-ads':'TikTok Ads','linkedin-ads':'LinkedIn Ads','seo':'SEO','social':'generación de contenido para redes sociales','consultor':'Consultor de Marketing'};
// Seleccionar system prompt según agente activo
let sys;
if(currentAgentCtx==='meta-ads'){
  sys=SYSTEM_META.replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage);
  const metaCtx = await getMetaAdsContext().catch(()=>'');
  if(metaCtx) sys = metaCtx + '\n\n' + sys;
}else if(currentAgentCtx==='seo'){
  sys=SYSTEM_SEO.replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage);
}else if(currentAgentCtx==='consultor'){
  sys=SYSTEM_CONSULTOR.replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage);
}else if(currentAgentCtx==='social'){
  sys=SYSTEM_SOCIAL.replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage);
}else if(currentAgentCtx==='tiktok-ads'){
  sys=SYSTEM_TIKTOK.replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage);
}else if(currentAgentCtx==='linkedin-ads'){
  sys=(typeof SYSTEM_LINKEDIN!=='undefined'?SYSTEM_LINKEDIN:SYSTEM).replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage);
}else{
  sys=SYSTEM.replace('{MEMORY}',memCtx()).replace('{STAGE}',clientStage).replace('{AGENT}',agentLabels[currentAgentCtx]||'Google Ads');
  // Inyectar contexto de Google Ads si hay cuenta conectada
  const gCtx = await getGoogleAdsContext().catch(()=>'');
  if(gCtx) sys = gCtx + '\n\n' + sys;
}
// Inyectar contexto de cliente activo (Plan Agencia)
if(activeClientContext){
  const clientCtx = 'CLIENTE ACTIVO: ' + activeClientContext.clientName +
    (activeClientContext.clientIndustry ? ' (' + activeClientContext.clientIndustry + ')' : '') +
    (activeClientContext.monthlyBudget ? '\nPresupuesto mensual: $' + activeClientContext.monthlyBudget : '') +
    (activeClientContext.notes ? '\nNotas: ' + activeClientContext.notes : '') +
    '\nEstas ayudando a gestionar las campanas de este cliente especifico.';
  sys = clientCtx + '\n\n' + sys;
}
if(clerkInstance?.session){try{sessionToken=await clerkInstance.session.getToken()}catch{}}const headers={'Content-Type':'application/json'};if(sessionToken)headers['Authorization']=`Bearer ${sessionToken}`;try{// Truncar historial: mantener los últimos MAX_HIST_MESSAGES mensajes
const histTruncated = hist.length > MAX_HIST_MESSAGES
  ? hist.slice(hist.length - MAX_HIST_MESSAGES)
  : hist;
// Sanitizar el system prompt: eliminar caracteres de control que rompen JSON y truncar
const MAX_SYS = 18000;
const sysSanitized = (sys || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, MAX_SYS);
// Sanitizar historial: truncar mensajes muy largos individualmente
const histSanitized = histTruncated.map(m => {
  if (typeof m.content === 'string' && m.content.length > 4000) {
    return { ...m, content: m.content.slice(0, 4000) };
  }
  return m;
});
const payload={messages:histSanitized,system:sysSanitized,userPlan};
let payloadStr;
try { payloadStr = JSON.stringify(payload); } catch(jsonErr) { addAgent('Error preparando la solicitud. Intenta de nuevo.'); loading=false; document.getElementById('sbtn').disabled=false; return; }
const r=await fetch('/api/chat',{method:'POST',headers,body:payloadStr});if(!r.ok){rmThinking(tid);const errData=await r.json().catch(()=>({}));if(r.status===401){window.location.href='/login.html';return}if(r.status===429){showLimitBanner(errData);loading=false;document.getElementById('sbtn').disabled=false;return}const errMsg=errData.error||'error desconocido';addAgent('⚠️ Error del servidor: ' + errMsg);loading=false;document.getElementById('sbtn').disabled=false;return;}
// Leer stream SSE
let replyFinal='';
let streamBubble=null;
let streamEl=null;
const reader=r.body.getReader();
const decoder=new TextDecoder();
let sseBuffer='';
let streamDone=false;
rmThinking(tid);
while(!streamDone){
  const {done,value}=await reader.read();
  if(done)break;
  sseBuffer+=decoder.decode(value,{stream:true});
  const lines=sseBuffer.split('\n');
  sseBuffer=lines.pop();
  for(const line of lines){
    if(!line.startsWith('data: '))continue;
    const data=line.slice(6).trim();
    try{
      const evt=JSON.parse(data);
      if(evt.error){rmThinking(tid);addAgent('error al procesar la respuesta. intenta de nuevo.');loading=false;document.getElementById('sbtn').disabled=false;return;}
      if(evt.delta!==undefined){
        // Mostrar tokens en tiempo real
        if(!streamEl){
          streamEl=document.createElement('div');
          streamEl.className='msg';
          streamEl.innerHTML='<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg></div><div class="bubble ag-bubble" id="stream-bubble-text"></div>';
          document.getElementById('chat-area').appendChild(streamEl);
        }
        replyFinal+=evt.delta;
        const bbl=document.getElementById('stream-bubble-text');
        if(bbl)bbl.innerHTML=fmt(replyFinal.replace(/\[META_API:\s*\{[\s\S]*?\}\]/g,'').replace(/\[GAQL_QUERY:[\s\S]*?\]/g,'').replace(/\[SUGERENCIAS:[^\]]*\]/g,''));
        scrollB();
      }
      if(evt.done&&evt.full!==undefined){replyFinal=evt.full;streamDone=true;}
    }catch(_){}
  }
}
// Remover burbuja de stream temporal (se reemplaza abajo con addAgent o lógica especial)
if(streamEl)streamEl.remove();
let replyFinalProcessed=replyFinal||'error al procesar la respuesta. intenta de nuevo.';

    // Extraer sugerencias de seguimiento
    let sugerencias = [];
    const sugMatch = replyFinalProcessed.match(/\[SUGERENCIAS:\s*([^\]]+)\]/);
    if (sugMatch) {
      sugerencias = sugMatch[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
      replyFinalProcessed = replyFinalProcessed.replace(sugMatch[0], '').trim();
    }
    // Detectar bloque GAQL (Google Ads)
    const gaqlMatch = replyFinalProcessed.match(/\[GAQL_QUERY:\s*([\s\S]+?)\]/);
    if(gaqlMatch){
      const gaqlQuery = gaqlMatch[1].trim();
      replyFinalProcessed = replyFinalProcessed.replace(gaqlMatch[0], '').trim();
      addAgent(replyFinalProcessed || 'Consultando tu cuenta de Google Ads...');
      const gaqlResult = await queryGoogleAds(gaqlQuery);
      if(gaqlResult.error){
        hist.push({role:'assistant',content:replyFinalProcessed});
        hist.push({role:'user',content:`Error al consultar Google Ads API: ${gaqlResult.error}`});
        addAgent(`⚠️ No pude consultar tu cuenta: ${gaqlResult.error}`);
      } else {
        const resultStr = JSON.stringify(gaqlResult.results||gaqlResult, null, 2);
        hist.push({role:'assistant',content:replyFinalProcessed});
        hist.push({role:'user',content:`Resultados de Google Ads API:\n\`\`\`json\n${resultStr}\n\`\`\`\nAnaliza estos datos y dame conclusiones y recomendaciones concretas.`});
        await callClaude(); return;
      }
    }
    // Detectar bloque META_API
    else if(replyFinalProcessed.includes('[META_API:')){
      const metaMatch = replyFinalProcessed.match(/\[META_API:\s*(\{[\s\S]+?\})\]/);
      if(metaMatch){
        let metaCmd;
        try{ metaCmd = JSON.parse(metaMatch[1]); }catch(e){ metaCmd = null; }
        if(metaCmd){
          replyFinalProcessed = replyFinalProcessed.replace(metaMatch[0], '').trim();
          addAgent(replyFinalProcessed || 'Ejecutando acción en Meta Ads...');
          const metaResult = await callMetaAPI(metaCmd.endpoint, metaCmd.method||'GET', metaCmd.params||{});
          if(metaResult.error){
            hist.push({role:'assistant',content:replyFinalProcessed});
            hist.push({role:'user',content:`Error en Meta API: ${metaResult.error}`});
            addAgent(`⚠️ No pude ejecutar la acción en Meta: ${metaResult.error}`);
          } else {
            const resultStr = JSON.stringify(metaResult, null, 2);
            hist.push({role:'assistant',content:replyFinalProcessed});
            hist.push({role:'user',content:`Resultado de Meta API:\n\`\`\`json\n${resultStr}\n\`\`\`\nAnaliza estos datos y dame conclusiones y recomendaciones concretas.`});
            await callClaude(); return;
          }
        }
      }
    }
    // Detectar opciones de bienvenida del agente Social
    else if(replyFinalProcessed.includes('[SOCIAL_OPTIONS]')){
      const cleanReply = replyFinalProcessed.replace(/\[SOCIAL_OPTIONS\]/g, '').trim();
      if(cleanReply) { addAgent(cleanReply); hist.push({role:'assistant', content: cleanReply}); }
      onDone = true;
      renderSocialOptions();
      loading=false; document.getElementById('sbtn').disabled=false; return;
    }
    // Detectar cuestionario de diseño
    else if(replyFinalProcessed.includes('[DESIGN_QUESTIONNAIRE]')){
      const cleanReply = replyFinalProcessed.replace(/\[DESIGN_QUESTIONNAIRE\]/g, '').trim();
      if(cleanReply) { addAgent(cleanReply); hist.push({role:'assistant', content: cleanReply}); }
      showDesignQuestionnaire();
      loading=false; document.getElementById('sbtn').disabled=false; return;
    }
    // Detectar bloque(s) GENERAR_IMAGEN
    else if(replyFinalProcessed.includes('[GENERAR_IMAGEN:')){
      if (!canGenerateImage()) {
        showImageLimitReached();
        loading=false; document.getElementById('sbtn').disabled=false; return;
      }
      const allMatches = [...replyFinalProcessed.matchAll(/\[GENERAR_IMAGEN:\s*(\{[\s\S]+?\})\]/g)];
      if(allMatches.length > 0){
        const cleanReply = replyFinalProcessed.replace(/\[GENERAR_IMAGEN:\s*\{[\s\S]+?\}\]/g, '').trim();
        if(cleanReply) { addAgent(cleanReply); hist.push({role:'assistant', content: cleanReply}); }
        else { hist.push({role:'assistant', content: 'Generando ' + Math.min(allMatches.length, userPlan === 'pro' ? 5 : 1) + ' creativos para tu anuncio...'}); }
        const matchesToProcess = (userPlan === 'pro' || isAdminUser()) ? allMatches : allMatches.slice(0, 1);
        generatedAdImages = [];
        const totalImgs = matchesToProcess.length;
        for(let i = 0; i < matchesToProcess.length; i++){
          let imgCmd;
          try{ imgCmd = JSON.parse(matchesToProcess[i][1]); }catch(e){ continue; }
          if(imgCmd){
            // Forzar español en el texto de la imagen
            imgCmd.prompt = imgCmd.prompt + '. IMPORTANTE: todos los textos en la imagen deben estar en español, sin palabras en inglés.';
            imgCmd.variations = 1;
            imgCmd.hasText = true;
            imgCmd._index = i + 1;
            imgCmd._total = totalImgs;
            imgCmd._social = (currentAgentCtx === 'social');
            await generateAdImages(imgCmd);
            incrementImageUsage();
            if (userPlan !== 'pro' && !isAdminUser()) break;
          }
        }
        loading=false; document.getElementById('sbtn').disabled=false; return;
      }
    }
    // Detectar parrilla con exportación a Sheets + imágenes generables
    else if(replyFinalProcessed.includes('[PARRILLA_LISTA]') || replyFinalProcessed.includes('[GENERAR_IMAGENES_PARRILLA]')){
      const cleanReply = replyFinalProcessed
        .replace(/\[PARRILLA_LISTA\]/g, '')
        .replace(/\[GENERAR_IMAGENES_PARRILLA\]/g, '')
        .trim();
      hist.push({role:'assistant', content: cleanReply});
      addAgent(cleanReply);
      if (sugerencias.length) setTimeout(() => renderSugerencias(sugerencias), 100);
      // Guardar el texto de la parrilla para exportación
      lastParrillaText = cleanReply;
      setTimeout(()=>renderParrillaImagenesBtn(), 300);
      loading=false; document.getElementById('sbtn').disabled=false; return;
    }
    else {
      // Detectar bloque ACTION_CONFIRM
      const actionConfirmMatch = replyFinalProcessed.match(/<ACTION_CONFIRM>([\s\S]*?)<\/ACTION_CONFIRM>/);
      if (actionConfirmMatch) {
        const cleanReply = replyFinalProcessed.replace(/<ACTION_CONFIRM>[\s\S]*?<\/ACTION_CONFIRM>/,'').trim();
        if (cleanReply) { hist.push({role:'assistant',content:cleanReply}); addAgent(cleanReply); }
        else { hist.push({role:'assistant',content:'Accion propuesta — confirma para ejecutar.'}); }
        try {
          const actionData = JSON.parse(actionConfirmMatch[1].trim());
          setTimeout(() => renderActionConfirmCard(actionData), 200);
        } catch(e) { console.warn('ACTION_CONFIRM parse error:', e); }
        if (sugerencias.length) setTimeout(() => renderSugerencias(sugerencias), 100);
        loading=false; document.getElementById('sbtn').disabled=false; return;
      }
      // Detectar bloque VIDEO_BRIEF
      const videoBriefMatch = replyFinalProcessed.match(/<VIDEO_BRIEF>([\s\S]*?)<\/VIDEO_BRIEF>/);
      if (videoBriefMatch) {
        const cleanReply = replyFinalProcessed.replace(/<VIDEO_BRIEF>[\s\S]*?<\/VIDEO_BRIEF>/,'').trim();
        if (cleanReply) { hist.push({role:'assistant',content:cleanReply}); addAgent(cleanReply); }
        else { hist.push({role:'assistant',content:'Brief de video generado — listo para producir.'}); }
        try {
          const briefRaw = videoBriefMatch[1].trim();
          const briefData = JSON.parse(briefRaw);
          setTimeout(() => renderVideoBriefCard(briefData), 200);
        } catch(e) {
          console.warn('VIDEO_BRIEF parse error:', e);
          // El agente puso texto en lugar de JSON — mostrar el contenido como respuesta normal
          const fallbackText = videoBriefMatch[1].trim();
          if (fallbackText && !cleanReply) {
            hist.push({role:'assistant', content: fallbackText});
            addAgent(fallbackText);
          }
        }
        if (sugerencias.length) setTimeout(() => renderSugerencias(sugerencias), 100);
        loading=false; document.getElementById('sbtn').disabled=false; return;
      }
      // Detectar bloque REPORTE_DATA
      const reportData = detectReportData(replyFinalProcessed);
      if (reportData) {
        const cleanReply = replyFinalProcessed.replace(/<REPORTE_DATA>[\s\S]*?<\/REPORTE_DATA>/,'').trim();
        if (cleanReply) { hist.push({role:'assistant',content:cleanReply}); addAgent(cleanReply); }
        else { hist.push({role:'assistant',content:'Reporte generado.'}); }
        setTimeout(() => renderReportCard(reportData), 200);
      } else {
        hist.push({role:'assistant',content:replyFinalProcessed});
        addAgent(replyFinalProcessed);
      }
      if (sugerencias.length) setTimeout(() => renderSugerencias(sugerencias), 100);
      // Guardar recomendación silenciosamente si aplica
      const recAgents = ['google-ads','meta-ads','tiktok-ads','linkedin-ads','seo','consultor'];
      if (recAgents.includes(currentAgentCtx) && replyFinalProcessed.length > 200) {
        setTimeout(() => saveRecommendation(currentAgentCtx, replyFinalProcessed), 1000);
      }
      // Actualizar snapshot con análisis si corresponde
      if (_snapshotPendingId && _snapshotAgent === currentAgentCtx) {
        const snapId = _snapshotPendingId;
        _snapshotPendingId = null; _snapshotAgent = null;
        setTimeout(() => {
          fetch('/api/admin?action=save-snapshot', {
            method: 'PATCH',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({id: snapId, analysis: replyFinalProcessed})
          }).catch(()=>{});
        }, 500);
      }
    }
    setTimeout(function(){ saveCurrentConversation(); agencyOnMessageReceived(); }, 500);
    }catch(e){console.error('callClaude error:',e);rmThinking(tid);addAgent('error de conexión. verifica tu conexión a internet e intenta de nuevo.');}loading=false;document.getElementById('sbtn').disabled=false;}
function renderSugerencias(opciones) {
  const area = document.getElementById('chat-area');
  if (!area || !opciones.length) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg';
  wrap.id = 'sugerencias-wrap';
  wrap.style.cssText = 'padding-left:42px;display:flex;flex-wrap:wrap;gap:7px;margin-top:-6px';
  wrap.innerHTML = opciones.map(op =>
    `<button onclick="qSend('${op.replace(/'/g,"\'")}');document.getElementById('sugerencias-wrap')?.remove()" style="padding:6px 13px;background:var(--bg);border:1.5px solid var(--blue-md);border-radius:20px;font-size:12px;color:var(--blue);cursor:pointer;font-family:var(--font);font-weight:500;transition:all .15s;white-space:nowrap" onmouseover="this.style.background='var(--blue-lt)'" onmouseout="this.style.background='var(--bg)'">${op}</button>`
  ).join('');
  area.appendChild(wrap);
  scrollB();
}

// ── FEATURE 1: RECOMMENDATIONS ───────────────────────────────
async function saveRecommendation(agent, content) {
  const user = window.Clerk?.user || clerkInstance?.user;
  if (!user) return;
  try {
    await fetch('/api/admin?action=save-recommendation', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({userId: user.id, agent, content})
    });
    updateHistorialBadge();
  } catch(e) { /* silencioso */ }
}

async function loadRecommendations(agentFilter) {
  const user = window.Clerk?.user || clerkInstance?.user;
  if (!user) return [];
  try {
    let url = `/api/admin?action=get-recommendations&userId=${encodeURIComponent(user.id)}`;
    if (agentFilter && agentFilter !== 'all') url += `&agent=${encodeURIComponent(agentFilter)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch(e) { return []; }
}

async function updateRecommendation(id, status) {
  try {
    await fetch('/api/admin?action=update-recommendation', {
      method: 'PATCH',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({id, status})
    });
  } catch(e) { /* silencioso */ }
}

async function updateHistorialBadge() {
  const user = window.Clerk?.user || clerkInstance?.user;
  if (!user) return;
  try {
    const res = await fetch(`/api/admin?action=get-recommendations&userId=${encodeURIComponent(user.id)}`);
    if (!res.ok) return;
    const data = await res.json();
    const pending = (data || []).filter(r => r.status === 'pending').length;
    const badge = document.getElementById('historial-badge');
    if (badge) { badge.textContent = pending; badge.style.display = pending > 0 ? 'inline-flex' : 'none'; }
  } catch(e) {}
}

function openHistorialPanel() {
  let panel = document.getElementById('historial-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'historial-panel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:380px;max-width:100vw;height:100vh;background:var(--bg);border-left:1px solid var(--border);z-index:800;display:flex;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,.08);transition:transform .25s';
    panel.innerHTML = `
      <div style="padding:18px 20px 14px;border-bottom:1px solid var(--border2);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="font-size:15px;font-weight:700;letter-spacing:-.2px">Historial</div>
        <button onclick="closeHistorialPanel()" style="background:none;border:none;cursor:pointer;padding:4px;color:var(--muted);font-size:18px;line-height:1">×</button>
      </div>
      <div style="padding:12px 20px;border-bottom:1px solid var(--border2);display:flex;gap:8px;align-items:center;flex-shrink:0">
        <div id="htab-rec" class="htab active" onclick="switchHistorialTab('rec')">Recomendaciones</div>
        <div id="htab-ana" class="htab" onclick="switchHistorialTab('ana')">Análisis</div>
        <select id="historial-agent-filter" onchange="reloadHistorialContent()" style="margin-left:auto;border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:12px;background:var(--bg);color:var(--text)">
          <option value="all">Todos</option>
          <option value="google-ads">Google Ads</option>
          <option value="meta-ads">Meta Ads</option>
          <option value="tiktok-ads">TikTok Ads</option>
          <option value="linkedin-ads">LinkedIn Ads</option>
          <option value="seo">SEO</option>
          <option value="consultor">Consultor</option>
        </select>
      </div>
      <div id="historial-body" style="flex:1;overflow-y:auto;padding:16px 20px"></div>`;
    document.body.appendChild(panel);
  }
  panel.style.display = 'flex';
  panel.style.transform = 'translateX(0)';
  reloadHistorialContent();
  updateHistorialBadge();
}

function closeHistorialPanel() {
  const panel = document.getElementById('historial-panel');
  if (panel) panel.style.display = 'none';
}

function switchHistorialTab(tab) {
  document.getElementById('htab-rec')?.classList.toggle('active', tab === 'rec');
  document.getElementById('htab-ana')?.classList.toggle('active', tab === 'ana');
  reloadHistorialContent();
}

async function reloadHistorialContent() {
  const body = document.getElementById('historial-body');
  if (!body) return;
  const tabRec = document.getElementById('htab-rec')?.classList.contains('active');
  const agent = document.getElementById('historial-agent-filter')?.value || 'all';
  body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0">Cargando...</div>';
  if (tabRec) {
    const data = await loadRecommendations(agent);
    if (!data.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0">No hay recomendaciones todavía.</div>'; return; }
    const agentColors = {'google-ads':'#4285F4','meta-ads':'#1877F2','tiktok-ads':'#010101','linkedin-ads':'#0A66C2','seo':'#059669','consultor':'#1E2BCC','social':'#D97706'};
    const agentNames = {'google-ads':'Google Ads','meta-ads':'Meta Ads','tiktok-ads':'TikTok Ads','linkedin-ads':'LinkedIn Ads','seo':'SEO','consultor':'Consultor','social':'Social'};
    body.innerHTML = data.map(r => {
      const ago = timeAgo(r.created_at);
      const color = agentColors[r.agent] || '#6B7280';
      const name = agentNames[r.agent] || r.agent;
      const preview = r.content.length > 120 ? r.content.slice(0,120)+'...' : r.content;
      const statusIcon = r.status === 'applied' ? '<span style="color:#16a34a;font-weight:600">✓ Aplicada</span>' : r.status === 'dismissed' ? '<span style="color:#9CA3AF;text-decoration:line-through">Descartada</span>' : `<button onclick="applyRec('${r.id}',this)" style="padding:3px 10px;background:var(--blue-lt);border:1px solid var(--blue-md);border-radius:6px;font-size:11px;color:var(--blue);cursor:pointer;font-weight:600" onmouseover="this.style.background='#dde0fc'" onmouseout="this.style.background='var(--blue-lt)'">Aplicar</button> <button onclick="dismissRec('${r.id}',this)" style="padding:3px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--muted);cursor:pointer" onmouseover="this.style.background='var(--border2)'" onmouseout="this.style.background='var(--bg)'">Descartar</button>`;
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:13px 14px;margin-bottom:10px;${r.status==='dismissed'?'opacity:.5':''}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:10px;font-weight:700;background:${color}20;color:${color};padding:2px 8px;border-radius:10px">${name}</span>
          <span style="font-size:11px;color:var(--muted)">${ago}</span>
        </div>
        <div style="font-size:12px;color:var(--text);line-height:1.5;margin-bottom:10px">${preview}</div>
        <div style="display:flex;gap:7px;align-items:center">${statusIcon}</div>
      </div>`;
    }).join('');
  } else {
    // Tab Análisis
    const snapshots = await loadSnapshots(agent);
    if (!snapshots.length) { body.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:20px 0">No hay análisis guardados todavía.</div>'; return; }
    const agentNames = {'google-ads':'Google Ads','meta-ads':'Meta Ads','tiktok-ads':'TikTok Ads','linkedin-ads':'LinkedIn Ads','seo':'SEO','consultor':'Consultor','social':'Social'};
    body.innerHTML = snapshots.map(s => {
      const ago = timeAgo(s.created_at);
      const name = agentNames[s.agent] || s.agent;
      const preview = s.analysis ? (s.analysis.length > 120 ? s.analysis.slice(0,120)+'...' : s.analysis) : 'Sin análisis generado.';
      return `<div style="border:1px solid var(--border);border-radius:10px;padding:13px 14px;margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="font-size:12px;font-weight:700;color:var(--text)">${s.period_label}</span>
          <span style="font-size:11px;color:var(--muted)">· ${name} · ${ago}</span>
        </div>
        <div style="font-size:12px;color:var(--muted2);line-height:1.5;margin-bottom:8px">${preview}</div>
        ${s.analysis ? `<button onclick="this.closest('div[style]').querySelector('.snap-full').style.display=this.closest('div[style]').querySelector('.snap-full').style.display==='none'?'block':'none'" style="font-size:11px;color:var(--blue);background:none;border:none;cursor:pointer;padding:0">Ver análisis completo ▾</button><div class='snap-full' style='display:none;margin-top:8px;font-size:12px;color:var(--text);line-height:1.6;white-space:pre-wrap'>${s.analysis}</div>` : ''}
      </div>`;
    }).join('');
  }
}

function applyRec(id, btn) {
  updateRecommendation(id, 'applied');
  const card = btn.closest('div[style]');
  const actionsDiv = btn.parentElement;
  actionsDiv.innerHTML = '<span style="color:#16a34a;font-weight:600">✓ Aplicada</span>';
  updateHistorialBadge();
}

function dismissRec(id, btn) {
  updateRecommendation(id, 'dismissed');
  const card = btn.closest('div[style]');
  card.style.opacity = '.5';
  const actionsDiv = btn.parentElement;
  actionsDiv.innerHTML = '<span style="color:#9CA3AF;text-decoration:line-through">Descartada</span>';
  updateHistorialBadge();
}

function timeAgo(ts) {
  const d = new Date(ts), now = new Date();
  const diff = Math.floor((now - d) / 1000);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff/60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff/3600)} h`;
  if (diff < 604800) return `hace ${Math.floor(diff/86400)} días`;
  return d.toLocaleDateString('es');
}

// ── FEATURE 2: REPORTE PDF ─────────────────────────────────
function detectReportData(text) {
  const match = text.match(/<REPORTE_DATA>([\s\S]*?)<\/REPORTE_DATA>/);
  if (!match) return null;
  try { return JSON.parse(match[1].trim()); } catch(e) { return null; }
}

var _reportCache = {};

function renderReportCard(data) {
  const reportId = 'report_' + Date.now();
  _reportCache[reportId] = data;
  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = `
    <div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg></div>
    <div style="border:1.5px solid var(--border);border-radius:12px;padding:14px 16px;background:var(--bg);max-width:380px;display:flex;align-items:center;gap:12px">
      <div style="font-size:28px;flex-shrink:0">📄</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px">${data.titulo||'Reporte'}</div>
        <div style="font-size:11px;color:var(--muted)">${data.periodo||''} · ${data.negocio||''}</div>
      </div>
      <button id="${reportId}-btn" onclick="downloadReport('${reportId}')" style="padding:8px 14px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;flex-shrink:0">Descargar PDF</button>
    </div>`;
  document.getElementById('chat-area').appendChild(el);
  scrollB();
  // Auto-generar
  setTimeout(() => downloadReport(reportId), 300);
}

function downloadReport(reportId) {
  const data = _reportCache[reportId];
  if (!data) return;
  const btn = document.getElementById(reportId + '-btn');
  if (btn) { btn.textContent = 'Generando...'; btn.disabled = true; }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    const W = 210, margin = 18, cW = W - margin*2;
    const blue = [37,99,235], gray = [55,65,81], lightGray = [243,244,246];
    const green = [22,163,74], red = [220,38,38];
    let y = margin;

    // Header
    doc.setFillColor(...blue);
    doc.rect(0,0,W,20,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('Acuarius', margin, 13);
    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text(data.negocio||'', W-margin, 13, {align:'right'});
    y = 30;

    // Título
    doc.setTextColor(...gray); doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text(data.titulo||'Reporte', margin, y); y += 7;
    doc.setFontSize(10); doc.setFont('helvetica','normal'); doc.setTextColor(107,114,128);
    doc.text(data.periodo||'', margin, y); y += 8;
    doc.setDrawColor(...blue); doc.setLineWidth(.5);
    doc.line(margin, y, W-margin, y); y += 8;

    // Resumen ejecutivo
    doc.setFillColor(...lightGray);
    doc.roundedRect(margin, y, cW, 2,'r','F');
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...gray);
    doc.text('Resumen Ejecutivo', margin, y+6); y += 10;
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...gray);
    const resumLines = doc.splitTextToSize(data.resumen_ejecutivo||'', cW);
    doc.setFillColor(...lightGray);
    doc.roundedRect(margin, y-2, cW, resumLines.length*5+8, 2,'F');
    doc.text(resumLines, margin+4, y+4); y += resumLines.length*5+14;

    // Métricas
    doc.setFontSize(11); doc.setFont('helvetica','bold'); doc.setTextColor(...gray);
    doc.text('Métricas Principales', margin, y); y += 7;
    const metrics = data.metricas || [];
    const cols = 3, cellW = cW/cols, cellH = 18;
    metrics.slice(0,6).forEach((m, i) => {
      const col = i % cols, row = Math.floor(i/cols);
      const x = margin + col*cellW, cy = y + row*cellH;
      doc.setFillColor(...lightGray); doc.roundedRect(x+1, cy, cellW-2, cellH-2, 2, 'F');
      doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.setTextColor(107,114,128);
      doc.text(m.nombre||'', x+3, cy+5);
      doc.setFontSize(12); doc.setFont('helvetica','bold'); doc.setTextColor(...gray);
      doc.text(String(m.valor||''), x+3, cy+12);
      if (m.cambio) {
        const isUp = m.tendencia === 'up';
        doc.setFontSize(8); doc.setFont('helvetica','normal');
        doc.setTextColor(...(isUp ? green : red));
        doc.text(m.cambio, x+cellW-3, cy+12, {align:'right'});
      }
    });
    y += Math.ceil(metrics.length/cols)*cellH + 10;

    // Análisis — check if new page needed
    if (y > 220) { doc.addPage(); y = margin; }
    doc.setDrawColor(...blue); doc.line(margin, y, W-margin, y); y += 6;
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
    doc.text('Análisis Detallado', margin, y); y += 8;
    (data.analisis||[]).forEach(a => {
      if (y > 255) { doc.addPage(); y = margin; }
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
      doc.text(a.titulo||'', margin, y); y += 5;
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...gray);
      const lines = doc.splitTextToSize(a.contenido||'', cW);
      doc.text(lines, margin, y); y += lines.length*5+6;
    });

    // Recomendaciones
    if (y > 220) { doc.addPage(); y = margin; }
    doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
    doc.text('Recomendaciones', margin, y); y += 8;
    const priorColors = {alta:[220,38,38], media:[217,119,6], baja:[107,114,128]};
    (data.recomendaciones||[]).forEach(r => {
      if (y > 260) { doc.addPage(); y = margin; }
      const pc = priorColors[r.prioridad]||[107,114,128];
      doc.setFillColor(...pc); doc.circle(margin+2, y-1, 2,'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...gray);
      const lines = doc.splitTextToSize(r.accion||'', cW-8);
      doc.text(lines, margin+7, y); y += lines.length*5+5;
    });

    // Próximos pasos
    if (y > 220) { doc.addPage(); y = margin; }
    if (data.proximos_pasos) {
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(...blue);
      doc.text('Próximos Pasos', margin, y); y += 7;
      doc.setFillColor(...lightGray); doc.setDrawColor(...blue); doc.setLineWidth(.5);
      const psLines = doc.splitTextToSize(data.proximos_pasos, cW-6);
      doc.rect(margin, y-2, cW, psLines.length*5+8,'F');
      doc.line(margin, y-2, margin, y-2+psLines.length*5+8);
      doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...gray);
      doc.text(psLines, margin+4, y+4); y += psLines.length*5+14;
    }

    // Footer en cada página
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor(156,163,175);
      doc.text(`Generado por Acuarius · acuarius.app · ${new Date().toLocaleDateString('es')}`, W/2, 292, {align:'center'});
    }

    const filename = `reporte-${(data.negocio||'acuarius').replace(/\s+/g,'-')}-${(data.periodo||'').replace(/\s+/g,'-')}.pdf`;
    doc.save(filename);
    if (btn) { btn.textContent = '✓ Descargado'; btn.style.background = '#16a34a'; btn.disabled = false; }
    // Log en servidor (silencioso)
    const userId = (window.Clerk?.user || clerkInstance?.user)?.id;
    if (userId) fetch('/api/generate-report', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data,userId})}).catch(()=>{});
  } catch(err) {
    console.error('PDF error:', err);
    if (btn) { btn.textContent = 'Error — reintentar'; btn.disabled = false; }
  }
}

// ── FEATURE 3: LINKEDIN ADS ACTION CARDS ──────────────────
function showLinkedInActionCards() {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  var html = '';
  html += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
  html += '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>';
  html += '<div style="font-size:13px;font-weight:600;color:var(--text)">¿qué quieres hacer?</div>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;width:100%;max-width:520px;padding-left:40px">';

  var cards = [
    {icon:'🏢',title:'Planear campaña B2B',desc:'Estructura completa para tomadores de decisión',prompt:'Ayúdame a planear una campaña de LinkedIn Ads B2B desde cero'},
    {icon:'🎯',title:'Definir segmentación',desc:'Cargo, industria y empresa para LatAm',prompt:'Ayúdame a definir la segmentación profesional para mi campaña de LinkedIn'},
    {icon:'✍️',title:'Crear anuncios',desc:'Copys y creatividades para audiencias ejecutivas',prompt:'Necesito crear anuncios profesionales para LinkedIn Ads'},
    {icon:'📊',title:'Analizar campañas',desc:'Métricas del Campaign Manager con benchmarks B2B',prompt:'Analiza el rendimiento de mis campañas de LinkedIn Ads'}
  ];
  cards.forEach(function(c) {
    html += '<div onclick="dismissLinkedInCards(this);qSend(\'' + c.prompt.replace(/'/g,"\\'") + '\')" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 14px;cursor:pointer;background:var(--bg);transition:all .15s" onmouseover="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.background=\'var(--bg)\';this.style.transform=\'\'">';
    html += '<div style="font-size:18px;margin-bottom:6px">' + c.icon + '</div>';
    html += '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:2px">' + c.title + '</div>';
    html += '<div style="font-size:11px;color:var(--muted2)">' + c.desc + '</div>';
    html += '</div>';
  });

  // Card 5 full-width
  html += '<div onclick="dismissLinkedInCards(this);qSend(\'Diagnostica por qué mis campañas de LinkedIn no están generando los resultados esperados\')" style="border:2px solid var(--blue-md);border-radius:12px;padding:14px 16px;cursor:pointer;background:var(--blue-lt);transition:all .15s;grid-column:1/-1" onmouseover="this.style.borderColor=\'var(--blue)\';this.style.background=\'#E0E3FC\';this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\';this.style.transform=\'\'">';
  html += '<div style="display:flex;align-items:center;gap:10px">';
  html += '<div style="font-size:22px">🔍</div><div>';
  html += '<div style="font-size:13px;font-weight:700;color:var(--blue);margin-bottom:2px">Diagnosticar resultados</div>';
  html += '<div style="font-size:11px;color:var(--blue);opacity:.75">Encuentra por qué tu campaña no está convirtiendo</div>';
  html += '</div></div></div>';
  html += '</div>';
  el.innerHTML = html;
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}
function dismissLinkedInCards(el) { var msg = el.closest('.msg'); if (msg) msg.style.display = 'none'; }

// ── FEATURE 4: ANÁLISIS PERIÓDICO ─────────────────────────
var _snapshotPendingId = null;
var _snapshotAgent = null;

const PERIODIC_METRICS = {
  'google-ads':   ['Impresiones','Clicks','CTR (%)','CPC ($)','Conversiones','CPA ($)','Gasto total ($)'],
  'meta-ads':     ['Impresiones','Alcance','CTR (%)','CPM ($)','Conversiones','CPA ($)','Gasto total ($)'],
  'tiktok-ads':   ['Impresiones','Alcance','VVR (%)','CTR (%)','Conversiones','CPA ($)','Gasto total ($)'],
  'linkedin-ads': ['Impresiones','Clicks','CTR (%)','CPC ($)','Leads','CPL ($)','Gasto total ($)'],
  'seo':          ['Sesiones orgánicas','Posición promedio','Clicks Search Console','Impresiones SC','Páginas/sesión','Tasa de rebote (%)'],
  'consultor':    ['Presupuesto total ($)','Canales activos','Leads generados','Costo por lead ($)','ROAS general']
};

const PREV_METRICS = {
  'google-ads': ['Impresiones','Clicks','CPA ($)'],
  'meta-ads':   ['Impresiones','Conversiones','CPA ($)'],
  'tiktok-ads': ['Impresiones','Conversiones','CPA ($)'],
  'linkedin-ads':['Impresiones','Leads','CPL ($)'],
  'seo':        ['Sesiones orgánicas','Posición promedio','Clicks SC'],
  'consultor':  ['Leads generados','Costo por lead ($)','ROAS general']
};

function openAnalisisModal() {
  const agent = currentAgentCtx;
  const agentNames = {'google-ads':'Google Ads','meta-ads':'Meta Ads','tiktok-ads':'TikTok Ads','linkedin-ads':'LinkedIn Ads','seo':'SEO','social':'Social','consultor':'Consultor'};
  const metrics = PERIODIC_METRICS[agent] || PERIODIC_METRICS['google-ads'];
  const prevMetrics = PREV_METRICS[agent] || PREV_METRICS['google-ads'];
  const now = new Date();
  const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const defaultPeriod = months[now.getMonth()] + ' ' + now.getFullYear();

  let existing = document.getElementById('analisis-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'analisis-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:14px;padding:24px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
        <div style="font-size:15px;font-weight:700;letter-spacing:-.2px">📊 Análisis periódico · ${agentNames[agent]||agent}</div>
        <button onclick="document.getElementById('analisis-modal').remove()" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--muted)">×</button>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:14px">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="radio" name="period-type" value="weekly" id="pt-weekly"> Semanal
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">
          <input type="radio" name="period-type" value="monthly" id="pt-monthly" checked> Mensual
        </label>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;color:var(--muted2);display:block;margin-bottom:5px">PERÍODO</label>
        <input id="am-period" type="text" value="${defaultPeriod}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 11px;font-size:13px;background:var(--bg);color:var(--text)">
      </div>
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:600;color:var(--muted2);margin-bottom:10px">MÉTRICAS DEL PERÍODO</div>
        ${metrics.map(m => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><label style="font-size:12px;color:var(--text);width:160px;flex-shrink:0">${m}</label><input data-metric="${m}" type="text" placeholder="0" style="flex:1;border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-size:13px;background:var(--bg);color:var(--text)"></div>`).join('')}
      </div>
      <details style="margin-bottom:14px">
        <summary style="font-size:12px;font-weight:600;color:var(--muted2);cursor:pointer;margin-bottom:8px">PERÍODO ANTERIOR (opcional)</summary>
        <div style="margin-top:8px">
          ${prevMetrics.map(m => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><label style="font-size:12px;color:var(--text);width:160px;flex-shrink:0">${m}</label><input data-prev-metric="${m}" type="text" placeholder="0" style="flex:1;border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-size:13px;background:var(--bg);color:var(--text)"></div>`).join('')}
        </div>
      </details>
      <div style="margin-bottom:18px">
        <label style="font-size:12px;font-weight:600;color:var(--muted2);display:block;margin-bottom:5px">NOTAS ADICIONALES</label>
        <textarea id="am-notes" rows="2" placeholder="Contexto extra, anomalías, eventos del período..." style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 11px;font-size:13px;background:var(--bg);color:var(--text);resize:vertical;font-family:var(--font)"></textarea>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="document.getElementById('analisis-modal').remove()" style="padding:9px 18px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:13px;cursor:pointer;color:var(--muted)">Cancelar</button>
        <button onclick="submitAnalisis()" style="padding:9px 18px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Analizar con IA →</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function submitAnalisis() {
  const modal = document.getElementById('analisis-modal');
  if (!modal) return;
  const agent = currentAgentCtx;
  const periodLabel = document.getElementById('am-period')?.value?.trim() || 'Período actual';
  const periodType = document.querySelector('input[name="period-type"]:checked')?.value || 'monthly';
  const notes = document.getElementById('am-notes')?.value?.trim() || '';

  const metrics = {};
  modal.querySelectorAll('[data-metric]').forEach(inp => {
    if (inp.value.trim()) metrics[inp.dataset.metric] = inp.value.trim();
  });
  const prevMetrics = {};
  modal.querySelectorAll('[data-prev-metric]').forEach(inp => {
    if (inp.value.trim()) prevMetrics[inp.dataset.prevMetric] = inp.value.trim();
  });

  modal.remove();

  // Save snapshot
  const user = window.Clerk?.user || clerkInstance?.user;
  if (user) {
    try {
      const res = await fetch('/api/admin?action=save-snapshot', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({userId: user.id, agent, period_label: periodLabel, period_type: periodType, metrics})
      });
      const json = await res.json();
      _snapshotPendingId = json.id;
      _snapshotAgent = agent;
    } catch(e) {}
  }

  // Build prompt and inject into chat
  showView('chat');
  const metricsText = buildMetricsPrompt({period_label: periodLabel, metrics, prev_metrics: prevMetrics, notes}, agent);
  const cin = document.getElementById('cin');
  if (cin) { cin.value = metricsText; sendMsg(); }
}

function buildMetricsPrompt(data, agent) {
  let txt = 'Aquí están mis métricas de ' + (data.period_label || 'este período') + ':\n\n';
  Object.entries(data.metrics || {}).forEach(([k,v]) => { if (v) txt += k + ': ' + v + '\n'; });
  if (data.prev_metrics && Object.values(data.prev_metrics).some(v => v)) {
    txt += '\nPeríodo anterior:\n';
    Object.entries(data.prev_metrics).forEach(([k,v]) => { if (v) txt += k + ': ' + v + '\n'; });
  }
  if (data.notes) txt += '\nNotas: ' + data.notes;
  txt += '\n\nPor favor analiza el rendimiento, identifica tendencias, y dame recomendaciones priorizadas para el siguiente período.';
  return txt;
}

// ── SPRINT 3: ACTIVE CLIENT CONTEXT ──────────────────────
function openAgentForClient(agentKey, client) {
  agencyActiveClientId = client.id; // necesario para que getProfileKey use el cliente correcto
  activeClientContext = {
    clientId:      client.id,
    clientName:    client.client_name || client.name || '',
    clientIndustry: client.client_industry || '',
    monthlyBudget: client.monthly_budget || '',
    notes:         client.notes || '',
  };
  updateActiveClientBar();
  openAgent(agentKey);
}

function clearActiveClientContext() {
  activeClientContext = null;
  updateActiveClientBar();
}

function updateActiveClientBar() {
  const bar  = document.getElementById('agency-ctx-bar');
  const name = document.getElementById('agency-ctx-name');
  if (!bar) return;
  if (activeClientContext) {
    if (name) name.textContent = activeClientContext.clientName;
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

// ── SPRINT 3: COMPETITIVE SEARCH ─────────────────────────
async function enrichWithCompetitiveData(userMessage, agentKey) {
  if (!['consultor', 'seo'].includes(agentKey)) return userMessage;
  const competitiveKeywords = ['competencia', 'competidores', 'competidor', 'quien aparece',
    'quién aparece', 'que estan haciendo', 'qué están haciendo', 'analisis de mercado',
    'análisis de mercado', 'benchmark'];
  const isCompetitiveQuery = competitiveKeywords.some(k => userMessage.toLowerCase().includes(k));
  if (!isCompetitiveQuery) return userMessage;

  const profile = mem;
  if (!profile?.negocio || !profile?.industria) return userMessage;

  try {
    const query = profile.negocio + ' ' + profile.industria + ' ' + (profile.pais || 'Colombia');
    const res = await fetch('/api/admin?action=competitive-search', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ query, type: 'serp' })
    });
    if (!res.ok) return userMessage;
    const data = await res.json();
    if (!data.results?.length) return userMessage;
    const context = data.results.slice(0, 8).map((r, i) =>
      (i + 1) + '. ' + r.title + '\n   URL: ' + r.url + '\n   ' + (r.description || '')
    ).join('\n\n');
    return userMessage + '\n\n[DATOS DE BUSQUEDA REAL — usar para el analisis]\n' + context;
  } catch(e) { return userMessage; }
}

// ── SPRINT 3: ACTION CONFIRM CARD ────────────────────────
function renderActionConfirmCard(actionData) {
  const area = document.getElementById('chat-area');
  if (!area || !actionData) return;
  const params = actionData.params || {};
  const isReversible = actionData.reversible !== false;
  const danger = actionData.dangerLevel || 'medium';

  let detailsHtml = '';
  const friendlyLabels = {
    campaignName: 'Campaña',
    status: 'Estado nuevo',
    currentBudget: 'Presupuesto actual',
    newBudget: 'Presupuesto nuevo',
    keywordText: 'Keyword',
    currentBid: 'Puja actual',
    newBid: 'Puja nueva',
    adGroupName: 'Grupo de anuncios',
  };
  Object.entries(friendlyLabels).forEach(([k, label]) => {
    if (params[k] !== undefined) {
      let valHtml = String(params[k]);
      if (k === 'status') {
        valHtml = params[k] === 'PAUSED'
          ? '<span class="status-paused">○ Pausada</span>'
          : '<span class="status-active">● Activa</span>';
      }
      detailsHtml += '<div class="action-confirm-detail"><span class="label">' + label + ':</span><span class="value">' + valHtml + '</span></div>';
    }
  });

  const safeData = JSON.stringify(actionData).replace(/'/g, "\\'");
  const btnClass = danger === 'high' ? 'btn-execute danger' : 'btn-execute';

  const wrap = document.createElement('div');
  wrap.className = 'msg';
  wrap.innerHTML = '<div class="action-confirm-card">' +
    '<div class="action-confirm-header">' +
      '<span class="action-confirm-icon">⚡</span>' +
      '<span class="action-confirm-title">' + (actionData.label || 'Accion propuesta') + '</span>' +
      '<span class="action-confirm-badge ' + (isReversible ? 'reversible' : 'irreversible') + '">' + (isReversible ? 'Reversible' : 'Irreversible') + '</span>' +
    '</div>' +
    '<div class="action-confirm-body">' + detailsHtml + '</div>' +
    '<div class="action-confirm-footer">' +
      '<button class="btn-cancel" onclick="this.closest(\'.msg\').remove()">Cancelar</button>' +
      '<button class="' + btnClass + '" onclick="executeAction(\'' + safeData.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\', this)">' + (actionData.confirmText || 'Confirmar') + '</button>' +
    '</div>' +
  '</div>';
  area.appendChild(wrap);
  scrollB();
}

async function executeAction(actionDataStr, btn) {
  let actionData;
  try { actionData = JSON.parse(actionDataStr); } catch(e) { return; }

  const userId = clerkInstance?.user?.id;
  if (!userId) { addAgent('Error: no hay sesion activa.'); return; }

  btn.disabled = true;
  btn.textContent = 'Ejecutando...';

  const params = actionData.params || {};
  const endpoint = '/api/google-ads?action=' + actionData.action + '&userId=' + encodeURIComponent(userId) + '&customerId=' + (params.customerId || '');

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ ...params, userId, confirm: true }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      btn.disabled = false;
      btn.textContent = actionData.confirmText || 'Confirmar';
      addAgent('Error al ejecutar: ' + (data.error || 'Error desconocido') + '. Puedes hacerlo manualmente en Google Ads.');
      return;
    }

    // Success
    btn.closest('.msg').remove();
    addAgent('Hecho. ' + (data.campaignName || data.adGroupName || data.keywordText || '') +
      (data.newStatus ? ' — estado: ' + data.newStatus : '') +
      (data.newBudget ? ' — nuevo presupuesto: $' + data.newBudget + '/dia' : '') +
      (data.newBid ? ' — nueva puja: $' + data.newBid : ''));

    // Audit log
    fetch('/api/admin?action=log-api-action', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        userId, platform: 'google_ads', actionType: actionData.action,
        entityId: params.campaignId || params.adGroupId || params.criterionId,
        entityName: params.campaignName || params.adGroupName || params.keywordText,
        newValue: params, confirmed: true,
      }),
    }).catch(()=>{});

  } catch(e) {
    btn.disabled = false;
    btn.textContent = actionData.confirmText || 'Confirmar';
    addAgent('Error de conexion al ejecutar la accion. Intenta de nuevo.');
  }
}

// ── VIDEO AD GENERATION (Seedance 2.0 / BytePlus) ────────────────────────────

// Abre el formulario de video pre-llenado con el contexto del cliente activo
// Usado por los botones de acción de Meta/TikTok — evita pasar por el agente
function showVideoAdFormWithContext() {
  showVideoAdForm();
  // Esperar a que el formulario se renderice (incluye fetch a /api/video-credits)
  setTimeout(() => {
    const desc = document.getElementById('vaf-desc');
    if (!desc || desc.value.trim()) return; // ya tiene contenido o no existe

    // Construir descripción desde el perfil del cliente activo
    const parts = [];
    if (mem.negocio)     parts.push(mem.negocio);
    if (mem.descripcion) parts.push(mem.descripcion);
    else if (mem.producto) parts.push(mem.producto);
    if (mem.diferenciador) parts.push(mem.diferenciador);
    if (mem.audiencia)   parts.push('Audiencia: ' + mem.audiencia);
    if (mem.industria && !parts.some(p => p.toLowerCase().includes(mem.industria.toLowerCase())))
      parts.push('Sector: ' + mem.industria);

    if (parts.length) {
      desc.value = parts.join('. ');
      // Resize automático del textarea
      desc.style.height = 'auto';
      desc.style.height = desc.scrollHeight + 'px';
      desc.style.borderColor = '#7C3AED'; // highlight para que el usuario vea que está listo
    }
  }, 700);
}

async function showVideoAdForm() {
  const chatBox = document.getElementById('chat-area');

  // ── Verificar créditos antes de mostrar el formulario ──────────────────────
  let credits = null;
  try {
    const tok = sessionToken || (clerkInstance?.session ? await clerkInstance.session.getToken().catch(()=>null) : null);
    const r = await fetch('/api/video-credits', { headers: tok ? { 'Authorization': 'Bearer ' + tok } : {} });
    if (r.ok) credits = await r.json();
  } catch(e) { /* fail open: mostrar formulario aunque no se pueda verificar */ }

  // Sin créditos → mostrar paywall
  if (credits && credits.available <= 0) {
    const el = document.createElement('div');
    el.className = 'msg agent';
    const url5  = 'https://pay.hotmart.com/R105597226A?off=2muq4ex2';
    const url10 = 'https://pay.hotmart.com/R105597226A?off=mfjz53b5';
    el.innerHTML =
      '<div style="background:var(--bg);border:2px solid #E5E7EB;border-radius:16px;padding:20px;max-width:480px;width:100%">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
          '<span style="font-size:22px">🎬</span>' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:var(--text)">Crear video ad con IA</div>' +
            (credits.is_free
              ? '<div style="font-size:11px;color:#EF4444;font-weight:600">Plan gratuito · video de prueba utilizado</div>'
              : '<div style="font-size:11px;color:#EF4444;font-weight:600">Usaste tus ' + credits.monthly_limit + ' videos de este mes</div>') +
          '</div>' +
        '</div>' +
        '<div style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:10px;padding:14px;margin-bottom:16px">' +
          '<div style="font-size:12px;font-weight:700;color:#92400E;margin-bottom:6px">⚡ Sin créditos disponibles</div>' +
          '<div style="font-size:12px;color:#78350F;line-height:1.6">' +
            (credits.is_free
              ? 'El plan gratuito incluye 1 video de prueba. Actualiza a Pro para obtener 5 videos/mes incluidos.'
              : 'Tu plan incluye ' + credits.monthly_limit + ' videos/mes. Compra créditos extra o espera al próximo ciclo.') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
          (credits.is_free
            ? '<a href="/pricing.html" style="display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;background:#7C3AED;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">🚀 Actualizar a Pro — 5 videos/mes incluidos</a>'
            : '') +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<a href="' + url5 + '" target="_blank" style="display:flex;flex-direction:column;align-items:center;padding:12px 10px;background:#7C3AED;color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;text-align:center;gap:3px">' +
              '<span style="font-size:18px">🎬</span>' +
              '<span>5 créditos</span>' +
              '<span style="font-size:15px;font-weight:800">$9.90</span>' +
            '</a>' +
            '<a href="' + url10 + '" target="_blank" style="display:flex;flex-direction:column;align-items:center;padding:12px 10px;background:#6D28D9;color:#fff;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;text-align:center;gap:3px;position:relative">' +
              '<span style="position:absolute;top:-8px;background:#F59E0B;color:#fff;font-size:9px;padding:2px 7px;border-radius:20px;font-weight:700">MEJOR VALOR</span>' +
              '<span style="font-size:18px">🎬🎬</span>' +
              '<span>10 créditos</span>' +
              '<span style="font-size:15px;font-weight:800">$16.90</span>' +
            '</a>' +
          '</div>' +
          '<div style="font-size:10px;color:var(--muted);text-align:center;margin-top:2px">Los créditos extra no vencen · Se suman a tu plan actual</div>' +
        '</div>' +
      '</div>';
    chatBox.appendChild(el);
    chatBox.scrollTop = chatBox.scrollHeight;
    return;
  }

  // ── Mostrar formulario con contador de créditos ────────────────────────────
  const creditsBadge = credits
    ? '<span style="font-size:11px;background:#EDE9FE;color:#7C3AED;padding:3px 8px;border-radius:20px;font-weight:600">' + credits.available + ' crédito' + (credits.available !== 1 ? 's' : '') + ' disponible' + (credits.available !== 1 ? 's' : '') + '</span>'
    : '';

  const el = document.createElement('div');
  el.className = 'msg agent';
  el.innerHTML =
    '<div style="background:var(--bg);border:2px solid #7C3AED;border-radius:16px;padding:20px;max-width:520px;width:100%">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
        '<span style="font-size:22px">🎬</span>' +
        '<div style="flex:1">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text)">Crear video ad con IA</div>' +
            creditsBadge +
          '</div>' +
          '<div style="font-size:11px;color:var(--muted2)">Seedance 2.0 · ~60 seg · 1 crédito por video</div>' +
        '</div>' +
      '</div>' +

      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px;letter-spacing:.5px">FOTO DEL PRODUCTO <span style="color:#7C3AED">★ recomendado</span></label>' +
        '<div id="vaf-img-drop" onclick="document.getElementById(\'vaf-img-input\').click()" style="border:1.5px dashed #7C3AED;border-radius:8px;padding:10px;cursor:pointer;background:#F5F3FF;display:flex;align-items:center;gap:10px;transition:background .15s" onmouseover="this.style.background=\'#EDE9FE\'" onmouseout="this.style.background=\'#F5F3FF\'">' +
          '<input type="file" id="vaf-img-input" accept="image/*" style="display:none" onchange="vafPreviewImage(this)">' +
          '<span style="font-size:18px">📷</span>' +
          '<div id="vaf-img-label" style="font-size:12px;color:#7C3AED;font-weight:500">Subir foto del producto (mejora el resultado y evita filtros de contenido)</div>' +
        '</div>' +
        '<div id="vaf-img-preview" style="display:none;margin-top:6px"><img id="vaf-img-thumb" style="max-height:70px;border-radius:6px;border:1.5px solid #7C3AED"></div>' +
      '</div>' +

      '<div style="margin-bottom:12px">' +
        '<label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px;letter-spacing:.5px">DESCRIBE TU PRODUCTO O ESCENA</label>' +
        '<textarea id="vaf-desc" placeholder="Ej: Shampoo orgánico en botella blanca elegante, cabello brillante y natural, ingredientes como aloe vera y coco..." style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:12px;resize:vertical;min-height:60px;background:var(--sidebar2);color:var(--text);box-sizing:border-box;outline:none"></textarea>' +
      '</div>' +

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">' +
        '<div>' +
          '<label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px;letter-spacing:.5px">PLATAFORMA</label>' +
          '<select id="vaf-platform" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:12px;background:var(--sidebar2);color:var(--text);outline:none">' +
            '<option value="9:16|Meta Reels">Reels / Stories 9:16</option>' +
            '<option value="9:16|TikTok">TikTok In-Feed 9:16</option>' +
            '<option value="1:1|Meta Feed">Feed cuadrado 1:1</option>' +
            '<option value="16:9|YouTube">YouTube / Horizontal 16:9</option>' +
          '</select>' +
        '</div>' +
        '<div>' +
          '<label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:6px;letter-spacing:.5px">ESTILO VISUAL</label>' +
          '<select id="vaf-style" style="width:100%;padding:8px 10px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--font);font-size:12px;background:var(--sidebar2);color:var(--text);outline:none">' +
            '<option value="cinematic">Cinematic (premium)</option>' +
            '<option value="realistic">UGC / Orgánico</option>' +
            '<option value="realistic">Lifestyle</option>' +
            '<option value="3d_render">Producto hero</option>' +
          '</select>' +
        '</div>' +
      '</div>' +

      '<div style="margin-bottom:16px">' +
        '<label style="font-size:11px;font-weight:600;color:var(--muted);display:block;margin-bottom:8px;letter-spacing:.5px">DURACIÓN</label>' +
        '<div style="display:flex;gap:12px">' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text)"><input type="radio" name="vaf-dur" value="10" checked style="accent-color:#7C3AED"> 10 segundos</label>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;color:var(--text)"><input type="radio" name="vaf-dur" value="15" style="accent-color:#7C3AED"> 15 segundos</label>' +
        '</div>' +
      '</div>' +

      '<button onclick="submitVideoAdForm(this)" style="width:100%;padding:11px;background:#7C3AED;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:8px;transition:opacity .15s">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
        'Generar video con IA' +
      '</button>' +
    '</div>';
  chatBox.appendChild(el);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function vafPreviewImage(input) {
  if (!input.files || !input.files[0]) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('vaf-img-thumb').src = e.target.result;
    document.getElementById('vaf-img-preview').style.display = 'block';
    document.getElementById('vaf-img-label').textContent = input.files[0].name;
  };
  reader.readAsDataURL(input.files[0]);
}

async function submitVideoAdForm(btn) {
  const desc = document.getElementById('vaf-desc').value.trim();
  if (!desc) {
    document.getElementById('vaf-desc').style.borderColor = '#EF4444';
    document.getElementById('vaf-desc').focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Preparando…';

  const platformVal = document.getElementById('vaf-platform').value;
  const [aspectRatio, platform] = platformVal.split('|');
  const style = document.getElementById('vaf-style').value;
  const duration = parseInt(document.querySelector('input[name="vaf-dur"]:checked').value);

  // Construir prompt rico y cinematográfico para Seedance 2.0
  const cameraMovements = {
    cinematic: 'slow cinematic dolly-in, shallow depth of field, anamorphic bokeh, rack focus reveal',
    realistic: 'slight handheld movement, organic camera drift, authentic POV, natural imperfections',
    '3d_render': 'smooth orbit rotation, dramatic reveal from low angle, 360 product turntable',
  };
  const lightingStyle = {
    cinematic: 'warm golden hour lighting, dramatic shadows, premium color grading with teal and orange tones',
    realistic: 'natural soft daylight, window light diffusion, true-to-life colors, no harsh shadows',
    '3d_render': 'studio three-point lighting, dramatic top backlight, clean white or dark background, product highlights',
  };
  const platformContext = aspectRatio === '9:16'
    ? 'vertical social media ad, mobile-first composition, subject centered in frame'
    : aspectRatio === '1:1'
    ? 'square social media ad, balanced centered composition'
    : 'horizontal widescreen ad, cinematic letterbox composition';
  const motionStyle = duration <= 10
    ? 'tight edit, one hero moment, single product reveal'
    : 'multi-moment narrative, 2-3 scene cuts, beginning-middle-end structure';
  const prompt =
    (lightingStyle[style] || lightingStyle.cinematic) + ', ' +
    (cameraMovements[style] || cameraMovements.cinematic) + '. ' +
    'Subject: ' + desc + '. ' +
    platformContext + '. ' + motionStyle + '. ' +
    'Professional advertising quality, high production value, no text overlays, photorealistic, 4K detail.';

  // Leer y comprimir imagen de referencia si existe
  let referenceImage = null;
  const imgInput = document.getElementById('vaf-img-input');
  if (imgInput && imgInput.files && imgInput.files[0]) {
    referenceImage = await new Promise(resolve => {
      const file = imgInput.files[0];
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const max = 1024;
        let w = img.width, h = img.height;
        if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = URL.createObjectURL(file);
    });
  }

  const briefData = { prompt, aspect_ratio: aspectRatio, duration, resolution: '1080p', style, platform, description: desc, reference_image: referenceImage };
  btn.closest('.msg').remove();
  renderVideoBriefCard(briefData);
}

// Map global para brief de video — evita pasar JSON por onclick (rompe con apóstrofes/paréntesis)
const _videoBriefMap = new Map();

function renderVideoBriefCard(briefData) {
  const chatBox = document.getElementById('chat-area');
  if (!chatBox) return;

  const formatLabels = { '9:16':'Vertical 9:16', '1:1':'Cuadrado 1:1', '16:9':'Horizontal 16:9' };
  const platformIcon = briefData.platform && briefData.platform.toLowerCase().includes('tiktok') ? '🎵' : '📱';

  // Guardar en Map para evitar problemas con caracteres especiales en onclick
  const briefId = 'vbr_' + Date.now();
  _videoBriefMap.set(briefId, briefData);

  const card = document.createElement('div');
  card.className = 'msg agent';
  card.innerHTML =
    '<div class="video-brief-card">' +
      '<div class="video-brief-header">' +
        '<span class="video-brief-icon">' + platformIcon + '</span>' +
        '<span class="video-brief-title">Brief de video publicitario</span>' +
        '<span class="video-brief-platform">' + (briefData.platform || 'Video Ad') + '</span>' +
      '</div>' +
      '<div class="video-brief-specs">' +
        '<span class="video-brief-spec">' + (formatLabels[briefData.aspect_ratio] || briefData.aspect_ratio) + '</span>' +
        '<span class="video-brief-spec">' + (briefData.duration || 10) + ' seg</span>' +
        '<span class="video-brief-spec">' + (briefData.resolution || '1080p') + '</span>' +
        (briefData.style ? '<span class="video-brief-spec">' + briefData.style + '</span>' : '') +
      '</div>' +
      (briefData.description ? '<div class="video-brief-description">' + briefData.description + '</div>' : '') +
      '<div class="video-brief-prompt">' + (briefData.prompt || '') + '</div>' +
      '<div class="video-brief-footer">' +
        '<button class="btn-generate" data-brief-id="' + briefId + '" onclick="generateVideo(this.dataset.briefId, this)">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
          'Generar video' +
        '</button>' +
        '<span class="video-brief-cost">~$0.30 · ~60 seg</span>' +
      '</div>' +
    '</div>';

  chatBox.appendChild(card);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function generateVideo(briefId, btn) {
  const briefData = _videoBriefMap.get(briefId);
  if (!briefData) { console.error('Brief no encontrado:', briefId); return; }

  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Generando...';

  // Mostrar barra de progreso
  const card = btn.closest('.video-brief-card');
  const progress = document.createElement('div');
  progress.className = 'video-gen-progress';
  progress.innerHTML = '<div class="video-gen-spinner"></div><span>Enviando a Seedance 2.0… esto tarda ~60 segundos</span>';
  card.appendChild(progress);

  try {
    // 1. Submit job
    const submitRes = await fetch('/api/video-gen', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        action: 'submit',
        prompt: briefData.prompt,
        aspect_ratio: briefData.aspect_ratio || '9:16',
        duration: briefData.duration || 10,
        resolution: briefData.resolution || '1080p',
        style: briefData.style || null,
        reference_image: briefData.reference_image || null,
      })
    });

    const submitData = await submitRes.json();
    if (!submitRes.ok || !submitData.job_id) throw new Error(submitData.error || 'Error al iniciar generación');

    const jobId = submitData.job_id;
    progress.querySelector('span').textContent = 'Video en proceso… (ID: ' + jobId.slice(0,8) + '…)';

    // 2. Poll hasta completado (máx 3 min, cada 5 seg)
    let videoUrl = null;
    let attempts = 0;
    while (attempts < 36) {
      await new Promise(r => setTimeout(r, 5000));
      attempts++;

      const statusRes = await fetch('/api/video-gen', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'status', job_id: jobId })
      });
      let statusData;
      try { statusData = await statusRes.json(); } catch(je) {
        const txt = await statusRes.text().catch(()=>'');
        throw new Error('Status no-JSON HTTP ' + statusRes.status + ': ' + txt.slice(0,200));
      }
      if (!statusRes.ok) throw new Error('Status error ' + statusRes.status + ': ' + (statusData.error || statusData._debug || JSON.stringify(statusData).slice(0,200)));

      if (statusData.status === 'completed' && statusData.video_url) {
        videoUrl = statusData.video_url;
        break;
      } else if (statusData.status === 'failed') {
        throw new Error(statusData.error || 'La generación falló. Debug: ' + (statusData._debug || ''));
      }
      const elapsed = attempts * 5;
      if (statusData._debug) console.log('[video-gen debug]', statusData._debug);
      const progressMsg =
        elapsed < 20  ? 'Procesando tu brief con IA…' :
        elapsed < 50  ? 'Generando el video… esto tarda ~60 segundos' :
        elapsed < 90  ? 'Casi listo, renderizando frames…' :
                        'Finalizando… un momento más';
      progress.querySelector('span').textContent = progressMsg;
      if (statusData.status === 'completed' && !statusData.video_url) {
        throw new Error('Video completado pero URL no encontrada. Debug: ' + (statusData._debug || ''));
      }
    }

    if (!videoUrl) throw new Error('Tiempo de espera agotado. Intenta de nuevo.');

    // 3. Descontar 1 crédito (generación exitosa)
    try {
      const tok = sessionToken || (clerkInstance?.session ? await clerkInstance.session.getToken().catch(()=>null) : null);
      await fetch('/api/video-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}) },
        body: JSON.stringify({ action: 'deduct' })
      });
    } catch(ce) { console.warn('No se pudo descontar crédito:', ce.message); }

    // 4. Renderizar video
    card.closest('.msg').remove();
    const chatBox = document.getElementById('chat-area');
    const videoMsg = document.createElement('div');
    videoMsg.className = 'msg agent';
    videoMsg.innerHTML =
      '<div class="video-player-wrap">' +
        '<video controls autoplay muted playsinline style="max-height:480px">' +
          '<source src="' + videoUrl + '" type="video/mp4">' +
        '</video>' +
        '<div class="video-player-actions">' +
          '<a class="video-download-btn" href="' + videoUrl + '" download="video-ad.mp4" target="_blank">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
            'Descargar video' +
          '</a>' +
        '</div>' +
      '</div>';
    chatBox.appendChild(videoMsg);
    chatBox.scrollTop = chatBox.scrollHeight;

  } catch(e) {
    progress.remove();
    btn.disabled = false;
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Generar video';
    addAgent('Error generando el video: ' + e.message + '. Verifica que BYTEPLUS_API_KEY esté configurado en Vercel.');
  }
}

async function loadSnapshots(agentFilter) {
  const user = window.Clerk?.user || clerkInstance?.user;
  if (!user) return [];
  try {
    let url = `/api/admin?action=get-snapshots&userId=${encodeURIComponent(user.id)}&limit=10`;
    if (agentFilter && agentFilter !== 'all') url += `&agent=${encodeURIComponent(agentFilter)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch(e) { return []; }
}

// ═══════════════════════════════════════════════════════════
// SPRINT 2 — Features 5C, 5D, 6B, 6C, 7D, 8C
// ═══════════════════════════════════════════════════════════

// ── isAgencyPlan (Feature 8C) ─────────────────────────────
function isAgencyPlan() {
  return userPlan === 'admin' || userPlan === 'agency' || isAdminUser();
}

// ── Restore connections from Supabase on load (Feature 5B) ─
async function restoreConnectionsFromSupabase() {
  const uid = clerkInstance?.user?.id;
  if (!uid) return;
  const hasGoogleToken = !!sessionStorage.getItem('ads_access_token');
  const hasMetaToken   = !!sessionStorage.getItem('meta_access_token');
  if (hasGoogleToken && hasMetaToken) return; // ya restaurado desde sessionStorage

  try {
    const [gConn, mConn] = await Promise.all([
      fetch(`/api/admin?action=get-connection&userId=${encodeURIComponent(uid)}&platform=google_ads`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/admin?action=get-connection&userId=${encodeURIComponent(uid)}&platform=meta_ads`).then(r => r.json()).catch(() => ({})),
    ]);

    if (!hasGoogleToken && gConn.connected && gConn.access_token) {
      sessionStorage.setItem('ads_access_token', gConn.access_token);
      sessionStorage.setItem('ads_email', gConn.account_name || '');
      localStorage.setItem('ads_access_token_persist', gConn.access_token);
      localStorage.setItem('ads_email_persist', gConn.account_name || '');
      updateAdsUI(true, gConn.account_name);
    }
    // Restaurar cuenta activa de Google Ads desde localStorage
    if (!sessionStorage.getItem('ads_customer_id')) {
      var persistedGId  = localStorage.getItem('ads_customer_id_persist');
      var persistedGAcc = localStorage.getItem('ads_active_account_persist');
      if (persistedGId) {
        sessionStorage.setItem('ads_customer_id', persistedGId);
        if (persistedGAcc) {
          sessionStorage.setItem('ads_active_account', persistedGAcc);
          try { if (typeof adsActiveAccount !== 'undefined') { adsActiveAccount = JSON.parse(persistedGAcc); if (typeof renderActiveAccount === 'function') renderActiveAccount(); } } catch(e){}
        }
      }
    }
    if (!hasMetaToken && mConn.connected && mConn.access_token) {
      sessionStorage.setItem('meta_access_token', mConn.access_token);
      localStorage.setItem('meta_access_token_persist', mConn.access_token);
      sessionStorage.setItem('meta_user_name', mConn.account_name || '');
      if (mConn.extra_data?.meta_user_id) sessionStorage.setItem('meta_user_id', mConn.extra_data.meta_user_id);
      updateMetaUI(true, mConn.account_name);
    }
    // Restaurar cuenta publicitaria desde localStorage (persiste entre recargas)
    if (!sessionStorage.getItem('meta_ad_account_id')) {
      const persistedAccId = localStorage.getItem('meta_ad_account_id_persist');
      const persistedAcc   = localStorage.getItem('meta_active_account_persist');
      if (persistedAccId) {
        sessionStorage.setItem('meta_ad_account_id', persistedAccId);
        if (persistedAcc) sessionStorage.setItem('meta_active_account', persistedAcc);
      }
    }

    // Refrescar token de Meta si expira pronto
    if (mConn.connected) {
      fetch('/api/admin?action=refresh-meta-token', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ userId: uid })
      }).catch(() => {});
    }
  } catch {}
}

// ── Google Ads Dashboard (Feature 5C) ────────────────────────
let _gDashPeriod = 'LAST_30_DAYS';
let _gDashCollapsed = true;

async function showGoogleAdsDashboard() {
  const uid        = clerkInstance?.user?.id;
  const customerId = sessionStorage.getItem('ads_customer_id');
  const dash       = document.getElementById('ads-dashboard');
  if (!uid || !customerId || !dash) return;

  dash.style.display = 'block';
  _renderGDashSkeleton();

  const cacheKey = `gads_dashboard_${customerId}_${_gDashPeriod}_${Math.floor(Date.now() / 900000)}`;
  let overview, campaigns;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const d = JSON.parse(cached);
      overview = d.overview; campaigns = d.campaigns;
    } else {
      [overview, campaigns] = await Promise.all([
        fetch(`/api/google-ads?action=get-account-overview&userId=${encodeURIComponent(uid)}&customerId=${customerId}&dateRange=${_gDashPeriod}`).then(r => r.json()),
        fetch(`/api/google-ads?action=get-campaigns&userId=${encodeURIComponent(uid)}&customerId=${customerId}&dateRange=${_gDashPeriod}`).then(r => r.json()),
      ]);
      localStorage.setItem(cacheKey, JSON.stringify({ overview, campaigns }));
    }
  } catch { return; }

  if (overview?.testAccess) {
    document.getElementById('ads-dashboard-inner').innerHTML = `
      <div style="padding:10px 16px;font-size:12px;color:var(--muted2);display:flex;align-items:center;gap:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Tu cuenta está en modo de prueba. Las métricas reales estarán disponibles cuando Google apruebe el acceso completo.
      </div>`;
    return;
  }
  if (overview?.error) { dash.style.display = 'none'; return; }

  _renderGDashContent(overview, campaigns?.campaigns || []);
}

function _gDashUpgradeBanner() {
  if (userPlan === 'pro' || userPlan === 'agency' || isAdminUser()) return '';
  return `<div style="margin:0 16px 8px;padding:8px 12px;background:#fefce8;border:1px solid #fef08a;border-radius:7px;display:flex;align-items:center;gap:8px">
    <span style="font-size:14px">★</span>
    <span style="font-size:11px;color:#713f12;flex:1">Estás viendo tus datos reales. Con <strong>Pro</strong> recibes alertas automáticas cuando una campaña falla.</span>
    <button onclick="showUpgradeHint()" style="font-size:11px;font-weight:600;color:#92400e;background:#fef9c3;border:1px solid #fde68a;border-radius:5px;padding:3px 8px;cursor:pointer;white-space:nowrap">Ver planes</button>
  </div>`;
}

function _renderGDashSkeleton() {
  document.getElementById('ads-dashboard-inner').innerHTML = `
    <div style="padding:10px 16px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
        <div style="width:120px;height:12px;background:var(--border);border-radius:4px;animation:pulse 1.2s infinite"></div>
        <div style="width:80px;height:12px;background:var(--border);border-radius:4px;animation:pulse 1.2s infinite"></div>
      </div>
      <div style="display:flex;gap:16px">
        ${[1,2,3,4,5].map(() => '<div style="flex:1;height:32px;background:var(--border);border-radius:6px;animation:pulse 1.2s infinite"></div>').join('')}
      </div>
    </div>`;
}

function _renderGDashContent(ov, campaigns) {
  const periodLabels = { 'LAST_7_DAYS': '7 días', 'LAST_30_DAYS': '30 días', 'LAST_90_DAYS': '90 días', 'THIS_MONTH': 'Este mes', 'LAST_MONTH': 'Mes ant.' };
  const periods = Object.entries(periodLabels).map(([v,l]) =>
    `<option value="${v}" ${v === _gDashPeriod ? 'selected' : ''}>${l}</option>`
  ).join('');

  const kpis = [
    { label: 'Impresiones', value: (ov.impressions||0).toLocaleString() },
    { label: 'Clicks',      value: (ov.clicks||0).toLocaleString() },
    { label: 'CTR',         value: (ov.ctr||'0')+'%' },
    { label: 'CPC prom.',   value: '$'+(ov.avgCpc||0) },
    { label: 'Conversiones',value: (ov.conversions||0) },
    { label: 'CPA',         value: '$'+(ov.cpa||0) },
    { label: 'Gasto total', value: '$'+(ov.totalCost||0) },
  ];

  const campRows = campaigns.slice(0, 5).map(c => {
    const dot = c.status === 'ENABLED' ? '#22c55e' : '#9ca3af';
    return `<div onclick="injectCampaignAnalysis('google','${c.name.replace(/'/g, '').replace(/"/g, '')}')"
      style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:11px"
      onmouseover="this.style.background='var(--border2)'" onmouseout="this.style.background='none'">
      <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">${c.name}</span>
      <span style="color:var(--muted2);flex-shrink:0">$${c.cpa} CPA · ${(c.clicks||0).toLocaleString()} clicks</span>
    </div>`;
  }).join('');

  document.getElementById('ads-dashboard-inner').innerHTML = `
    ${_gDashCollapsed ? '' : _gDashUpgradeBanner()}
    <div style="padding:8px 16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:${_gDashCollapsed ? '0' : '10px'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="var(--blue)" stroke-width="2"/><path d="M8 21h8M12 17v4" stroke="var(--blue)" stroke-width="2" stroke-linecap="round"/></svg>
        <span style="font-size:11px;font-weight:600;color:var(--text)">Google Ads</span>
        <select onchange="changeGDashPeriod(this.value)" style="font-size:11px;border:1px solid var(--border);border-radius:5px;padding:1px 4px;background:var(--bg);color:var(--text)">${periods}</select>
        <button onclick="showGoogleAdsDashboard()" style="font-size:10px;padding:2px 7px;background:none;border:1px solid var(--border);border-radius:5px;cursor:pointer;color:var(--muted2)">↻</button>
        <button onclick="toggleGDash()" style="margin-left:auto;font-size:10px;padding:2px 7px;background:none;border:1px solid var(--border);border-radius:5px;cursor:pointer;color:var(--muted2)">${_gDashCollapsed ? '▼ expandir' : '▲ colapsar'}</button>
      </div>
      ${_gDashCollapsed ? '' : `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-bottom:10px">
          ${kpis.map(k => `<div style="background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:7px 10px">
            <div style="font-size:10px;color:var(--muted2);margin-bottom:2px">${k.label}</div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">${k.value}</div>
          </div>`).join('')}
        </div>
        ${campRows ? `<div style="border-top:1px solid var(--border2);padding-top:6px;font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Campañas</div>${campRows}` : ''}
      `}
    </div>`;
}

function toggleGDash() { _gDashCollapsed = !_gDashCollapsed; showGoogleAdsDashboard(); }
function changeGDashPeriod(v) { _gDashPeriod = v; showGoogleAdsDashboard(); }

// ── Meta Ads Dashboard (Feature 6B) ──────────────────────────
let _mDashPeriod = 'last_30d';
let _mDashCollapsed = true;

async function showMetaAdsDashboard() {
  const uid       = clerkInstance?.user?.id;
  const accountId = sessionStorage.getItem('meta_ad_account_id');
  const dash      = document.getElementById('ads-dashboard');
  if (!uid || !accountId || !dash) return;

  dash.style.display = 'block';
  document.getElementById('ads-dashboard-inner').innerHTML = `
    <div style="padding:10px 16px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px">
        <div style="width:120px;height:12px;background:var(--border);border-radius:4px;animation:pulse 1.2s infinite"></div>
        <div style="width:80px;height:12px;background:var(--border);border-radius:4px;animation:pulse 1.2s infinite"></div>
      </div>
      <div style="display:flex;gap:16px">
        ${[1,2,3,4,5].map(() => '<div style="flex:1;height:32px;background:var(--border);border-radius:6px;animation:pulse 1.2s infinite"></div>').join('')}
      </div>
    </div>`;

  const cacheKey = `meta_dashboard_${accountId}_${_mDashPeriod}_${Math.floor(Date.now() / 900000)}`;
  let overview, campaigns;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const d = JSON.parse(cached);
      overview = d.overview; campaigns = d.campaigns;
    } else {
      [overview, campaigns] = await Promise.all([
        fetch(`/api/meta-ads?action=get-account-overview&userId=${encodeURIComponent(uid)}&adAccountId=${accountId}&datePreset=${_mDashPeriod}`).then(r => r.json()),
        fetch(`/api/meta-ads?action=get-campaigns&userId=${encodeURIComponent(uid)}&adAccountId=${accountId}&datePreset=${_mDashPeriod}`).then(r => r.json()),
      ]);
      localStorage.setItem(cacheKey, JSON.stringify({ overview, campaigns }));
    }
  } catch { return; }

  if (overview?.error) {
    if (overview.retryAfter) {
      document.getElementById('ads-dashboard-inner').innerHTML = `<div style="padding:10px 16px;font-size:12px;color:var(--muted2)">Los datos de Meta se actualizarán en un momento (rate limit).</div>`;
    } else { dash.style.display = 'none'; }
    return;
  }

  const periodLabels = { 'last_7d': '7 días', 'last_30d': '30 días', 'last_90d': '90 días', 'this_month': 'Este mes', 'last_month': 'Mes ant.' };
  const periods = Object.entries(periodLabels).map(([v,l]) =>
    `<option value="${v}" ${v === _mDashPeriod ? 'selected' : ''}>${l}</option>`
  ).join('');

  const kpis = [
    { label: 'Alcance',      value: (overview.reach||0).toLocaleString() },
    { label: 'Impresiones',  value: (overview.impressions||0).toLocaleString() },
    { label: 'CPM',          value: '$'+(overview.cpm||0) },
    { label: 'CTR',          value: (overview.ctr||'0')+'%' },
    { label: 'Conversiones', value: overview.conversions||0 },
    { label: 'CPA',          value: '$'+(overview.cpa||0) },
    { label: 'Gasto',        value: '$'+(overview.spend||0) },
  ];

  const campRows = (campaigns?.campaigns||[]).slice(0, 5).map(c => {
    const isActive = c.status === 'ACTIVE';
    const dot = isActive ? '#22c55e' : '#9ca3af';
    const safeName = (c.name||'').replace(/'/g, '').replace(/"/g, '');
    const toggleLabel = isActive ? '⏸' : '▶';
    const toggleTitle = isActive ? 'Pausar campaña' : 'Activar campaña';
    const toggleAction = isActive ? 'PAUSED' : 'ACTIVE';
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:5px;font-size:11px">
      <span style="width:7px;height:7px;border-radius:50%;background:${dot};flex-shrink:0"></span>
      <span onclick="injectCampaignAnalysis('meta','${safeName}')" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text);cursor:pointer" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${c.name}</span>
      <span style="color:var(--muted2);flex-shrink:0;font-size:10px">$${c.spend}</span>
      <button onclick="manageCampaignStatus('${c.id}','${safeName}','${toggleAction}')" title="${toggleTitle}"
        style="flex-shrink:0;background:${isActive ? '#fef3c7' : '#dcfce7'};border:1px solid ${isActive ? '#fde68a' : '#bbf7d0'};border-radius:4px;cursor:pointer;padding:2px 6px;font-size:10px;color:${isActive ? '#92400e' : '#15803d'};font-weight:600">
        ${toggleLabel}
      </button>
    </div>`;
  }).join('');

  document.getElementById('ads-dashboard-inner').innerHTML = `
    ${_mDashCollapsed ? '' : (() => {
      if (userPlan === 'pro' || userPlan === 'agency' || isAdminUser()) return '';
      return '<div style="margin:0 16px 8px;padding:8px 12px;background:#fefce8;border:1px solid #fef08a;border-radius:7px;display:flex;align-items:center;gap:8px"><span style="font-size:14px">★</span><span style="font-size:11px;color:#713f12;flex:1">Estás viendo tus datos reales. Con <strong>Pro</strong> recibes alertas automáticas cuando la frecuencia sube o una campaña no convierte.</span><button onclick="showUpgradeHint()" style="font-size:11px;font-weight:600;color:#92400e;background:#fef9c3;border:1px solid #fde68a;border-radius:5px;padding:3px 8px;cursor:pointer;white-space:nowrap">Ver planes</button></div>';
    })()}
    <div style="padding:8px 16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:${_mDashCollapsed ? '0' : '10px'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="2" y="2" width="20" height="20" rx="4" fill="#1877F2"/><path d="M13 21v-8h3l.5-3H13V8.5c0-.83.42-1.5 1.5-1.5H17V4.1a20 20 0 00-2.57-.1C11.92 4 10 5.7 10 8.29V10H7v3h3v8z" fill="#fff"/></svg>
        <span style="font-size:11px;font-weight:600;color:var(--text)">Meta Ads</span>
        <select onchange="changeMDashPeriod(this.value)" style="font-size:11px;border:1px solid var(--border);border-radius:5px;padding:1px 4px;background:var(--bg);color:var(--text)">${periods}</select>
        <button onclick="showMetaAdsDashboard()" style="font-size:10px;padding:2px 7px;background:none;border:1px solid var(--border);border-radius:5px;cursor:pointer;color:var(--muted2)">↻</button>
        <button onclick="toggleMDash()" style="margin-left:auto;font-size:10px;padding:2px 7px;background:none;border:1px solid var(--border);border-radius:5px;cursor:pointer;color:var(--muted2)">${_mDashCollapsed ? '▼ expandir' : '▲ colapsar'}</button>
      </div>
      ${_mDashCollapsed ? '' : `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin-bottom:10px">
          ${kpis.map(k => `<div style="background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:7px 10px">
            <div style="font-size:10px;color:var(--muted2);margin-bottom:2px">${k.label}</div>
            <div style="font-size:14px;font-weight:700;color:var(--text)">${k.value}</div>
          </div>`).join('')}
        </div>
        ${campRows ? `<div style="border-top:1px solid var(--border2);padding-top:6px;font-size:10px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Campañas</div>${campRows}` : ''}
      `}
    </div>`;
}

function toggleMDash() { _mDashCollapsed = !_mDashCollapsed; showMetaAdsDashboard(); }
function changeMDashPeriod(v) { _mDashPeriod = v; showMetaAdsDashboard(); }

function hidePlatformDashboard() {
  const dash = document.getElementById('ads-dashboard');
  if (dash) dash.style.display = 'none';
}

function injectCampaignAnalysis(platform, campaignName) {
  const label = platform === 'google' ? 'Google Ads' : 'Meta Ads';
  const msg = `Dame un análisis detallado de la campaña "${campaignName}" en ${label}.`;
  document.getElementById('inp').value = msg;
  sendMsg();
}

async function manageCampaignStatus(campaignId, campaignName, newStatus) {
  const label  = newStatus === 'ACTIVE' ? 'activar' : 'pausar';
  const emoji  = newStatus === 'ACTIVE' ? '▶' : '⏸';
  const spend  = newStatus === 'ACTIVE' ? '\n\n⚠️ La campaña comenzará a gastar presupuesto inmediatamente.' : '';
  if (!confirm(`¿Quieres ${label} la campaña "${campaignName}"?${spend}`)) return;

  const token     = sessionStorage.getItem('meta_access_token');
  const accountId = sessionStorage.getItem('meta_ad_account_id');
  const uid       = clerkInstance?.user?.id;
  if (!token) { alert('No hay sesión de Meta Ads. Reconecta tu cuenta.'); return; }

  try {
    const r = await fetch('/api/meta-ads?action=update-campaign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, adAccountId: accountId, campaignId, status: newStatus }),
    });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error');

    // Limpiar caché del dashboard para forzar recarga
    Object.keys(localStorage).filter(k => k.startsWith('meta_dashboard_')).forEach(k => localStorage.removeItem(k));
    // Registrar acción en logs
    if (uid) fetch('/api/admin?action=log-api-action', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid, platform: 'meta_ads', actionType: 'campaign_status_change', entityId: campaignId, entityName: campaignName, newValue: { status: newStatus }, confirmed: true })
    }).catch(() => {});

    addAgent(`${emoji} **Campaña ${newStatus === 'ACTIVE' ? 'activada' : 'pausada'}**: "${campaignName}"\n\n` +
      (newStatus === 'ACTIVE' ? 'La campaña está activa y comenzará a entregar anuncios.' : 'La campaña está pausada. No se gastará presupuesto hasta que la actives nuevamente.'));
    showMetaAdsDashboard();
  } catch(err) {
    alert('Error: ' + err.message);
  }
}

// ── Context injection (Features 5D / 6C) ─────────────────────
async function getGoogleAdsContext() {
  const uid        = clerkInstance?.user?.id;
  const customerId = sessionStorage.getItem('ads_customer_id');
  if (!uid || !customerId) return '';
  try {
    const cacheKey = `gads_ctx_${customerId}_${Math.floor(Date.now() / 900000)}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
    const res  = await fetch(`/api/google-ads?action=get-account-overview&userId=${encodeURIComponent(uid)}&customerId=${customerId}&dateRange=LAST_30_DAYS`);
    const data = await res.json();
    if (data.testAccess || data.error || !data.impressions) return '';
    const ctx = `DATOS REALES DE LA CUENTA GOOGLE ADS (últimos 30 días):
- Gasto total: $${data.totalCost}
- Impresiones: ${(data.impressions||0).toLocaleString()}
- Clicks: ${(data.clicks||0).toLocaleString()}
- CTR: ${data.ctr}%
- CPC promedio: $${data.avgCpc}
- Conversiones: ${data.conversions}
- CPA: $${data.cpa}
- Campañas activas: ${data.activeCampaigns}
- Campañas pausadas: ${data.pausedCampaigns}`;
    localStorage.setItem(cacheKey, ctx);
    return ctx;
  } catch { return ''; }
}

async function getMetaAdsContext() {
  const uid       = clerkInstance?.user?.id;
  const accountId = sessionStorage.getItem('meta_ad_account_id');
  if (!uid || !accountId) return '';
  try {
    const cacheKey = `meta_ctx_${accountId}_${Math.floor(Date.now() / 900000)}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) return cached;
    // Obtener moneda de la cuenta activa
    let currency = 'USD';
    try { const acc = JSON.parse(sessionStorage.getItem('meta_active_account') || '{}'); currency = acc.currency || 'USD'; } catch {}
    const accountName = (() => { try { return JSON.parse(sessionStorage.getItem('meta_active_account') || '{}').name || ''; } catch { return ''; } })();
    const res  = await fetch(`/api/meta-ads?action=get-account-overview&userId=${encodeURIComponent(uid)}&adAccountId=${accountId}&datePreset=last_30d`);
    const data = await res.json();
    if (data.error || !data.impressions) return '';
    // Nota de conversión si no es USD
    const currencyNote = currency !== 'USD'
      ? `\n⚠️ MONEDA DE CUENTA: ${currency} — Los valores de gasto, CPC, CPM y CPA están en ${currency}, NO en USD. Ajusta todos los benchmarks y análisis en consecuencia. Los benchmarks de LatAm en USD deben multiplicarse por el tipo de cambio aproximado para comparar correctamente.`
      : '';
    const ctx = `CUENTA META ADS ACTIVA: ${accountName} (${accountId})
MONEDA DE LA CUENTA: ${currency}
DATOS REALES (últimos 30 días, valores en ${currency}):
- Gasto total: ${data.spend} ${currency}
- Alcance: ${(data.reach||0).toLocaleString()}
- Impresiones: ${(data.impressions||0).toLocaleString()}
- Clicks: ${(data.clicks||0).toLocaleString()}
- CTR: ${data.ctr}%
- CPC: ${data.cpc} ${currency}
- CPM: ${data.cpm} ${currency}
- Frecuencia: ${data.frequency}
- Conversiones: ${data.conversions}
- CPA: ${data.cpa} ${currency}${currencyNote}`;
    localStorage.setItem(cacheKey, ctx);
    return ctx;
  } catch { return ''; }
}

// ── Alerts (Feature 7D) ──────────────────────────────────────
let _alertsOpen = false;

async function initAlertsBadge() {
  const uid = clerkInstance?.user?.id;
  if (!uid) return;
  try {
    const r = await fetch(`/api/admin?action=get-alerts&userId=${encodeURIComponent(uid)}&unreadOnly=true`);
    const alerts = await r.json();
    updateAlertsBadge(Array.isArray(alerts) ? alerts.length : 0);
    // Check nuevas alertas silencioso
    fetch('/api/admin?action=check-alerts', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ userId: uid })
    }).then(r => r.json()).then(d => {
      if (d.count > 0) updateAlertsBadge(alerts.length + d.count);
    }).catch(() => {});
  } catch {}
}

function updateAlertsBadge(count) {
  const btn   = document.getElementById('alerts-btn');
  const badge = document.getElementById('alerts-badge');
  if (!btn || !badge) return;
  if (count > 0) {
    btn.style.display   = 'flex';
    badge.style.display = 'flex';
    badge.textContent   = count > 99 ? '99+' : count;
  } else {
    btn.style.display   = 'flex';
    badge.style.display = 'none';
  }
}

async function openAlertsPanel() {
  if (_alertsOpen) { closeAlertsPanel(); return; }
  _alertsOpen = true;
  const uid = clerkInstance?.user?.id;

  // Crear panel si no existe
  let panel = document.getElementById('alerts-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'alerts-panel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:360px;height:100vh;background:var(--bg);border-left:1px solid var(--border);z-index:2000;display:flex;flex-direction:column;box-shadow:-4px 0 20px rgba(0,0,0,.08)';
    document.body.appendChild(panel);
  }

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:16px 18px;border-bottom:1px solid var(--border2);flex-shrink:0">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span style="font-size:13px;font-weight:600;color:var(--text);flex:1">Alertas de campañas</span>
      <select id="alerts-filter" onchange="reloadAlerts()" style="font-size:11px;border:1px solid var(--border);border-radius:5px;padding:2px 6px;background:var(--bg);color:var(--text)">
        <option value="all">Todas</option>
        <option value="google_ads">Google Ads</option>
        <option value="meta_ads">Meta Ads</option>
      </select>
      <button onclick="closeAlertsPanel()" style="background:none;border:none;cursor:pointer;color:var(--muted2);font-size:16px;line-height:1;padding:2px">✕</button>
    </div>
    <div id="alerts-list" style="flex:1;overflow-y:auto;padding:12px"></div>`;

  panel.style.display = 'flex';

  // Marcar como leídas
  if (uid) {
    fetch('/api/admin?action=mark-alerts-read', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ userId: uid })
    }).then(() => { const b = document.getElementById('alerts-badge'); if (b) b.style.display = 'none'; }).catch(() => {});
  }

  await reloadAlerts();
}

async function reloadAlerts() {
  const uid    = clerkInstance?.user?.id;
  const filter = document.getElementById('alerts-filter')?.value || 'all';
  const list   = document.getElementById('alerts-list');
  if (!uid || !list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted2);font-size:12px">Cargando...</div>';
  try {
    let url = `/api/admin?action=get-alerts&userId=${encodeURIComponent(uid)}`;
    if (filter !== 'all') url += `&platform=${filter}`;
    const r      = await fetch(url);
    const alerts = await r.json();
    if (!alerts.length) {
      list.innerHTML = '<div style="text-align:center;padding:32px 16px;color:var(--muted2)"><div style="font-size:32px;margin-bottom:8px">✓</div><div style="font-size:13px">No hay alertas activas</div></div>';
      return;
    }
    list.innerHTML = alerts.map(a => {
      const severityColor = { critical: '#ef4444', warning: '#f59e0b', info: '#3b82f6' }[a.severity] || '#9ca3af';
      const severityLabel = { critical: 'CRÍTICO', warning: 'AVISO', info: 'INFO' }[a.severity] || a.severity;
      const platform = a.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads';
      return `<div style="border:1px solid var(--border);border-radius:9px;padding:12px;margin-bottom:8px;border-left:3px solid ${severityColor}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <span style="font-size:10px;font-weight:700;color:${severityColor};background:${severityColor}18;padding:1px 6px;border-radius:10px">${severityLabel}</span>
          <span style="font-size:10px;color:var(--muted2)">${platform}</span>
          <span style="font-size:10px;color:var(--muted2);margin-left:auto">${timeAgo(a.created_at)}</span>
        </div>
        ${a.campaign_name ? `<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:3px">${a.campaign_name}</div>` : ''}
        <div style="font-size:12px;color:var(--muted);line-height:1.4;margin-bottom:8px">${a.message}</div>
        <div style="display:flex;gap:6px">
          <button onclick="alertGoToAgent('${a.platform}','${a.message.replace(/'/g,'')}')" style="flex:1;font-size:11px;padding:4px 8px;background:var(--blue-lt);color:var(--blue);border:1px solid var(--blue-md);border-radius:6px;cursor:pointer">Ver en agente</button>
          <button onclick="dismissAlert('${a.id}',this.parentElement.parentElement)" style="font-size:11px;padding:4px 8px;background:var(--bg);color:var(--muted2);border:1px solid var(--border);border-radius:6px;cursor:pointer">Descartar</button>
        </div>
      </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted2);font-size:12px">Error al cargar alertas.</div>';
  }
}

function closeAlertsPanel() {
  _alertsOpen = false;
  const panel = document.getElementById('alerts-panel');
  if (panel) panel.style.display = 'none';
}

async function dismissAlert(id, el) {
  el?.remove();
  fetch('/api/admin?action=dismiss-alert', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ id })
  }).catch(() => {});
}

function alertGoToAgent(platform, message) {
  closeAlertsPanel();
  const agentCtx = platform === 'google_ads' ? 'google-ads' : 'meta-ads';
  openAgent(agentCtx);
  setTimeout(() => {
    const msg = `Tengo una alerta en mis campañas: ${message} ¿Qué me recomiendas hacer?`;
    document.getElementById('inp').value = msg;
    sendMsg();
  }, 600);
}

// ═══════════════════════════════════════════════════════════
// FIN SPRINT 2 — Frontend
// ═══════════════════════════════════════════════════════════

function renderSocialOptions() {
  const area = document.getElementById('chat-area');
  if (!area) return;

  const options = [
    { icon: '🗺️', label: 'diagnóstico de redes', desc: '¿en qué redes debo estar?', prompt: 'Analiza mi negocio y dime exactamente en qué redes sociales debo tener presencia y en cuáles no. Justifica cada recomendación.' },
    { icon: '📅', label: 'parrilla mensual', desc: 'plan de contenido para 4 semanas', prompt: 'Crea una parrilla de contenido completa para el próximo mes: semana a semana, con red, formato, tema e idea concreta para cada publicación.' },
    { icon: '🎯', label: 'estrategia de contenido', desc: 'pilares, voz y calendario editorial', prompt: 'Crea una estrategia de contenido completa para mi negocio: pilares temáticos, voz de marca, tipos de contenido y frecuencia recomendada por red.' },
    { icon: '✍️', label: 'copys y guiones', desc: 'textos listos para publicar', prompt: 'Crea copys y guiones listos para publicar: posts para feed, guiones para reels/TikTok y textos para stories. Adapta el tono a mi marca.' },
    { icon: '📊', label: 'análisis de rendimiento', desc: 'qué medir y cómo mejorar', prompt: 'Ayúdame a entender qué métricas debo revisar en mis redes sociales, cómo interpretarlas y qué acciones concretas tomar para mejorar mis resultados.' },
    { icon: '🔥', label: 'ideas de contenido viral', desc: 'tendencias y formatos con alto alcance', prompt: 'Dame ideas de contenido con alto potencial de alcance orgánico para mi negocio: tendencias actuales, formatos que están funcionando y ángulos creativos adaptados a mi industria.' },
  ];

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin:4px 0 8px 0;';

  const intro = document.createElement('div');
  intro.style.cssText = 'font-size:12px;color:var(--muted);margin-bottom:4px;';
  intro.textContent = '¿por dónde empezamos?';
  wrap.appendChild(intro);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.style.cssText = `
      display:flex;flex-direction:column;align-items:flex-start;gap:3px;
      padding:11px 13px;border-radius:10px;border:1.5px solid var(--border);
      background:var(--bg);cursor:pointer;text-align:left;
      font-family:var(--font);transition:all .15s;width:100%;
    `;
    btn.innerHTML = `
      <span style="font-size:16px;line-height:1">${opt.icon}</span>
      <span style="font-size:12px;font-weight:600;color:var(--text);line-height:1.3">${opt.label}</span>
      <span style="font-size:11px;color:var(--muted);line-height:1.3">${opt.desc}</span>
    `;
    btn.onmouseover = () => { btn.style.borderColor = 'var(--blue)'; btn.style.background = 'var(--blue-lt)'; };
    btn.onmouseout  = () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'var(--bg)'; };
    btn.onclick = () => {
      wrap.remove();
      document.getElementById('cin').value = opt.prompt;
      sendMsg();
    };
    grid.appendChild(btn);
  });

  wrap.appendChild(grid);

  // Insertar en el chat como burbuja del agente
  const bubble = document.createElement('div');
  bubble.className = 'msg';
  bubble.appendChild(wrap);
  area.appendChild(bubble);
  area.scrollTop = area.scrollHeight;
}

function showLimitBanner(d){const a=document.getElementById('chat-area');const el=document.createElement('div');el.className='limit-banner';el.innerHTML=`<strong>límite diario alcanzado</strong> — usaste tus ${d.limit} mensajes gratuitos de hoy.<br><span style="font-size:12px;color:var(--muted)">actualiza a Pro ($19/mes) para mensajes ilimitados.</span><br><a href="/pricing.html">ver planes →</a>`;a.appendChild(el);a.scrollTop=a.scrollHeight}

function exportToPDF(txt, filename) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginL = 22, marginR = 22, marginT = 28, marginB = 22;
  const maxW = pageW - marginL - marginR;
  const blue = [30, 43, 204];
  const blueLt = [238, 240, 253];
  const dark = [15, 15, 15];
  const muted = [120, 120, 130];
  const border = [220, 221, 230];
  let y = marginT;

  function checkPage(needed) {
    if (y + needed > pageH - marginB) { doc.addPage(); y = marginT; drawHeader(); }
  }
  function drawHeader() {
    // Franja azul top
    doc.setFillColor(...blue);
    doc.rect(0, 0, pageW, 12, 'F');
    // Logo texto
    doc.setFontSize(8);
    doc.setTextColor(255,255,255);
    doc.setFont('helvetica','bold');
    doc.text('acuarius', marginL, 8);
    // Fecha derecha
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.5);
    doc.text(new Date().toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}), pageW - marginR, 8, {align:'right'});
  }

  // Header primera página
  drawHeader();
  y = 20;

  // Parsear líneas con tipo
  const rawLines = txt.split('\n');
  const parsed = rawLines.map(line => {
    const h1 = line.match(/^###\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h3 = line.match(/^#\s+(.+)/);
    const bold = line.match(/^\*\*(.+)\*\*$/);
    const bullet = line.match(/^[-•*]\s+(.+)/);
    const num = line.match(/^(\d+)\.\s+(.+)/);
    const empty = line.trim() === '';
    if (h1) return { type: 'h1', text: h1[1].replace(/\*\*/g,'') };
    if (h2) return { type: 'h2', text: h2[1].replace(/\*\*/g,'') };
    if (h3) return { type: 'h3', text: h3[1].replace(/\*\*/g,'') };
    if (bold) return { type: 'bold', text: bold[1] };
    if (bullet) return { type: 'bullet', text: bullet[1].replace(/\*\*/g,'') };
    if (num) return { type: 'num', n: num[1], text: num[2].replace(/\*\*/g,'') };
    if (empty) return { type: 'empty' };
    return { type: 'body', text: line.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/\*([^*]+)\*/g,'$1') };
  });

  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];

    if (p.type === 'empty') { y += 3; continue; }

    if (p.type === 'h1') {
      checkPage(16);
      if (i > 0) y += 4;
      // Bloque azul oscuro full width
      doc.setFillColor(...blue);
      doc.roundedRect(marginL, y, maxW, 11, 2, 2, 'F');
      doc.setFontSize(12);
      doc.setTextColor(255,255,255);
      doc.setFont('helvetica','bold');
      doc.text(p.text, marginL + 5, y + 7.5);
      y += 16;
      continue;
    }

    if (p.type === 'h2') {
      checkPage(14);
      if (i > 0) y += 3;
      // Bloque azul claro
      doc.setFillColor(...blueLt);
      doc.roundedRect(marginL, y, maxW, 9, 1.5, 1.5, 'F');
      doc.setDrawColor(...blue);
      doc.setLineWidth(0.5);
      doc.line(marginL, y + 9, marginL + maxW, y + 9);
      doc.setFontSize(10.5);
      doc.setTextColor(...blue);
      doc.setFont('helvetica','bold');
      doc.text(p.text, marginL + 4, y + 6.2);
      y += 13;
      continue;
    }

    if (p.type === 'h3') {
      checkPage(10);
      if (i > 0) y += 2;
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.setFont('helvetica','bold');
      // Línea azul izquierda
      doc.setFillColor(...blue);
      doc.rect(marginL, y - 3.5, 2.5, 7, 'F');
      const wrapped = doc.splitTextToSize(p.text, maxW - 6);
      doc.text(wrapped, marginL + 5, y);
      y += wrapped.length * 5.5 + 3;
      continue;
    }

    if (p.type === 'bold') {
      checkPage(8);
      y += 1;
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.setFont('helvetica','bold');
      const wrapped = doc.splitTextToSize(p.text, maxW);
      for (const w of wrapped) { checkPage(6); doc.text(w, marginL, y); y += 5.5; }
      continue;
    }

    if (p.type === 'bullet') {
      checkPage(7);
      doc.setFillColor(...blue);
      doc.circle(marginL + 3, y - 1.5, 1, 'F');
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.setFont('helvetica','normal');
      const wrapped = doc.splitTextToSize(p.text, maxW - 8);
      for (let wi = 0; wi < wrapped.length; wi++) {
        checkPage(6);
        doc.text(wrapped[wi], marginL + 7, y);
        y += 5.5;
      }
      y += 0.5;
      continue;
    }

    if (p.type === 'num') {
      checkPage(7);
      doc.setFillColor(...blueLt);
      doc.circle(marginL + 3.5, y - 1.5, 3, 'F');
      doc.setFontSize(7.5);
      doc.setTextColor(...blue);
      doc.setFont('helvetica','bold');
      doc.text(p.n, marginL + 3.5, y - 0.5, {align:'center'});
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.setFont('helvetica','normal');
      const wrapped = doc.splitTextToSize(p.text, maxW - 10);
      for (let wi = 0; wi < wrapped.length; wi++) {
        checkPage(6);
        doc.text(wrapped[wi], marginL + 9, y);
        y += 5.5;
      }
      y += 0.5;
      continue;
    }

    if (p.type === 'body') {
      checkPage(7);
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.setFont('helvetica','normal');
      const wrapped = doc.splitTextToSize(p.text, maxW);
      for (const w of wrapped) { checkPage(6); doc.text(w, marginL, y); y += 5.5; }
      continue;
    }
  }

  // Footer en cada página
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...border);
    doc.setLineWidth(0.3);
    doc.line(marginL, pageH - marginB + 2, pageW - marginR, pageH - marginB + 2);
    doc.setFontSize(7.5);
    doc.setTextColor(...muted);
    doc.setFont('helvetica','normal');
    doc.text('acuarius.app', marginL, pageH - marginB + 7);
    doc.text(`${i} / ${totalPages}`, pageW - marginR, pageH - marginB + 7, {align:'right'});
  }

  doc.save(filename || 'acuarius-estrategia.pdf');
}

function renderParrillaImagenesBtn() {
  const area = document.getElementById('chat-area');
  if (!area) return;

  const el = document.createElement('div');
  el.className = 'msg';
  el.id = 'parrilla-img-btn-wrap';

  const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75" style="width:30px;height:30px;display:block"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';

  el.innerHTML = `
    <div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">${logoSvg}</div>
    <div style="background:linear-gradient(135deg,#EEF0FD 0%,#F5F3FF 100%);border:1.5px solid var(--blue-md);border-radius:4px var(--rlg) var(--rlg) var(--rlg);padding:16px 18px;max-width:500px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:18px">🎉</span>
        <span style="font-size:14px;font-weight:700;color:var(--text)">Parrilla lista</span>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;line-height:1.5">¿Qué quieres hacer con esta parrilla?</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="exportToSheets(this)" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#1a7340;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);transition:background .15s;width:100%" onmouseover="this.style.background='#155c34'" onmouseout="this.style.background='#1a7340'">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="white" stroke-width="1.5"/><path d="M3 9h18M9 9v12" stroke="white" stroke-width="1.5"/><path d="M6 6h.01M6 12h3M6 16h3M13 12h3M13 16h3" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>
          Abrir en Google Sheets
        </button>
        <button onclick="generarImagenesParrilla(this)" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--font);transition:background .15s;width:100%" onmouseover="this.style.background='var(--blue-h)'" onmouseout="this.style.background='var(--blue)'">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
          Crear imágenes de esta parrilla
        </button>
        <button onclick="exportToPDF(lastParrillaText,'acuarius-parrilla.pdf')" style="display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font);transition:all .15s;width:100%" onmouseover="this.style.background='var(--sidebar)'" onmouseout="this.style.background='transparent'">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
          Exportar como PDF
        </button>
        <button onclick="document.getElementById('parrilla-img-btn-wrap')?.remove()" style="padding:8px 14px;background:transparent;color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:12px;cursor:pointer;font-family:var(--font);width:100%">
          Ahora no
        </button>
      </div>
    </div>`;

  area.appendChild(el);
  area.scrollTop = area.scrollHeight;
}

async function generarImagenesParrilla(btn) {
  btn.disabled = true;
  btn.textContent = 'Generando...';
  document.getElementById('parrilla-img-btn-wrap')?.remove();

  const prompt = `Basándote en la parrilla que acabas de crear, identifica todos los posts marcados con ✅ (imagen estática, carrusel, post feed, frase, testimonio). Para cada uno, genera un bloque [GENERAR_IMAGEN] con un prompt de imagen profesional que refleje el concepto del post. IMPORTANTE: todos los textos dentro de las imágenes DEBEN estar en español, sin ninguna palabra en inglés. Genera máximo 5 imágenes, priorizando las más importantes. Formato exacto: [GENERAR_IMAGEN: {"prompt":"...todo en español...","format":"square","variations":1,"hasText":true}] para cada una.`;

  document.getElementById('cin').value = prompt;
  await sendMsg();
}

async function exportToSheets(btn) {
  const originalHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="animation:spin .8s linear infinite"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg> Creando tu Sheet...';

  try {
    const userEmail = clerkInstance?.user?.primaryEmailAddress?.emailAddress || null;
    const negocio = mem?.negocio || '';
    const titulo = `Parrilla de contenido${negocio ? ' · ' + negocio.split('·')[0].trim() : ''} · ${new Date().toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' })}`;

    const headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

    const res = await fetch('/api/create-sheet', {
      method: 'POST',
      headers,
      body: JSON.stringify({ parrilla: lastParrillaText, titulo, userEmail, negocio }),
    });

    const data = await res.json();

    if (data.error) throw new Error(data.error);

    // Reemplazar el botón por el link al Sheet
    const wrap = btn.closest('#parrilla-img-btn-wrap > div') || btn.parentElement;
    btn.innerHTML = originalHTML;
    btn.disabled = false;

    // Mostrar enlace directo al Sheet creado
    const linkEl = document.createElement('a');
    linkEl.href = data.url;
    linkEl.target = '_blank';
    linkEl.rel = 'noopener noreferrer';
    linkEl.style.cssText = 'display:inline-flex;align-items:center;gap:8px;padding:10px 18px;background:#1a7340;color:white;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;width:100%;box-sizing:border-box;transition:background .15s';
    linkEl.onmouseover = () => linkEl.style.background = '#155c34';
    linkEl.onmouseout = () => linkEl.style.background = '#1a7340';
    linkEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="white" stroke-width="1.5"/><path d="M3 9h18M9 9v12" stroke="white" stroke-width="1.5"/><path d="M6 6h.01M6 12h3M6 16h3M13 12h3M13 16h3" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg> Abrir Sheet → ${data.title}`;
    btn.replaceWith(linkEl);

  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
    addAgent(`No pude crear el Sheet: ${err.message}. Verifica que las APIs de Google estén activadas.`);
  }
}

// ROADMAP
let curStage='dia';
function setStage(s,btn){curStage=s;document.querySelectorAll('.stage-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.stage-panel').forEach(p=>p.classList.remove('active'));document.getElementById('sp-'+s).classList.add('active');const pmap={dia:'ps-dia',semana:'ps-semana',quincena:'ps-quincena',mes:'ps-mes',trimestre:'ps-trimestre',semestre:'ps-semestre'};document.querySelectorAll('.pt-stage').forEach(el=>el.classList.remove('current'));document.getElementById(pmap[s])?.classList.add('current');updateProgress()}
function toggleCheck(item){item.classList.toggle('done');updateProgress()}
function updateProgress(){const all=document.querySelectorAll('.stage-panel.active .cl-item').length;const done=document.querySelectorAll('.stage-panel.active .cl-item.done').length;document.getElementById('pt-count').textContent=`${done} / ${all} tareas`;document.getElementById('pt-fill').style.width=all?`${(done/all)*100}%`:'0%'}

// VIEWS
function showView(id){
  // Ocultar loader la primera vez que se muestra una vista
  var loader=document.getElementById('app-loader');
  if(loader&&!loader.classList.contains('hidden')){loader.classList.add('hidden');setTimeout(function(){loader.style.display='none';},260);}
  document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active');});
  var el=document.getElementById('view-'+id);
  if(el)el.classList.add('active');
  if(id==='roadmap')updateProgress();
  if(id==='agency')agencyRender();
}
function switchSb(el){document.querySelectorAll('.sb-item').forEach(i=>i.classList.remove('active'));el.classList.add('active')}
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sb-overlay');
  const isOpen = sidebar.classList.contains('mob-open');
  sidebar.classList.toggle('mob-open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
  document.body.style.overflow = !isOpen ? 'hidden' : '';
}
function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sb-overlay');
  sidebar.classList.remove('mob-open');
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}
function toggleAgent(key){
  const items=document.getElementById('ag-'+key);
  const chev=document.getElementById('chev-'+key);
  if(!items)return;
  const map={'ga':'google-ads','meta':'meta-ads','tiktok':'tiktok-ads','linkedin':'linkedin-ads','seo':'seo','social':'social','consultor':'consultor'};
  const agKey=map[key]||key;
  const isOpen=!items.classList.contains('sb-collapsed');
  console.log('[toggleAgent]',key,'isOpen:',isOpen,'currentAgent:',currentAgentCtx);
  
  // If already open and same agent — just collapse (hide submenu)
  if(currentAgentCtx===agKey&&isOpen){
    items.classList.add('sb-collapsed');
    if(chev)chev.classList.remove('open');
    return;
  }
  
  // Collapse all
  document.querySelectorAll('.sb-agent-items').forEach(el=>el.classList.add('sb-collapsed'));
  document.querySelectorAll('.sb-chevron').forEach(el=>el.classList.remove('open'));
  
  // Open this one
  items.classList.remove('sb-collapsed');
  if(chev)chev.classList.add('open');
  console.log('[toggleAgent] after open, classes:',items.className);
  
  // If different agent, load it
  if(currentAgentCtx!==agKey){
    openAgent(agKey);
  }
  
  setTimeout(function(){
    console.log('[toggleAgent] after timeout, classes:',items.className);
    loadRecentConversations();
  },700);
}
let currentAgentCtx='google-ads';
function updateQaBar(ctx){
  const QA={
    'google-ads':[],
    'meta-ads':[['🚀 crear campaña',null,'launchMetaCampaignFlow'],['crear anuncio','Crear un anuncio de Meta Ads para mi negocio'],['presupuesto','Presupuesto recomendado para Meta Ads'],['audiencias','Cómo definir audiencias en Meta Ads'],['creativos','Dame ideas de creativos para mis anuncios'],['analizar','Analizar rendimiento de mis campañas de Meta']],
    'tiktok-ads':[['crear anuncio','Crear un anuncio para TikTok Ads'],['presupuesto','Presupuesto recomendado para TikTok'],['hooks','Dame ideas de hooks para mis videos'],['tendencias','Qué tendencias de TikTok puedo aprovechar']],
    'linkedin-ads':[['crear anuncio','Crear un anuncio de LinkedIn Ads'],['presupuesto','Presupuesto recomendado para LinkedIn'],['audiencia B2B','Cómo segmentar audiencia B2B en LinkedIn'],['formatos','Qué formatos de anuncio funcionan mejor en LinkedIn']],
    'seo':[['auditoría','Haz una auditoría SEO de mi sitio web'],['keywords','Estudio de palabras clave para mi negocio'],['contenido','Estrategia de contenido SEO para mi sitio'],['competencia','Analizar competencia SEO de mi negocio']],
    'social':[['parrilla','Crear parrilla de contenido mensual'],['estudio de marca','Estudio de marca para mis redes sociales'],['ideas','Dame ideas de contenido para esta semana'],['formatos','Qué formatos funcionan mejor en redes']],
    'consultor':[['diagnóstico','Analiza mi situación de marketing y dime qué canales priorizar'],['presupuesto','Cómo distribuir mi presupuesto de marketing'],['plan 90 días','Crea un plan de marketing para los próximos 90 días'],['métricas','Qué métricas debo medir en mi marketing']]
  };
  const bar=document.getElementById('qa');
  if(!bar)return;
  const items=QA[ctx]||QA['google-ads'];
  bar.innerHTML=items.map(([label,prompt,fn])=>{
    const onclick=fn?`${fn}()`:`qSend('${(prompt||'').replace(/'/g,"\\'")}')`;
    return `<button class="qb" onclick="${onclick}">${label}</button>`;
  }).join('');
}
function setAgentContext(ctx, showGuide=false){
  currentAgentCtx=ctx;
  const labels={'google-ads':'agente google ads','meta-ads':'agente meta ads','tiktok-ads':'agente tiktok ads','linkedin-ads':'agente linkedin ads','seo':'agente seo','social':'agente contenido para redes','consultor':'consultor de marketing'};
  const el=document.querySelector('.hdr-agent');if(el)el.textContent=labels[ctx]||ctx;
  const navTitle=document.getElementById('nav-agent-title');if(navTitle)navTitle.textContent=labels[ctx]||ctx;
  const toolbarLabel=document.getElementById('chat-agent-label');if(toolbarLabel)toolbarLabel.textContent=labels[ctx]||ctx;
  // Mostrar/ocultar panel de acciones social vs píldoras QA
  const socialBar=document.getElementById('social-action-bar');
  const qaBar=document.getElementById('qa');
  if(ctx==='social'){
    // Mostrar tarjetas solo si el chat está vacío (entrada fresca al agente)
    const chatArea=document.getElementById('chat-area');
    const isEmpty=!chatArea||chatArea.children.length===0;
    if(socialBar)socialBar.style.display=isEmpty?'block':'none';
    if(qaBar)qaBar.style.display='none';
  } else {
    if(socialBar)socialBar.style.display='none';
    if(qaBar)qaBar.style.display='';
    updateQaBar(ctx);
  }
  if(showGuide)showAgentGuide(ctx);
}
function newSession(){if(confirm('¿iniciar nueva sesión? el perfil del cliente se mantendrá guardado.')){hist=[];document.getElementById('chat-area').innerHTML='';addAgent(`nueva sesión iniciada. tu perfil está cargado:\n\n**negocio:** ${mem.negocio||'—'}\n**objetivo:** ${mem.objetivo||'—'}\n\n¿en qué trabajamos hoy?`)}}

// DOM
function addAgent(txt){
  const el=document.createElement('div');
  el.className='msg';
  const msgId='msg_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  const isLong=txt.length>400;
  const pdfBtn=isLong?`<button onclick="exportToPDF(window._agentMsgs&&window._agentMsgs['${msgId}']||'','acuarius-estrategia.pdf')" style="display:inline-flex;align-items:center;gap:5px;margin-top:10px;padding:5px 12px;background:transparent;border:1px solid var(--border);border-radius:7px;font-size:11px;color:var(--muted);cursor:pointer;font-family:var(--font);transition:all .15s" onmouseover="this.style.background='var(--sidebar)'" onmouseout="this.style.background='transparent'"><svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><path d='M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z'/><polyline points='14 2 14 8 20 8'/><line x1='16' y1='13' x2='8' y2='13'/><line x1='16' y1='17' x2='8' y2='17'/></svg>Exportar PDF</button>`:'';
  el.innerHTML=`<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg></div><div class="bubble ag-bubble">${fmt(txt)}${pdfBtn}</div>`;
  if(isLong){window._agentMsgs=window._agentMsgs||{};window._agentMsgs[msgId]=txt;}
  document.getElementById('chat-area').appendChild(el);scrollB()
}
function addUser(txt,img){
  const el=document.createElement('div');
  el.className='msg user';
  let imgHtml='';
  if(img){
    imgHtml=`<div style="display:flex;justify-content:flex-end;margin-bottom:4px"><div style="display:inline-flex;align-items:center;gap:8px;background:#fff;border:1.5px solid #E5E7EB;border-radius:10px;padding:5px 10px 5px 5px;max-width:200px"><img src="${img.dataUrl||'data:'+img.mediaType+';base64,'+img.base64}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;flex-shrink:0;border:1px solid #E5E7EB"><div style="display:flex;flex-direction:column;gap:1px;min-width:0"><span style="font-size:12px;font-weight:500;color:#0A0A0A;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px">${esc(img.name||'imagen')}</span><span style="font-size:11px;color:#6B7280">imagen</span></div></div></div>`;
  }
  const textHtml=txt&&txt!=='[Imagen adjunta]'?`<div class="bubble usr-bubble">${esc(txt)}</div>`:'';
  el.innerHTML=`<div class="av usr" style="font-size:10px;font-weight:600">tú</div>${imgHtml}${textHtml}`;
  document.getElementById('chat-area').appendChild(el);scrollB();
}
function addThinking(){const id='th'+Date.now();const el=document.createElement('div');el.className='msg';el.id=id;el.innerHTML=`<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg></div><div class="thinking-bbl"><div class="spinner"></div>analizando tu cuenta...</div>`;document.getElementById('chat-area').appendChild(el);scrollB();return id}
function rmThinking(id){document.getElementById(id)?.remove()}
function appendRaw(html){const a=document.getElementById('chat-area');const d=document.createElement('div');d.innerHTML=html;a.appendChild(d.firstElementChild)}
function scrollB(){const a=document.getElementById('chat-area');setTimeout(()=>{a.scrollTop=a.scrollHeight},50)}
function fmt(t){
  // 1. Escape HTML first
  let s = esc(t);

  // 2. Render markdown tables BEFORE other replacements
  // Match table blocks: header row | separator row | data rows
  s = s.replace(/(\|[^\n]+\|\n\|[-| :]+\|\n(?:\|[^\n]+\|\n?)+)/g, function(tableBlock) {
    const lines = tableBlock.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return tableBlock;
    // Check if second line is a separator (----)
    if (!/^\|[\s\-:|]+\|/.test(lines[1])) return tableBlock;
    const headerCells = lines[0].split('|').filter((_,i,a)=> i>0 && i<a.length-1).map(c=>c.trim());
    const dataRows = lines.slice(2);
    let html = '<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:12px">';
    html += '<thead><tr>' + headerCells.map(c =>
      `<th style="background:var(--sidebar);border:1px solid var(--border);padding:7px 10px;text-align:left;font-weight:600;color:var(--text);white-space:nowrap">${c}</th>`
    ).join('') + '</tr></thead>';
    html += '<tbody>';
    dataRows.forEach(function(row, ri) {
      const cells = row.split('|').filter((_,i,a)=> i>0 && i<a.length-1).map(c=>c.trim());
      html += `<tr style="background:${ri%2===0?'var(--bg)':'var(--sidebar)'}">` +
        cells.map(c => `<td style="border:1px solid var(--border);padding:6px 10px;color:var(--text)">${c}</td>`).join('') +
      '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  });

  // 3. Headers
  s = s.replace(/### (.*?)(\n|$)/g,'<h4 style="margin:14px 0 6px;font-size:13px;font-weight:700;color:var(--text)">$1</h4>');
  s = s.replace(/## (.*?)(\n|$)/g,'<h3 style="margin:16px 0 8px;font-size:14px;font-weight:700;color:var(--text)">$1</h3>');

  // 4. Bold and inline code
  s = s.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
  s = s.replace(/`(.*?)`/g,'<code style="background:var(--sidebar);padding:1px 5px;border-radius:4px;font-size:11px;font-family:monospace">$1</code>');

  // 5. Lists — collapse ALL blank lines between bullet lines aggressively
  // Keep collapsing until no more double-newlines exist between bullet chars
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/(<br>|^|\n)([ \t]*[–\-•].+?)(<br>|\n)\n+([ \t]*[–\-•])/gm, '$1$2$3$4');
  }
  // Also collapse \n\n between bullets in raw text before <br> conversion
  s = s.replace(/(\n[–\-•][^\n]+)\n\n([–\-•])/g, '$1\n$2');
  s = s.replace(/(\n[–\-•][^\n]+)\n\n([–\-•])/g, '$1\n$2');

  s = s.replace(/^– (.+)$/gm,'<li style="margin:1px 0;line-height:1.5">$1</li>');
  s = s.replace(/^- (.+)$/gm,'<li style="margin:1px 0;line-height:1.5">$1</li>');
  s = s.replace(/^• (.+)$/gm,'<li style="margin:1px 0;line-height:1.5">$1</li>');
  s = s.replace(/^(\d+)\. (.+)$/gm,'<li style="list-style-type:decimal;margin:1px 0;line-height:1.5">$2</li>');
  s = s.replace(/(<li[^>]*>.*?<\/li>(?:\s*<li[^>]*>.*?<\/li>)*)/gs,'<ul style="margin:3px 0 5px;padding-left:15px">$1</ul>');

  // 6. Horizontal rule
  s = s.replace(/^---$/gm,'<hr style="border:none;border-top:1px solid var(--border);margin:10px 0">');

  // 7. Paragraphs and line breaks — collapse excess blank lines first
  s = s.replace(/\n{3,}/g,'\n\n');
  s = s.replace(/\n\n/g,'</p><p style="margin-top:5px">');
  s = s.replace(/\n/g,'<br>');
  s = '<p style="margin:0;line-height:1.55">' + s + '</p>';

  return s;
}
function esc(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function handleKey(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg()}}
function autoR(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,100)+'px'}
// Abrir home por defecto — sin expandir ningún agente en sidebar
document.addEventListener('DOMContentLoaded',()=>{
  // Cerrar sidebar al hacer click en item (mobile)
  document.querySelectorAll('.sb-item').forEach(item => {
    item.addEventListener('click', function() {
      if (window.innerWidth <= 768) closeSidebar();
    });
  });
  document.querySelectorAll('.sb-agent-header').forEach(header => {
    header.addEventListener('click', function() {
      if (window.innerWidth <= 768) {
        // No cerrar al expandir — dejar que el usuario vea los subitems
      }
    });
  });
  // No expandir ningún agente automáticamente — el sidebar inicia compacto
});

// ── ROADMAP PANEL ──
const ROADMAP_CONTENT = {
  'google-ads': {
    title: 'hoja de ruta · google ads',
    stages: [
      { id:'dia', label:'día 1', pill:'pill-dia', title:'configuración y lanzamiento',
        alert:'Configura el seguimiento de conversiones ANTES de activar. Sin tracking, inviertes a ciegas.',
        tasks:[
          {text:'<b>Google Tag Manager</b> instalado en el sitio web', badge:'crítico', color:'cb-red'},
          {text:'<b>Conversión principal</b> configurada (lead, compra, llamada)', badge:'crítico', color:'cb-red'},
          {text:'<b>Google Analytics 4</b> vinculado a la cuenta', badge:'crítico', color:'cb-red'},
          {text:'Campaña de búsqueda con <b>objetivo correcto</b>', badge:'setup', color:'cb-blue'},
          {text:'Red de Display <b>desactivada</b> en campaña de búsqueda', badge:'crítico', color:'cb-red'},
          {text:'Al menos <b>1 anuncio RSA</b> por grupo de anuncios', badge:'anuncios', color:'cb-green'},
          {text:'Primeras <b>palabras negativas</b> de industria añadidas', badge:'keywords', color:'cb-green'},
          {text:'Extensiones de <b>sitio, llamada y texto destacado</b>', badge:'extensión', color:'cb-amber'},
        ]
      },
      { id:'semana', label:'semana 1', pill:'pill-semana', title:'observar sin tocar',
        alert:'No cambies pujas ni presupuesto. Solo añade negativos obvios.',
        tasks:[
          {text:'Revisar <b>términos de búsqueda</b> diariamente', badge:'diario', color:'cb-red'},
          {text:'Añadir <b>negativos obvios</b> si los hay', badge:'urgente', color:'cb-red'},
          {text:'Confirmar que el <b>tracking sigue activo</b>', badge:'crítico', color:'cb-red'},
          {text:'Revisar <b>Quality Score</b> de keywords principales', badge:'análisis', color:'cb-blue'},
          {text:'Verificar <b>CPC real</b> vs CPC estimado al inicio', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'quincena', label:'quincena 1', pill:'pill-quincena', title:'primeras optimizaciones',
        tasks:[
          {text:'Pausar keywords con <b>0 clics y alto gasto</b>', badge:'optimizar', color:'cb-amber'},
          {text:'Expandir lista de <b>negativos</b> basado en términos reales', badge:'optimizar', color:'cb-amber'},
          {text:'Revisar calificación RSA (apuntar a <b>"Excelente"</b>)', badge:'anuncios', color:'cb-blue'},
          {text:'Comparar tasa de conv. <b>móvil vs desktop</b>', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'mes', label:'mes 1', pill:'pill-mes', title:'análisis real y replanteo',
        tasks:[
          {text:'Generar <b>reporte completo</b> del mes', badge:'reporte', color:'cb-green'},
          {text:'Comparar CPA real vs <b>CPA objetivo</b>', badge:'reporte', color:'cb-green'},
          {text:'Evaluar activar <b>Smart Bidding</b> si hay +30 conversiones', badge:'decisión', color:'cb-amber'},
          {text:'Decidir si <b>escalar presupuesto</b> o restructurar', badge:'decisión', color:'cb-amber'},
        ]
      },
      { id:'trimestre', label:'trimestre', pill:'pill-trimestre', title:'escala lo que funciona',
        tasks:[
          {text:'Lanzar campaña de <b>remarketing</b> a visitantes', badge:'expandir', color:'cb-green'},
          {text:'Crear experimento <b>A/B formal</b> en Google Ads', badge:'a/b', color:'cb-amber'},
          {text:'Probar nueva <b>estrategia de puja</b> (tROAS o tCPA)', badge:'optimizar', color:'cb-amber'},
        ]
      },
      { id:'semestre', label:'semestre', pill:'pill-semestre', title:'cuenta madura',
        tasks:[
          {text:'Evaluar e implementar <b>Performance Max</b>', badge:'pmax', color:'cb-green'},
          {text:'Reporte <b>semestral ejecutivo</b> completo', badge:'reporte', color:'cb-blue'},
          {text:'Definir <b>estrategia y presupuesto</b> siguiente semestre', badge:'planificar', color:'cb-amber'},
        ]
      }
    ]
  },
  'meta-ads': {
    title: 'hoja de ruta · meta ads',
    stages: [
      { id:'dia', label:'día 1', pill:'pill-dia', title:'configuración inicial',
        alert:'Instala el Meta Pixel ANTES de lanzar cualquier campaña.',
        tasks:[
          {text:'<b>Meta Pixel</b> instalado y verificado en el sitio', badge:'crítico', color:'cb-red'},
          {text:'<b>Conversiones personalizadas</b> configuradas', badge:'crítico', color:'cb-red'},
          {text:'<b>Cuenta publicitaria</b> verificada y activa', badge:'setup', color:'cb-blue'},
          {text:'<b>Página de Facebook</b> y perfil de Instagram conectados', badge:'setup', color:'cb-blue'},
          {text:'Primera campaña con <b>objetivo correcto</b>', badge:'setup', color:'cb-blue'},
          {text:'<b>Audiencia inicial</b> bien segmentada', badge:'audiencia', color:'cb-green'},
        ]
      },
      { id:'semana', label:'semana 1', pill:'pill-semana', title:'fase de aprendizaje',
        alert:'Meta necesita 50 conversiones por conjunto de anuncios para salir de la fase de aprendizaje. No hagas cambios.',
        tasks:[
          {text:'Monitorear <b>costo por resultado</b> diariamente', badge:'diario', color:'cb-red'},
          {text:'Verificar que el <b>Pixel reporta eventos</b> correctamente', badge:'crítico', color:'cb-red'},
          {text:'Revisar <b>frecuencia</b> (no debe superar 2.5 en la primera semana)', badge:'análisis', color:'cb-blue'},
          {text:'Analizar <b>CTR de anuncios</b> — objetivo >1.5%', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'quincena', label:'quincena 1', pill:'pill-quincena', title:'primeras optimizaciones',
        tasks:[
          {text:'Pausar creativos con <b>CTR bajo</b> (<0.5%)', badge:'optimizar', color:'cb-amber'},
          {text:'Escalar <b>creativos ganadores</b> incrementando presupuesto 20%', badge:'escalar', color:'cb-green'},
          {text:'Crear <b>audiencias similares</b> basadas en compradores/leads', badge:'audiencia', color:'cb-green'},
          {text:'Lanzar <b>campaña de remarketing</b> a visitantes del sitio', badge:'remarketing', color:'cb-blue'},
        ]
      },
      { id:'mes', label:'mes 1', pill:'pill-mes', title:'análisis y escala',
        tasks:[
          {text:'Reporte completo: <b>ROAS, CPL, CPA</b> por campaña', badge:'reporte', color:'cb-green'},
          {text:'Comparar rendimiento por <b>placement</b> (feed, stories, reels)', badge:'análisis', color:'cb-blue'},
          {text:'Evaluar <b>Advantage+ Shopping</b> si es e-commerce', badge:'decisión', color:'cb-amber'},
          {text:'Definir <b>presupuesto mes 2</b> basado en ROAS real', badge:'decisión', color:'cb-amber'},
        ]
      },
      { id:'trimestre', label:'trimestre', pill:'pill-trimestre', title:'madurez y automatización',
        tasks:[
          {text:'Implementar <b>Advantage+ Audience</b> para ampliar alcance', badge:'expandir', color:'cb-green'},
          {text:'Crear <b>catálogo de productos</b> para Dynamic Ads si aplica', badge:'expandir', color:'cb-green'},
          {text:'Pruebas A/B formales de <b>creativos vs creativos</b>', badge:'a/b', color:'cb-amber'},
        ]
      },
      { id:'semestre', label:'semestre', pill:'pill-semestre', title:'cuenta madura',
        tasks:[
          {text:'Análisis de <b>estacionalidad</b> y planificación de temporadas', badge:'planificar', color:'cb-blue'},
          {text:'Reporte <b>semestral</b> con benchmark vs industria', badge:'reporte', color:'cb-green'},
          {text:'Estrategia de <b>contenido creativo</b> para el siguiente semestre', badge:'planificar', color:'cb-amber'},
        ]
      }
    ]
  },
  'tiktok-ads': {
    title: 'hoja de ruta · tiktok ads',
    stages: [
      { id:'dia', label:'día 1', pill:'pill-dia', title:'configuración inicial',
        alert:'El contenido nativo funciona mejor que los anuncios pulidos. Piensa como creador, no como marca.',
        tasks:[
          {text:'<b>TikTok Pixel</b> instalado y verificado', badge:'crítico', color:'cb-red'},
          {text:'<b>Cuenta Business</b> de TikTok verificada', badge:'setup', color:'cb-blue'},
          {text:'Primera campaña <b>In-Feed Ads</b> configurada', badge:'setup', color:'cb-blue'},
          {text:'Video creativo con <b>hook en los primeros 3 segundos</b>', badge:'crítico', color:'cb-red'},
          {text:'<b>Audiencia por intereses</b> configurada correctamente', badge:'audiencia', color:'cb-green'},
        ]
      },
      { id:'semana', label:'semana 1', pill:'pill-semana', title:'fase de aprendizaje',
        alert:'TikTok necesita datos para optimizar. No pausar ni modificar la campaña los primeros 7 días.',
        tasks:[
          {text:'Revisar <b>Video Views Rate</b> (objetivo >15%)', badge:'diario', color:'cb-red'},
          {text:'Monitorear <b>CPM y CTR</b> diariamente', badge:'análisis', color:'cb-blue'},
          {text:'Verificar que el <b>Pixel registra eventos</b>', badge:'crítico', color:'cb-red'},
          {text:'Analizar <b>tiempo de reproducción</b> promedio del video', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'quincena', label:'quincena 1', pill:'pill-quincena', title:'optimización creativa',
        tasks:[
          {text:'Crear <b>3-5 variaciones</b> del video creativo con diferentes hooks', badge:'crear', color:'cb-green'},
          {text:'Pausar videos con <b>VVR menor al 10%</b>', badge:'optimizar', color:'cb-amber'},
          {text:'Explorar <b>Spark Ads</b> con contenido orgánico que funcione', badge:'expandir', color:'cb-green'},
          {text:'Ajustar segmentación por <b>dispositivo y sistema operativo</b>', badge:'optimizar', color:'cb-amber'},
        ]
      },
      { id:'mes', label:'mes 1', pill:'pill-mes', title:'análisis y escala',
        tasks:[
          {text:'Reporte: <b>CPM, CPC, CPL, ROAS</b> por campaña y creativo', badge:'reporte', color:'cb-green'},
          {text:'Identificar el <b>mejor hook</b> y replicarlo en nuevos videos', badge:'análisis', color:'cb-blue'},
          {text:'Lanzar campaña de <b>retargeting</b> a espectadores del video', badge:'expandir', color:'cb-green'},
        ]
      },
      { id:'trimestre', label:'trimestre', pill:'pill-trimestre', title:'escala creativa',
        tasks:[
          {text:'Probar <b>TopView o Brand Takeover</b> si el presupuesto lo permite', badge:'expandir', color:'cb-green'},
          {text:'Crear <b>Branded Hashtag Challenge</b> para alcance orgánico', badge:'expandir', color:'cb-green'},
          {text:'Implementar <b>TikTok Shop</b> si es e-commerce', badge:'expandir', color:'cb-amber'},
        ]
      },
      { id:'semestre', label:'semestre', pill:'pill-semestre', title:'cuenta madura',
        tasks:[
          {text:'Estrategia de <b>contenido UGC</b> con creadores locales', badge:'planificar', color:'cb-blue'},
          {text:'Reporte semestral con <b>análisis de tendencias</b> de la plataforma', badge:'reporte', color:'cb-green'},
        ]
      }
    ]
  },
  'linkedin-ads': {
    title: 'hoja de ruta · linkedin ads',
    stages: [
      { id:'dia', label:'día 1', pill:'pill-dia', title:'configuración B2B',
        alert:'LinkedIn Ads es 5-10x más caro que otras plataformas. La segmentación precisa es crítica para no desperdiciar presupuesto.',
        tasks:[
          {text:'<b>LinkedIn Insight Tag</b> instalado en el sitio web', badge:'crítico', color:'cb-red'},
          {text:'<b>Conversiones</b> configuradas en Campaign Manager', badge:'crítico', color:'cb-red'},
          {text:'Segmentación por <b>cargo, industria y tamaño de empresa</b>', badge:'setup', color:'cb-blue'},
          {text:'Primera campaña <b>Sponsored Content</b> activa', badge:'setup', color:'cb-blue'},
          {text:'<b>Lead Gen Form</b> configurado si el objetivo es leads', badge:'setup', color:'cb-green'},
        ]
      },
      { id:'semana', label:'semana 1', pill:'pill-semana', title:'validación inicial',
        alert:'Si el CTR es menor al 0.4% en la primera semana, el creativo o la segmentación necesita ajuste urgente.',
        tasks:[
          {text:'Revisar <b>CTR</b> — objetivo mínimo 0.4% en LinkedIn', badge:'análisis', color:'cb-blue'},
          {text:'Verificar <b>CPL real</b> vs CPL estimado', badge:'análisis', color:'cb-blue'},
          {text:'Confirmar que <b>Insight Tag reporta</b> visitas correctamente', badge:'crítico', color:'cb-red'},
        ]
      },
      { id:'quincena', label:'quincena 1', pill:'pill-quincena', title:'optimización de segmentación',
        tasks:[
          {text:'Probar <b>Matched Audiences</b> con lista de clientes actuales', badge:'audiencia', color:'cb-green'},
          {text:'Ajustar segmentación — pausar segmentos con <b>CPL alto</b>', badge:'optimizar', color:'cb-amber'},
          {text:'Crear variación del anuncio con <b>diferente titular</b>', badge:'a/b', color:'cb-blue'},
        ]
      },
      { id:'mes', label:'mes 1', pill:'pill-mes', title:'análisis de calidad de leads',
        tasks:[
          {text:'Evaluar <b>calidad de leads</b> con el equipo de ventas', badge:'crítico', color:'cb-red'},
          {text:'Reporte: <b>CPL, CTR, tasa de conversión a oportunidad</b>', badge:'reporte', color:'cb-green'},
          {text:'Evaluar <b>Message Ads</b> para prospectos de alto valor', badge:'expandir', color:'cb-amber'},
        ]
      },
      { id:'trimestre', label:'trimestre', pill:'pill-trimestre', title:'escala B2B',
        tasks:[
          {text:'Implementar <b>Account-Based Marketing</b> con empresas objetivo', badge:'expandir', color:'cb-green'},
          {text:'Crear contenido de <b>Thought Leadership</b> para ejecutivos', badge:'contenido', color:'cb-blue'},
          {text:'Probar <b>Dynamic Ads</b> para personalización a escala', badge:'expandir', color:'cb-amber'},
        ]
      },
      { id:'semestre', label:'semestre', pill:'pill-semestre', title:'pipeline maduro',
        tasks:[
          {text:'Análisis de <b>atribución multi-touch</b> con CRM', badge:'análisis', color:'cb-blue'},
          {text:'Reporte semestral de <b>pipeline generado vs invertido</b>', badge:'reporte', color:'cb-green'},
        ]
      }
    ]
  },
  'seo': {
    title: 'hoja de ruta · seo',
    stages: [
      { id:'dia', label:'semana 1', pill:'pill-dia', title:'diagnóstico inicial',
        alert:'No hagas cambios masivos sin un diagnóstico previo. Identifica primero qué está funcionando.',
        tasks:[
          {text:'Configurar <b>Google Search Console</b> y Google Analytics 4', badge:'crítico', color:'cb-red'},
          {text:'Auditoría técnica: <b>velocidad, móvil, indexación</b>', badge:'crítico', color:'cb-red'},
          {text:'Identificar las <b>10 páginas con más tráfico</b> actuales', badge:'análisis', color:'cb-blue'},
          {text:'Mapear las <b>keywords que ya posicionan</b> en top 20', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'semana', label:'mes 1', pill:'pill-semana', title:'correcciones técnicas',
        tasks:[
          {text:'Corregir errores de <b>indexación y rastreo</b> críticos', badge:'técnico', color:'cb-red'},
          {text:'Optimizar <b>velocidad de carga</b> (Core Web Vitals)', badge:'técnico', color:'cb-amber'},
          {text:'Revisar y corregir <b>etiquetas title y meta description</b>', badge:'on-page', color:'cb-blue'},
          {text:'Implementar <b>estructura de URLs limpia y jerárquica</b>', badge:'on-page', color:'cb-blue'},
        ]
      },
      { id:'quincena', label:'mes 2-3', pill:'pill-quincena', title:'optimización on-page',
        tasks:[
          {text:'Optimizar páginas clave con <b>keywords objetivo</b>', badge:'on-page', color:'cb-blue'},
          {text:'Crear o mejorar <b>contenido existente</b> con intención de búsqueda', badge:'contenido', color:'cb-green'},
          {text:'Implementar <b>enlazado interno estratégico</b>', badge:'on-page', color:'cb-amber'},
          {text:'Optimizar imágenes: <b>alt text, compresión, WebP</b>', badge:'técnico', color:'cb-amber'},
        ]
      },
      { id:'mes', label:'mes 4-6', pill:'pill-mes', title:'creación de contenido',
        tasks:[
          {text:'Publicar <b>4-8 artículos SEO</b> mensuales optimizados', badge:'contenido', color:'cb-green'},
          {text:'Crear <b>páginas pilares</b> para clusters de keywords', badge:'contenido', color:'cb-green'},
          {text:'Monitorear <b>posiciones en Search Console</b> semanalmente', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'trimestre', label:'mes 7-9', pill:'pill-trimestre', title:'autoridad de dominio',
        tasks:[
          {text:'Estrategia de <b>link building</b> con sitios de calidad', badge:'off-page', color:'cb-green'},
          {text:'Guest posts en <b>medios y blogs de la industria</b>', badge:'off-page', color:'cb-green'},
          {text:'Análisis de <b>backlinks de competencia</b> para replicar', badge:'análisis', color:'cb-blue'},
        ]
      },
      { id:'semestre', label:'año 1+', pill:'pill-semestre', title:'posicionamiento consolidado',
        tasks:[
          {text:'Reporte semestral de <b>tráfico orgánico y posiciones</b>', badge:'reporte', color:'cb-green'},
          {text:'Análisis de <b>ROI orgánico</b> vs inversión en contenido', badge:'análisis', color:'cb-blue'},
          {text:'Planificación de <b>contenido y SEO para el siguiente año</b>', badge:'planificar', color:'cb-amber'},
        ]
      }
    ]
  },
  'social': {
    title: 'hoja de ruta · contenido para redes',
    stages: [
      { id:'dia', label:'semana 1', pill:'pill-dia', title:'estudio de marca',
        alert:'Sin una identidad clara, el contenido se verá inconsistente y no construirá comunidad.',
        tasks:[
          {text:'Definir <b>voz y tono de marca</b> para redes sociales', badge:'crítico', color:'cb-red'},
          {text:'Establecer <b>paleta de colores y tipografía</b> para contenido', badge:'setup', color:'cb-blue'},
          {text:'Auditar <b>perfiles existentes</b> y unificar información', badge:'setup', color:'cb-blue'},
          {text:'Definir <b>pilares de contenido</b> (educación, entretenimiento, ventas)', badge:'estrategia', color:'cb-green'},
        ]
      },
      { id:'semana', label:'mes 1', pill:'pill-semana', title:'primera parrilla',
        tasks:[
          {text:'Crear <b>parrilla de contenido mensual</b> con 20-30 piezas', badge:'crear', color:'cb-green'},
          {text:'Establecer <b>frecuencia de publicación</b> por red social', badge:'setup', color:'cb-blue'},
          {text:'Crear plantillas de <b>diseño para stories, posts y reels</b>', badge:'crear', color:'cb-green'},
          {text:'Programar primeras 2 semanas de contenido', badge:'publicar', color:'cb-amber'},
        ]
      },
      { id:'quincena', label:'mes 2', pill:'pill-quincena', title:'análisis inicial',
        tasks:[
          {text:'Analizar <b>tasa de engagement</b> por tipo de contenido', badge:'análisis', color:'cb-blue'},
          {text:'Identificar los <b>mejores horarios de publicación</b>', badge:'análisis', color:'cb-blue'},
          {text:'Replicar los <b>formatos con mayor alcance</b>', badge:'optimizar', color:'cb-amber'},
        ]
      },
      { id:'mes', label:'mes 3', pill:'pill-mes', title:'optimización de contenido',
        tasks:[
          {text:'Reporte mensual: <b>alcance, engagement, seguidores</b>', badge:'reporte', color:'cb-green'},
          {text:'Ajustar <b>mezcla de formatos</b> según rendimiento', badge:'optimizar', color:'cb-amber'},
          {text:'Implementar <b>contenido generado por usuario (UGC)</b>', badge:'expandir', color:'cb-green'},
        ]
      },
      { id:'trimestre', label:'trimestre', pill:'pill-trimestre', title:'crecimiento acelerado',
        tasks:[
          {text:'Estrategia de <b>colaboraciones con micro-influencers</b>', badge:'expandir', color:'cb-green'},
          {text:'Crear <b>serie de contenido</b> para fidelizar audiencia', badge:'crear', color:'cb-blue'},
          {text:'Implementar <b>historias interactivas</b> (encuestas, preguntas)', badge:'engagement', color:'cb-amber'},
        ]
      },
      { id:'semestre', label:'semestre', pill:'pill-semestre', title:'comunidad consolidada',
        tasks:[
          {text:'Reporte semestral de <b>crecimiento de comunidad</b>', badge:'reporte', color:'cb-green'},
          {text:'Estrategia de contenido <b>multiplataforma integrada</b>', badge:'planificar', color:'cb-blue'},
        ]
      }
    ]
  }
};

// ── ROADMAP PERSISTENCE ──────────────────────────────────────────────────────

function rmStorageKey() {
  const uid = clerkInstance?.user?.id || 'anon';
  const clientId = agencyActiveClientId || 'solo';
  const agentKey = currentAgentCtx || 'google-ads';
  return `rm_progress_${uid}_${clientId}_${agentKey}`;
}

function rmSaveProgress() {
  const progress = {};
  document.querySelectorAll('#rm-panel-body .cl-item[data-ridx]').forEach(item => {
    progress[item.dataset.ridx] = item.classList.contains('done');
  });
  try { localStorage.setItem(rmStorageKey(), JSON.stringify(progress)); } catch(e) {}
}

function rmLoadProgress() {
  try { return JSON.parse(localStorage.getItem(rmStorageKey()) || '{}'); } catch { return {}; }
}

function rmToggleTask(el) {
  el.classList.toggle('done');
  const done = el.classList.contains('done');
  const check = el.querySelector('.cl-check');
  const mark  = el.querySelector('.cl-check-mark');
  if (done) {
    check.style.background   = 'var(--success)';
    check.style.borderColor  = 'var(--success)';
    mark.style.display       = 'block';
  } else {
    check.style.background   = 'var(--bg)';
    check.style.borderColor  = 'var(--border2)';
    mark.style.display       = 'none';
  }
  rmSaveProgress();
}

function rmRestoreProgress() {
  const progress = rmLoadProgress();
  document.querySelectorAll('#rm-panel-body .cl-item[data-ridx]').forEach(item => {
    if (progress[item.dataset.ridx]) {
      item.classList.add('done');
      const check = item.querySelector('.cl-check');
      const mark  = item.querySelector('.cl-check-mark');
      check.style.background  = 'var(--success)';
      check.style.borderColor = 'var(--success)';
      mark.style.display      = 'block';
    }
  });
}

function openRoadmap() {
  const agentKey = currentAgentCtx || 'google-ads';
  const data = ROADMAP_CONTENT[agentKey] || ROADMAP_CONTENT['google-ads'];
  
  document.getElementById('rm-panel-title').textContent = data.title;
  
  // Renderizar contenido
  let html = '';
  
  // Selector de etapas
  html += '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:16px">';
  data.stages.forEach((stage, idx) => {
    html += `<button onclick="rmShowStage(${idx})" id="rm-stage-${idx}" 
      style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:500;cursor:pointer;border:1.5px solid var(--border2);background:${idx===0?'var(--blue)':'var(--bg)'};color:${idx===0?'#fff':'var(--muted)'};font-family:var(--font);transition:all .15s" 
      >${stage.label}</button>`;
  });
  html += '</div>';
  
  // Contenido de etapas
  data.stages.forEach((stage, idx) => {
    html += `<div id="rm-stage-content-${idx}" style="display:${idx===0?'block':'none'}">`;
    html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px">`;
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">`;
    html += `<span class="stage-period-pill ${stage.pill}" style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600">${stage.label}</span>`;
    html += `<span style="font-size:14px;font-weight:600">${stage.title}</span>`;
    html += `</div>`;
    if(stage.alert) {
      html += `<div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:8px 12px;font-size:12px;color:#92400E;margin-bottom:10px">⚠ ${stage.alert}</div>`;
    }
    html += `</div>`;
    
    // Checklist — data-ridx = "stageIdx_taskIdx" para persistencia
    html += `<div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px">`;
    stage.tasks.forEach((task, tidx) => {
      const ridx = `${idx}_${tidx}`;
      html += `<div class="cl-item" data-ridx="${ridx}" onclick="rmToggleTask(this)" style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid var(--border2);font-size:12px;cursor:pointer">`;
      html += `<div class="cl-check" style="width:16px;height:16px;border:1.5px solid var(--border2);border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;margin-top:1px;background:var(--bg);transition:all .15s">`;
      html += `<svg class="cl-check-mark" style="display:none;width:8px;height:8px" viewBox="0 0 10 8" fill="none"><path d="M1 4l3 3 5-6" stroke="white" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      html += `</div>`;
      html += `<div class="cl-text" style="line-height:1.4;color:var(--muted);flex:1">${task.text}</div>`;
      html += `<span class="cl-badge ${task.color}" style="font-size:10px;padding:1px 6px;border-radius:10px;flex-shrink:0">${task.badge}</span>`;
      html += `</div>`;
    });
    html += `</div>`;

    // Botón preguntar al agente
    html += `<button class="ask-agent-btn" onclick="askAgentFromRoadmap('${stage.id}')" style="margin-bottom:16px">▸ preguntar al agente sobre esta etapa</button>`;
    html += `</div>`;
  });

  document.getElementById('rm-panel-body').innerHTML = html;

  // Restaurar progreso guardado desde localStorage
  rmRestoreProgress();

  document.getElementById('rm-overlay').classList.add('open');
  document.getElementById('rm-panel').classList.add('open');
}

function rmShowStage(idx) {
  document.querySelectorAll('[id^="rm-stage-content-"]').forEach(el => el.style.display = 'none');
  document.querySelectorAll('[id^="rm-stage-"]').forEach(btn => {
    if(btn.id.startsWith('rm-stage-') && !btn.id.includes('content')) {
      btn.style.background = 'var(--bg)';
      btn.style.color = 'var(--muted)';
      btn.style.borderColor = 'var(--border2)';
    }
  });
  const content = document.getElementById('rm-stage-content-'+idx);
  const btn = document.getElementById('rm-stage-'+idx);
  if(content) content.style.display = 'block';
  if(btn) { btn.style.background = 'var(--blue)'; btn.style.color = '#fff'; btn.style.borderColor = 'var(--blue)'; }
}

function closeRoadmap() {
  document.getElementById('rm-overlay').classList.remove('open');
  document.getElementById('rm-panel').classList.remove('open');
}

function askAgentFromRoadmap(stageId) {
  closeRoadmap();
  askAgent(stageId);
  showView('chat');
}

// =============================================
// GENERACIÓN DE IMÁGENES PARA ANUNCIOS META
// =============================================

async function generateAdImages(cmd) {
  var prompt = cmd.prompt, format = cmd.format || 'vertical', variations = cmd.variations || 1, hasText = cmd.hasText !== false;
  var batchIndex = cmd._index || 1, batchTotal = cmd._total || 1;
  var isSocial = cmd._social || false;
  var thinkId = addThinking();
  setTimeout(function() {
    var el = document.getElementById(thinkId);
    if (el) { var txt = el.querySelector('.thinking-bbl'); if (txt) txt.innerHTML = '<div class="spinner"></div>generando creativo ' + batchIndex + ' de ' + batchTotal + '...'; }
  }, 100);
  try {
    var headers = { 'Content-Type': 'application/json' };
    if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
    var res = await fetch('/api/generate-image', {
      method: 'POST', headers: headers,
      body: JSON.stringify({ prompt: prompt, format: format, variations: 1, hasText: hasText }),
    });
    var data = await res.json();
    rmThinking(thinkId);
    if (data.error) { addAgent('No pude generar el creativo ' + batchIndex + ': ' + data.error); return; }
    if (data.images && data.images.length > 0) {
      renderAdImage(data.images[0], batchIndex, batchTotal, format, prompt, isSocial);
    }
  } catch (err) {
    rmThinking(thinkId);
    addAgent('Error generando creativo ' + batchIndex + ': ' + err.message);
  }
}

var generatedAdImages = [];
var adImgGridEl = null; // Contenedor grid compartido para todas las imágenes del batch

function openAdLightbox(base64, mediaType, label) {
  // Remover lightbox anterior si existe
  var existing = document.getElementById('ad-lightbox');
  if (existing) existing.remove();

  var lb = document.createElement('div');
  lb.id = 'ad-lightbox';
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
  lb.onclick = function(e) { if (e.target === lb) lb.remove(); };

  lb.innerHTML =
    '<div style="position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;max-height:100%">' +
      '<button onclick="this.closest(\'#ad-lightbox\').remove()" style="position:absolute;top:-12px;right:-12px;width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.15);border:none;color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:1">✕</button>' +
      '<div style="font-size:11px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:.5px;text-transform:uppercase">' + (label || '') + '</div>' +
      '<img src="data:' + mediaType + ';base64,' + base64 + '" style="max-height:85vh;max-width:90vw;border-radius:12px;object-fit:contain;box-shadow:0 24px 80px rgba(0,0,0,.6)">' +
      '<button onclick="downloadAdImage(\'' + base64 + '\',\'' + mediaType + '\',\'anuncio.png\')" style="padding:10px 24px;background:white;color:#1a1a1a;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font);display:flex;align-items:center;gap:6px">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        'Descargar imagen' +
      '</button>' +
    '</div>';

  document.body.appendChild(lb);
}

function renderAdImage(img, index, total, format, prompt, isSocial) {
  generatedAdImages.push({ base64: img.base64, mediaType: img.mediaType, index: index, format: format });

  var fmtLabel = { square:'Feed cuadrado · 1080×1080', vertical:'Feed vertical · 1080×1350', story:'Stories/Reels · 1080×1920', carousel:'Carrusel · 1080×1080' }[format] || format;
  var ratio = { square:'1/1', vertical:'4/5', story:'9/16', carousel:'1/1' }[format] || '4/5';
  var maxH = { square:'220px', vertical:'260px', story:'280px', carousel:'220px' }[format] || '260px';
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var dlIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var fbIcon = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>';
  var imgIdx = index - 1;
  var fn = (isSocial ? 'post_' : 'anuncio_') + format + '_v' + index + '.png';

  // Crear el contenedor grid la primera vez
  if (index === 1) {
    adImgGridEl = document.createElement('div');
    adImgGridEl.className = 'msg';
    adImgGridEl.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';

    var gridHeader = document.createElement('div');
    gridHeader.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;width:100%';
    var badge = isSocial
      ? '<span style="margin-left:8px;background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">Contenido orgánico</span>'
      : '<span style="margin-left:8px;background:#ECFDF5;color:#059669;padding:2px 8px;border-radius:100px;font-size:10px;font-weight:700">Listas para Meta</span>';
    gridHeader.innerHTML =
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div style="font-size:12px;color:var(--muted);font-weight:500">' + fmtLabel + badge + '</div>';

    var gridWrap = document.createElement('div');
    gridWrap.id = 'ad-img-grid';
    gridWrap.style.cssText = 'display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;padding-left:42px;width:calc(100% - 0px);scrollbar-width:thin';

    adImgGridEl.appendChild(gridHeader);
    adImgGridEl.appendChild(gridWrap);
    document.getElementById('chat-area').appendChild(adImgGridEl);
  }

  // Agregar la imagen al grid
  var grid = document.getElementById('ad-img-grid');
  if (!grid) return;

  var card = document.createElement('div');
  card.style.cssText = 'flex-shrink:0;width:160px';
  // Social: solo botón descargar. Meta: descargar + publicar
  var btnHtml = isSocial
    ? '<button onclick="downloadAdImage(\'' + img.base64 + '\',\'' + img.mediaType + '\',\'' + fn + '\')" style="width:100%;padding:6px 4px;background:var(--blue);color:white;border:none;border-radius:7px;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:3px">' + dlIcon + ' Descargar</button>'
    : '<button onclick="downloadAdImage(\'' + img.base64 + '\',\'' + img.mediaType + '\',\'' + fn + '\')" style="flex:1;padding:6px 4px;background:var(--blue);color:white;border:none;border-radius:7px;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:3px">' + dlIcon + ' Descargar</button>'
    + '<button onclick="publishToMeta(' + imgIdx + ')" style="flex:1;padding:6px 4px;background:#1877F2;color:white;border:none;border-radius:7px;font-size:10px;font-weight:600;cursor:pointer;font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:3px">' + fbIcon + ' Publicar</button>';

  card.innerHTML =
    '<div style="font-size:10px;color:var(--muted);margin-bottom:5px;font-weight:600;text-align:center">V' + index + '</div>' +
    '<div onclick="openAdLightbox(\'' + img.base64 + '\',\'' + img.mediaType + '\',\'V' + index + ' · ' + fmtLabel + '\')" style="border-radius:10px;overflow:hidden;border:1px solid var(--border);aspect-ratio:' + ratio + ';max-height:' + maxH + ';background:var(--sidebar);cursor:zoom-in;position:relative" title="Clic para ver en grande">' +
      '<img src="data:' + img.mediaType + ';base64,' + img.base64 + '" style="width:100%;height:100%;object-fit:cover;display:block"/>' +
      '<div style="position:absolute;inset:0;background:rgba(0,0,0,0);transition:background .15s;display:flex;align-items:center;justify-content:center" onmouseover="this.style.background=\'rgba(0,0,0,.25)\'" onmouseout="this.style.background=\'rgba(0,0,0,0)\'">' +
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" style="opacity:0;transition:opacity .15s" class="lb-zoom-icon"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;gap:5px;margin-top:7px">' + btnHtml + '</div>';
  grid.appendChild(card);
  scrollB();

  // Al completar todas las imágenes
  if (index === total && total > 1) {
    setTimeout(function() {
      if (isSocial) {
        // Agente social: mensaje limpio sin campaña
        addAgent('✅ ' + total + ' imágenes para tu parrilla listas. Descárgalas y úsalas en tus publicaciones orgánicas.');
      } else {
        // Agente Meta: banner de campaña + posibles stories
        var logoSvg2 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
        var allEl = document.createElement('div');
        allEl.className = 'msg';
        allEl.innerHTML =
          '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg2 + '</div>' +
          '<div style="background:linear-gradient(135deg,#1877F2,#0d5cb8);border-radius:14px;padding:16px 18px;max-width:300px">' +
            '<div style="font-size:13px;font-weight:700;color:white;margin-bottom:4px">¿Listo para publicar?</div>' +
            '<div style="font-size:12px;color:rgba(255,255,255,.8);margin-bottom:12px">' + total + ' creativos listos para Meta Ads.</div>' +
            '<button onclick="launchMetaCampaignFlow()" style="width:100%;padding:9px;background:white;color:#1877F2;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">🚀 Crear campaña con estas imágenes</button>' +
          '</div>';
        document.getElementById('chat-area').appendChild(allEl);
        scrollB();
        setTimeout(function() { showCopysButton(total, 'feed'); }, 300);
      }
    }, 300);
  }
}

function showCopysButton(count, type) {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var isVariations = type === 'variaciones';
  var isStories = type === 'stories';
  var promptText = isVariations
    ? 'Se generaron ' + count + ' variaciones de mi anuncio. Dame el copy optimizado (texto principal, título, CTA) para cada variación y recomienda cuál probar primero según principios de testing A/B para Meta Ads.'
    : isStories
      ? 'Tengo ' + count + ' creativos (' + Math.round(count/2) + ' feed + ' + Math.round(count/2) + ' stories). Dame el copy optimizado para cada variación y recomienda cuál probar primero.'
      : 'Se generaron ' + count + ' creativos listos para Meta Ads. Dame el copy optimizado (texto principal, título, CTA) para cada creativo y recomienda cuál probar primero según el objetivo del negocio.';

  var el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML =
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg + '</div>' +
    '<div style="background:var(--bg);border:1.5px solid var(--border);border-radius:14px;padding:16px 18px;max-width:320px">' +
      '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">¿también quieres los copys?</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">Puedo generar el texto principal, título y CTA optimizados para cada creativo.</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button onclick="requestCopys(this,\'' + promptText.replace(/'/g, "\\'") + '\')" style="flex:1;padding:9px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">✍️ Sí, crear copys</button>' +
        '<button onclick="this.closest(\'.msg\').remove()" style="padding:9px 12px;background:var(--sidebar);color:var(--muted);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">No, gracias</button>' +
      '</div>' +
    '</div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function requestCopys(btn, promptText) {
  btn.closest('.msg').remove();
  hist.push({ role: 'user', content: promptText });
  callClaude();
}

function downloadAdImage(base64, mediaType, filename) {
  var a = document.createElement('a');
  a.href = 'data:' + mediaType + ';base64,' + base64;
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function publishToMeta(imgIndex) {
  var img = generatedAdImages[imgIndex];
  if (!img) return;
  var cin = document.getElementById('cin');
  if (cin) { cin.value = 'Quiero publicar la variacion ' + img.index + ' en una campana de Meta Ads.'; sendMsg(); }
}

// ─── WIZARD DE CREACIÓN DE CAMPAÑA EN META ────────────────────────────────────
var campaignWizardStep = 1;
var campaignWizardData = {};
var campaignWizardImages = [];

async function launchMetaCampaignFlow() {
  // 1. Buscar token en sessionStorage → localStorage → Supabase (en ese orden)
  let token  = sessionStorage.getItem('meta_access_token')
            || localStorage.getItem('meta_access_token_persist');

  if (!token) {
    // Intentar desde Supabase directamente (Clerk ya cargó cuando el usuario hizo click)
    try {
      var uid = clerkInstance?.user?.id;
      if (uid) {
        var connRes  = await fetch('/api/admin?action=get-connection&userId=' + encodeURIComponent(uid) + '&platform=meta_ads');
        var connData = await connRes.json();
        if (connData.connected && connData.access_token) {
          token = connData.access_token;
          sessionStorage.setItem('meta_access_token', token);
          localStorage.setItem('meta_access_token_persist', token);
          updateMetaUI(true, connData.account_name || '');
        }
      }
    } catch(e) {}
  }

  if (!token) {
    addAgent('Para crear una campaña necesitas conectar tu cuenta de Meta Ads primero. Ve a **Configuración > Conexiones > Meta Ads**.');
    return;
  }

  // 2. Buscar account_id en sessionStorage → localStorage → Meta API
  let acctId = sessionStorage.getItem('meta_ad_account_id')
             || localStorage.getItem('meta_ad_account_id_persist');

  if (acctId) {
    // Restaurar en sessionStorage si venía de localStorage
    sessionStorage.setItem('meta_ad_account_id', acctId);
    var persistedAcc = localStorage.getItem('meta_active_account_persist');
    if (persistedAcc && !sessionStorage.getItem('meta_active_account')) {
      sessionStorage.setItem('meta_active_account', persistedAcc);
    }
  } else {
    // Auto-seleccionar primera cuenta disponible
    try {
      var accRes  = await fetch('/api/meta-list-accounts', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ accessToken: token }),
      });
      var accData = await accRes.json();
      if (accData.accounts && accData.accounts.length > 0) {
        var acc = accData.accounts[0];
        acctId  = acc.id;
        sessionStorage.setItem('meta_ad_account_id', acc.id);
        sessionStorage.setItem('meta_active_account', JSON.stringify(acc));
        localStorage.setItem('meta_ad_account_id_persist', acc.id);
        localStorage.setItem('meta_active_account_persist', JSON.stringify(acc));
      } else {
        addAgent('No se encontró ninguna cuenta publicitaria. Ve a **Configuración > Conexiones > Meta Ads** para seleccionar una.');
        return;
      }
    } catch(e) {
      addAgent('Para crear una campaña necesitas seleccionar una cuenta publicitaria en **Configuración > Conexiones > Meta Ads**.');
      return;
    }
  }

  campaignWizardImages = (generatedAdImages || []).slice();
  var acctCurrency = 'USD';
  try { acctCurrency = JSON.parse(sessionStorage.getItem('meta_active_account') || '{}').currency || 'USD'; } catch(e) {}
  campaignWizardData   = { adAccountId: acctId, token, currency: acctCurrency };
  campaignWizardStep   = 1;
  renderCampaignWizard();
}

function renderCampaignWizard() {
  var existing = document.getElementById('cw-overlay');
  if (existing) existing.remove();

  var steps = ['Objetivo','Presupuesto','Audiencia','Creativos','Lanzar'];
  var pills  = steps.map(function(s,i){
    var active = (i+1 === campaignWizardStep) ? 'background:#1877F2;color:#fff' : (i+1 < campaignWizardStep ? 'background:#e8f0fe;color:#1877F2' : 'background:#f3f4f6;color:#999');
    return '<div style="flex:1;text-align:center;padding:6px 4px;border-radius:20px;font-size:11px;font-weight:600;'+active+'">'+(i+1)+'. '+s+'</div>';
  }).join('');

  var body = '';
  if (campaignWizardStep === 1) {
    body = '<div style="margin-bottom:16px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Nombre de la campaña</label>'+
      '<input id="cw-name" placeholder="Ej: Leads Noviembre 2025" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box" value="'+(campaignWizardData.name||'')+'"></div>'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:10px">Objetivo de la campaña</label>'+
      [['OUTCOME_LEADS','🎯 Generación de leads','Formularios nativos de Meta para captar contactos'],
       ['OUTCOME_TRAFFIC','🌐 Tráfico al sitio web','Lleva personas a tu landing page o sitio web'],
       ['OUTCOME_AWARENESS','👁 Reconocimiento','Muestra el anuncio al mayor número de personas'],
       ['OUTCOME_SALES','🛒 Ventas','Optimiza para conversiones en tu sitio o tienda'],
       ['OUTCOME_ENGAGEMENT','💬 Interacción','Más likes, comentarios y reacciones en tu publicación'],
       ['OUTCOME_MESSAGES','📱 Mensajes','Lleva personas a que te escriban por WhatsApp, Messenger o Instagram DM']
      ].map(function(o){
        var sel = campaignWizardData.objective === o[0] ? 'border:2px solid #1877F2;background:#e8f0fe' : 'border:1px solid #e5e7eb;background:#fff';
        return '<div onclick="cwSelectObj(\''+o[0]+'\')" style="'+sel+';border-radius:10px;padding:12px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:12px">'+
          '<div style="font-size:20px">'+o[1].split(' ')[0]+'</div>'+
          '<div><div style="font-weight:600;font-size:13px">'+o[1].split(' ').slice(1).join(' ')+'</div><div style="font-size:11px;color:#666">'+o[2]+'</div></div></div>';
      }).join('') +
      // Selector de app de mensajería — aparece solo cuando el objetivo es OUTCOME_MESSAGES
      (campaignWizardData.objective === 'OUTCOME_MESSAGES' ?
        '<div style="margin-top:4px;padding:12px;background:#e8f0fe;border-radius:10px;border:2px solid #1877F2">' +
        '<div style="font-weight:600;font-size:12px;margin-bottom:8px;color:#1877F2">¿Por qué app recibirás los mensajes?</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px">' +
        [['whatsapp','💬 WhatsApp'],['messenger','📨 Messenger'],['instagram','📸 Instagram DM']].map(function(a){
          var sel2 = (campaignWizardData.messagingApp||'whatsapp') === a[0] ? 'background:#1877F2;color:#fff;border-color:#1877F2' : 'background:#fff;color:#333;border-color:#ddd';
          return '<button onclick="cwSelectMessagingApp(\''+a[0]+'\')" style="'+sel2+';border:1px solid;border-radius:20px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;font-family:var(--font)">'+a[1]+'</button>';
        }).join('') +
        '</div></div>'
      : '') +
      '</div>';
  } else if (campaignWizardStep === 2) {
    var cwCurrency = (function(){ try { return JSON.parse(sessionStorage.getItem('meta_active_account')||'{}').currency || 'USD'; } catch(e){ return 'USD'; } })();
    var cwMinBudget = cwCurrency === 'COP' ? '20.000' : cwCurrency === 'MXN' ? '100' : cwCurrency === 'ARS' ? '1.000' : '5';
    var cwSugBudget = cwCurrency === 'COP' ? '50.000–200.000' : cwCurrency === 'MXN' ? '200–800' : cwCurrency === 'ARS' ? '5.000–20.000' : '5–20';
    body = '<div style="margin-bottom:16px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Presupuesto diario ('+cwCurrency+')</label>'+
      '<div style="display:flex;align-items:center;gap:8px"><span style="font-size:20px;color:#555">$</span>'+
      '<input id="cw-budget" type="number" min="1" placeholder="'+cwMinBudget+'" style="flex:1;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:18px;font-weight:700" value="'+(campaignWizardData.budget||'')+'">'+
      '<span style="color:#777;font-size:13px">'+cwCurrency+'/día</span></div>'+
      '<div style="margin-top:8px;font-size:12px;color:#888">Mínimo $'+cwMinBudget+' '+cwCurrency+'/día. Para leads recomendamos $'+cwSugBudget+' '+cwCurrency+'/día.</div></div>'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:10px">Duración</label>'+
      [['7','7 días'],['14','14 días'],['30','30 días'],['0','Sin fecha de fin']].map(function(d){
        var sel = String(campaignWizardData.durationDays) === d[0] ? 'border:2px solid #1877F2;background:#e8f0fe' : 'border:1px solid #e5e7eb;background:#fff';
        return '<div onclick="cwSelectDuration('+d[0]+')" style="'+sel+';border-radius:8px;padding:10px 14px;margin-bottom:8px;cursor:pointer;font-size:13px;font-weight:500">'+d[1]+'</div>';
      }).join('') + '</div>';
  } else if (campaignWizardStep === 3) {
    body = '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">País</label>'+
      '<input id="cw-country" placeholder="Colombia" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box" value="'+(campaignWizardData.country||'Colombia')+'"></div>'+
      '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Ciudad (opcional)</label>'+
      '<input id="cw-city" placeholder="Bogotá" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box" value="'+(campaignWizardData.city||'')+'"></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Edad mínima</label>'+
      '<input id="cw-age-min" type="number" min="18" max="65" value="'+(campaignWizardData.ageMin||18)+'" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Edad máxima</label>'+
      '<input id="cw-age-max" type="number" min="18" max="65" value="'+(campaignWizardData.ageMax||55)+'" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div></div>'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:8px">Género</label>'+
      '<div style="display:flex;gap:8px">'+
      [['0','Todos'],['2','Mujeres'],['1','Hombres']].map(function(g){
        var sel = String(campaignWizardData.gender) === g[0] ? 'background:#1877F2;color:#fff;border-color:#1877F2' : 'background:#fff;color:#333;border-color:#ddd';
        return '<button onclick="cwSelectGender('+g[0]+')" style="'+sel+';border:1px solid;border-radius:20px;padding:7px 16px;cursor:pointer;font-size:13px;font-weight:500">'+g[1]+'</button>';
      }).join('')+'</div></div>';
  } else if (campaignWizardStep === 4) {
    var fmt = campaignWizardData.adFormat || 'image';

    // ── Selector de formato ────────────────────────────────
    var fmtSel = '<div style="display:flex;gap:6px;margin-bottom:16px">'+
      [['image','📷 Imagen'],['carousel','🎠 Carrusel'],['video','🎬 Video']].map(function(f){
        var a = fmt===f[0] ? 'background:#1877F2;color:#fff;border-color:#1877F2' : 'background:#fff;color:#555;border-color:#ddd';
        return '<button onclick="cwSetFormat(\''+f[0]+'\')" style="'+a+';border:1px solid;border-radius:20px;padding:6px 14px;cursor:pointer;font-size:12px;font-weight:600;font-family:var(--font)">'+f[1]+'</button>';
      }).join('')+'</div>';

    // ── Grid de imágenes generadas ─────────────────────────
    var imgGrid = '';
    if (campaignWizardImages && campaignWizardImages.length) {
      var gridLabel = fmt==='carousel' ? 'Imágenes generadas — selecciona hasta 5' : 'Imágenes generadas — selecciona una';
      imgGrid = '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:8px">'+gridLabel+'</label>'+
        '<div style="display:flex;flex-wrap:wrap;gap:8px">'+
        campaignWizardImages.map(function(img,i){
          var sel,badge;
          if (fmt==='carousel') {
            var idxs = campaignWizardData.carouselIndexes||[];
            var pos = idxs.indexOf(i);
            sel = pos>=0 ? 'border:3px solid #1877F2;' : 'border:2px solid #e5e7eb;';
            badge = pos>=0 ? '<div style="position:absolute;top:3px;right:3px;background:#1877F2;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center">'+(pos+1)+'</div>' : '';
          } else {
            sel = campaignWizardData.adImageIndex===i ? 'border:3px solid #1877F2;' : 'border:2px solid #e5e7eb;';
            badge = campaignWizardData.adImageIndex===i ? '<div style="position:absolute;top:3px;right:3px;background:#1877F2;color:#fff;font-size:10px;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center">✓</div>' : '';
          }
          return '<div class="cw-img-thumb" data-idx="'+i+'" onclick="cwSelectImage('+i+')" style="'+sel+'border-radius:8px;overflow:hidden;cursor:pointer;width:80px;height:80px;flex-shrink:0;position:relative">'+
            '<img src="data:'+img.mediaType+';base64,'+img.base64+'" style="width:100%;height:100%;object-fit:cover">'+badge+'</div>';
        }).join('')+'</div></div>';
    }

    // ── Sección de copy con botón IA ───────────────────────
    var copySection =
      '<div style="margin-bottom:12px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<label style="font-weight:600;font-size:13px">Texto del anuncio <span style="font-weight:400;color:#888;font-size:12px">(opcional)</span></label>'+
          '<button id="cw-gen-btn" onclick="cwGenerateCopy()" style="display:inline-flex;align-items:center;gap:5px;background:#f0f4ff;color:#1877F2;border:1px solid #c7d7ff;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font)">✨ Generar con IA</button>'+
        '</div>'+
        '<textarea id="cw-ad-body" rows="3" placeholder="Ej: ¿Buscas crecer tu negocio? 🚀 Llegamos a más clientes para ti. ¡Escríbenos hoy!" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical">'+(campaignWizardData.adBody||'')+'</textarea>'+
      '<div style="font-size:11px;color:#999;text-align:right;margin-top:2px">Máx. 125 caracteres</div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Título <span style="font-weight:400;color:#888;font-size:12px">(opcional)</span></label>'+
          '<input id="cw-ad-title" placeholder="Ej: ¡Empieza gratis hoy!" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box" value="'+(campaignWizardData.adTitle||'')+'">'+
          '<div style="font-size:11px;color:#999;text-align:right;margin-top:2px">Máx. 40 caracteres</div></div>'+
        '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Descripción <span style="font-weight:400;color:#888;font-size:12px">(opcional)</span></label>'+
          '<input id="cw-ad-description" placeholder="Ej: Envío gratis · Sin contrato" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box" value="'+(campaignWizardData.adDescription||'')+'">'+
          '<div style="font-size:11px;color:#999;text-align:right;margin-top:2px">Máx. 30 caracteres</div></div>'+
      '</div>';

    var urlSection = ['OUTCOME_TRAFFIC','OUTCOME_SALES','OUTCOME_MESSAGES'].includes(campaignWizardData.objective) ?
      '<div style="margin-bottom:12px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">URL de destino</label>'+
        '<input id="cw-ad-url" type="url" placeholder="https://tudominio.com/landing" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box" value="'+(campaignWizardData.adUrl||'')+'"></div>' : '';

    // La página de Facebook se carga en background — no se muestra al usuario
    var pageSection = '<div id="cw-pages-container" style="display:none"></div>';

    var skipNote = '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #eee;font-size:12px;color:#999">'+
      '💡 Si prefieres agregar los anuncios luego, puedes continuar sin imagen — la campaña quedará pausada en Meta Ads Manager.</div>';

    if (fmt === 'video') {
      // ── Formato Video ──────────────────────────────────
      body = fmtSel+
        '<div style="background:#fff8e6;border:1px solid #ffd970;border-radius:8px;padding:12px;font-size:12px;color:#7a5700;margin-bottom:14px">'+
          '🎬 <strong>Subir video desde Acuarius</strong> — Selecciona un MP4 o MOV. Los videos se suben directamente a Meta y pueden tardar 1-2 min en procesar antes de publicarse.</div>'+
        '<div style="margin-bottom:14px">'+
          '<label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Archivo de video</label>'+
          '<label style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:#f3f4f6;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500">'+
            '⬆️ Subir video (MP4 / MOV)'+
            '<input type="file" accept="video/mp4,video/quicktime" onchange="cwHandleVideoUpload(this)" style="display:none">'+
          '</label>'+
          (campaignWizardData.adVideoName ? '<div style="margin-top:8px;font-size:12px;color:#1877F2;font-weight:600">✅ '+campaignWizardData.adVideoName+'</div>' : '')+
        '</div>'+
        copySection + urlSection + pageSection + skipNote;
    } else if (fmt === 'carousel') {
      // ── Formato Carrusel ───────────────────────────────
      var carouselPreviews = '';
      if (campaignWizardData.carouselPreviews && campaignWizardData.carouselPreviews.length) {
        carouselPreviews = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">'+
          campaignWizardData.carouselPreviews.map(function(src){
            return '<img src="'+src+'" style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:2px solid #1877F2">';
          }).join('')+'</div>';
      }
      body = fmtSel + imgGrid +
        '<div style="margin-bottom:14px">'+
          '<label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">O sube imágenes nuevas (hasta 5)</label>'+
          '<label style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:#f3f4f6;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500">'+
            '⬆️ Subir imágenes'+
            '<input type="file" accept="image/jpeg,image/png,image/webp" multiple onchange="cwHandleImageUpload(this)" style="display:none">'+
          '</label>'+
          carouselPreviews+
        '</div>'+
        copySection + urlSection + pageSection + skipNote;
    } else {
      // ── Formato Imagen (single) ────────────────────────
      var singlePreview = campaignWizardData.adImagePreview
        ? '<img src="'+campaignWizardData.adImagePreview+'" style="max-height:80px;border-radius:8px;display:block;margin-top:8px;border:2px solid #1877F2">'
        : '';
      body = fmtSel + imgGrid +
        '<div style="margin-bottom:14px">'+
          '<label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">'+(campaignWizardImages&&campaignWizardImages.length?'O sube una imagen nueva':'📎 Imagen del anuncio')+'</label>'+
          '<label style="display:inline-flex;align-items:center;gap:8px;padding:10px 16px;background:#f3f4f6;border-radius:8px;cursor:pointer;font-size:13px;font-weight:500">'+
            '⬆️ Subir imagen'+
            '<input type="file" accept="image/jpeg,image/png,image/webp" onchange="cwHandleImageUpload(this)" style="display:none">'+
          '</label>'+
          singlePreview+
        '</div>'+
        copySection + urlSection + pageSection + skipNote;
    }
    setTimeout(function(){ cwLoadPages(); }, 50);

  } else if (campaignWizardStep === 5) {
    var objLabels = {OUTCOME_LEADS:'Generación de leads',OUTCOME_TRAFFIC:'Tráfico al sitio web',OUTCOME_AWARENESS:'Reconocimiento',OUTCOME_SALES:'Ventas',OUTCOME_ENGAGEMENT:'Interacción',OUTCOME_MESSAGES:'Mensajes / WhatsApp'};
    var dur = campaignWizardData.durationDays === 0 ? 'Sin fecha de fin' : campaignWizardData.durationDays + ' días';
    var msgAppLabel = {whatsapp:'💬 WhatsApp',messenger:'📨 Messenger',instagram:'📸 Instagram DM'}[campaignWizardData.messagingApp||'whatsapp'] || 'WhatsApp';
    body = '<div style="background:#f8fafc;border-radius:12px;padding:16px;margin-bottom:16px">'+
      '<div style="font-weight:700;font-size:14px;margin-bottom:12px;color:#1877F2">Resumen de campaña</div>'+
      [['Nombre',campaignWizardData.name],['Objetivo',objLabels[campaignWizardData.objective]],
       ...(campaignWizardData.objective==='OUTCOME_MESSAGES' ? [['App de mensajería', msgAppLabel]] : []),
       ['Presupuesto','$'+(campaignWizardData.budget||campaignWizardData.budgetUSD)+' '+(campaignWizardData.currency||'USD')+'/día'],['Duración',dur],
       ['País',campaignWizardData.country+(campaignWizardData.city?' · '+campaignWizardData.city:'')],
       ['Edad',campaignWizardData.ageMin+' – '+campaignWizardData.ageMax+' años'],
       ['Género',{0:'Todos',1:'Hombres',2:'Mujeres'}[campaignWizardData.gender]||'Todos'],
       ['Creativos', (function(){
         var f=campaignWizardData.adFormat||'image';
         if(f==='carousel'){var n=(campaignWizardData.carouselImages||[]).length;return n>0?'🎠 '+n+' imágenes (carrusel)':'Sin imágenes — agregar luego';}
         if(f==='video'){return campaignWizardData.adVideo?'🎬 Video listo':'Sin video — agregar luego';}
         return campaignWizardData.adImage?'✅ Imagen lista':'Sin imagen — agregar luego';
       })()]
      ].map(function(r){
        return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee;font-size:13px"><span style="color:#666">'+r[0]+'</span><span style="font-weight:600">'+r[1]+'</span></div>';
      }).join('')+'</div>'+
      '<div style="background:#fff3cd;border-radius:8px;padding:12px;font-size:12px;color:#856404;margin-bottom:8px">'+
      '⚠️ La campaña se creará en estado <strong>PAUSADA</strong> para que puedas revisarla antes de activarla en Meta Ads Manager.</div>'+
      '<div id="cw-launch-msg" style="display:none"></div>';
  }

  var html = '<div id="cw-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center">'+
    '<div style="background:#fff;border-radius:16px;padding:28px;width:min(500px,92vw);max-height:90vh;overflow-y:auto;position:relative;z-index:9999">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'+
    '<h3 style="margin:0;font-size:18px">🚀 Crear campaña en Meta</h3>'+
    '<button onclick="closeCampaignWizard()" style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;line-height:1">×</button></div>'+
    '<div style="display:flex;gap:6px;margin-bottom:20px">'+pills+'</div>'+
    '<div id="cw-body">'+body+'</div>'+
    '<div style="display:flex;gap:10px;margin-top:20px">'+
    (campaignWizardStep > 1 ? '<button onclick="cwPrev()" style="flex:1;padding:12px;border:1px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:14px">← Atrás</button>' : '')+
    (campaignWizardStep < 5
      ? '<button onclick="cwNext()" style="flex:2;padding:12px;background:#1877F2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">Continuar →</button>'
      : '<button id="cw-launch-btn" onclick="cwLaunch()" style="flex:2;padding:12px;background:#1877F2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">🚀 Crear campaña</button>')+
    '</div></div></div>';

  var el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el.firstElementChild);
}

// Helpers para guardar campos activos antes de re-renderizar (evita que se borren)
function cwSaveStep1Fields() {
  var n = document.getElementById('cw-name'); if (n) campaignWizardData.name = n.value;
}
function cwSaveStep2Fields() {
  var b = document.getElementById('cw-budget'); if (b && b.value) campaignWizardData.budget = parseFloat(b.value) || campaignWizardData.budget;
}
function cwSaveStep3Fields() {
  var co = document.getElementById('cw-country'); if (co) campaignWizardData.country = co.value;
  var ci = document.getElementById('cw-city');    if (ci) campaignWizardData.city    = ci.value;
  var am = document.getElementById('cw-age-min'); if (am) campaignWizardData.ageMin  = parseInt(am.value)||18;
  var ax = document.getElementById('cw-age-max'); if (ax) campaignWizardData.ageMax  = parseInt(ax.value)||55;
}
function cwSaveStep4Fields() {
  var t = document.getElementById('cw-ad-title');       if (t) campaignWizardData.adTitle       = t.value;
  var b = document.getElementById('cw-ad-body');        if (b) campaignWizardData.adBody        = b.value;
  var d = document.getElementById('cw-ad-description'); if (d) campaignWizardData.adDescription = d.value;
  var u = document.getElementById('cw-ad-url');         if (u) campaignWizardData.adUrl         = u.value;
}

function cwSelectObj(obj) {
  cwSaveStep1Fields(); // guardar nombre antes de re-renderizar
  campaignWizardData.objective = obj;
  if (obj === 'OUTCOME_MESSAGES' && !campaignWizardData.messagingApp) campaignWizardData.messagingApp = 'whatsapp';
  renderCampaignWizard();
}
function cwSelectMessagingApp(app) { cwSaveStep1Fields(); campaignWizardData.messagingApp = app; renderCampaignWizard(); }
function cwSelectDuration(d) { cwSaveStep2Fields(); campaignWizardData.durationDays = d; renderCampaignWizard(); }
function cwSelectGender(g) { cwSaveStep3Fields(); campaignWizardData.gender = g; renderCampaignWizard(); }

function cwSetFormat(fmt) {
  cwSaveStep4Fields(); // guardar copy antes de re-renderizar
  campaignWizardData.adFormat = fmt;
  renderCampaignWizard();
}

async function cwGenerateCopy() {
  var btn = document.getElementById('cw-gen-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
  try {
    var clientProfile = '';
    try { clientProfile = JSON.stringify(mem || {}); } catch(e) {}
    var r = await fetch('/api/meta-ads?action=generate-copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken:   campaignWizardData.token,
        adAccountId:   campaignWizardData.adAccountId,
        campaignName:  campaignWizardData.name,
        objective:     campaignWizardData.objective,
        clientProfile: clientProfile,
      }),
    });
    var data = await r.json();
    if (data.error) throw new Error(data.error);
    if (data.title)       { var t=document.getElementById('cw-ad-title');       if(t) t.value=data.title;       }
    if (data.body)        { var b=document.getElementById('cw-ad-body');        if(b) b.value=data.body;        }
    if (data.description) { var d=document.getElementById('cw-ad-description'); if(d) d.value=data.description; }
    if (!data.title && !data.body) throw new Error('La IA no generó texto. Inténtalo de nuevo.');
    campaignWizardData.adTitle       = data.title       || '';
    campaignWizardData.adBody        = data.body        || '';
    campaignWizardData.adDescription = data.description || '';
  } catch(e) {
    if (btn) btn.innerHTML = '✨ Generar con IA';
    var errDiv = document.getElementById('cw-gen-error');
    if (!errDiv) {
      errDiv = document.createElement('div');
      errDiv.id = 'cw-gen-error';
      errDiv.style.cssText = 'color:#dc2626;font-size:12px;margin-top:4px';
      var genBtn = document.getElementById('cw-gen-btn');
      if (genBtn && genBtn.parentNode) genBtn.parentNode.parentNode.appendChild(errDiv);
    }
    errDiv.textContent = '⚠️ ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '✨ Generar con IA'; }
  }
}

function cwHandleVideoUpload(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 200 * 1024 * 1024) { alert('El video no puede superar 200 MB.'); return; }
  campaignWizardData.adVideoName = file.name;
  var reader = new FileReader();
  reader.onload = function(e) {
    var dataUrl = e.target.result;
    var match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (match) { campaignWizardData.adVideo = { base64: match[2], mediaType: match[1] }; }
    var nameEl = input.closest('div').querySelector('.cw-video-name');
    if (!nameEl) {
      nameEl = document.createElement('div');
      nameEl.className = 'cw-video-name';
      nameEl.style.cssText = 'margin-top:8px;font-size:12px;color:#1877F2;font-weight:600';
      input.closest('label').after(nameEl);
    }
    nameEl.textContent = '✅ ' + file.name;
  };
  reader.readAsDataURL(file);
}

function cwSelectImage(idx) {
  var fmt = campaignWizardData.adFormat || 'image';
  var img = campaignWizardImages[idx];
  if (!img) return;

  if (fmt === 'carousel') {
    // Toggle selection en carrusel — máx 5
    var idxs = campaignWizardData.carouselIndexes || [];
    var pos = idxs.indexOf(idx);
    if (pos >= 0) {
      idxs.splice(pos, 1);
    } else {
      if (idxs.length >= 5) { alert('Máximo 5 imágenes en un carrusel.'); return; }
      idxs.push(idx);
    }
    campaignWizardData.carouselIndexes = idxs;
    campaignWizardData.carouselImages  = idxs.map(function(i){ return { base64: campaignWizardImages[i].base64, mediaType: campaignWizardImages[i].mediaType }; });
    // Actualizar visual sin re-render
    document.querySelectorAll('.cw-img-thumb').forEach(function(el) {
      var i = parseInt(el.dataset.idx);
      var p = idxs.indexOf(i);
      el.style.border = p>=0 ? '3px solid #1877F2' : '2px solid #e5e7eb';
      var badge = el.querySelector('div');
      if (p>=0) {
        if (!badge) { badge=document.createElement('div'); badge.style.cssText='position:absolute;top:3px;right:3px;background:#1877F2;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;display:flex;align-items:center;justify-content:center'; el.appendChild(badge); }
        badge.textContent = p+1;
      } else { if (badge) badge.remove(); }
    });
  } else {
    // Imagen simple
    campaignWizardData.adImageIndex   = idx;
    campaignWizardData.adImage        = { base64: img.base64, mediaType: img.mediaType };
    campaignWizardData.adImagePreview = 'data:' + img.mediaType + ';base64,' + img.base64;
    document.querySelectorAll('.cw-img-thumb').forEach(function(el, i) {
      el.style.border = i === idx ? '3px solid #1877F2' : '2px solid #e5e7eb';
    });
  }
}

function cwHandleImageUpload(input) {
  var files = Array.from(input.files || []);
  if (!files.length) return;
  var fmt = campaignWizardData.adFormat || 'image';

  if (fmt === 'carousel') {
    // Leer hasta 5 archivos para carrusel
    var total = Math.min(files.length, 5);
    var results = [];
    var previews = [];
    files.slice(0, total).forEach(function(file, i) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var dataUrl = e.target.result;
        var match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) { results[i] = { base64: match[2], mediaType: match[1] }; previews[i] = dataUrl; }
        if (results.filter(Boolean).length === total) {
          campaignWizardData.carouselImages  = results.filter(Boolean);
          campaignWizardData.carouselPreviews = previews.filter(Boolean);
          campaignWizardData.carouselIndexes = [];
          // Show previews inline
          var label = input.closest('label');
          if (label) {
            var existing = label.parentElement.querySelector('.cw-carousel-previews');
            if (existing) existing.remove();
            var div = document.createElement('div');
            div.className = 'cw-carousel-previews';
            div.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:8px';
            previews.filter(Boolean).forEach(function(src) {
              var img = document.createElement('img');
              img.src = src;
              img.style.cssText = 'width:56px;height:56px;object-fit:cover;border-radius:6px;border:2px solid #1877F2';
              div.appendChild(img);
            });
            label.parentElement.appendChild(div);
          }
        }
      };
      reader.readAsDataURL(file);
    });
  } else {
    // Imagen simple
    var reader2 = new FileReader();
    reader2.onload = function(e) {
      var dataUrl = e.target.result;
      var match2 = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match2) return;
      campaignWizardData.adImage        = { base64: match2[2], mediaType: match2[1] };
      campaignWizardData.adImagePreview = dataUrl;
      campaignWizardData.adImageIndex   = undefined;
      var label = input.closest('label');
      if (label) {
        var existing = label.parentElement.querySelector('img.cw-upload-preview');
        if (existing) existing.remove();
        var preview = document.createElement('img');
        preview.src = dataUrl;
        preview.className = 'cw-upload-preview';
        preview.style.cssText = 'max-height:80px;border-radius:8px;display:block;margin-top:8px;border:2px solid #1877F2';
        label.parentElement.appendChild(preview);
      }
    };
    reader2.readAsDataURL(files[0]);
  }
}

// cwLoadPages — carga la página de Facebook en BACKGROUND sin mostrar nada al usuario.
// Auto-selecciona la primera página encontrada via promote_pages o me/accounts.
async function cwLoadPages() {
  if (campaignWizardData.pageId) return; // ya tenemos página — nada que hacer
  // Restaurar desde localStorage
  var lsPageKey = 'meta_saved_page_' + (campaignWizardData.adAccountId || 'default');
  var saved = localStorage.getItem(lsPageKey);
  if (saved) {
    try { var sp = JSON.parse(saved); campaignWizardData.pageId = sp.id; return; } catch(e){}
  }
  // Llamar al endpoint (usa promote_pages primero, luego me/accounts)
  try {
    var url = '/api/meta-ads?action=get-pages&accessToken=' + encodeURIComponent(campaignWizardData.token) +
              '&adAccountId=' + encodeURIComponent(campaignWizardData.adAccountId || '');
    var r = await fetch(url);
    var pages = await r.json();
    if (Array.isArray(pages) && pages.length > 0) {
      campaignWizardData.pageId = pages[0].id;
      localStorage.setItem(lsPageKey, JSON.stringify({ id: pages[0].id, name: pages[0].name }));
    }
  } catch(e) { /* silencioso — la campaña se crea sin ad si no hay página */ }
}

function cwNext() {
  if (campaignWizardStep === 1) {
    var name = (document.getElementById('cw-name')||{}).value||'';
    if (!name.trim()) { alert('Ingresa un nombre para la campaña.'); return; }
    if (!campaignWizardData.objective) { alert('Selecciona un objetivo.'); return; }
    campaignWizardData.name = name.trim();
  } else if (campaignWizardStep === 2) {
    var budget = parseFloat((document.getElementById('cw-budget')||{}).value||0);
    if (!budget || budget < 1) { alert('Ingresa un presupuesto válido.'); return; }
    if (campaignWizardData.durationDays === undefined) { alert('Selecciona la duración.'); return; }
    campaignWizardData.budget = budget;
    campaignWizardData.budgetUSD = budget; // alias legacy
    // Guardar moneda de la cuenta
    try { campaignWizardData.currency = JSON.parse(sessionStorage.getItem('meta_active_account')||'{}').currency || 'USD'; } catch(e) { campaignWizardData.currency = 'USD'; }
  } else if (campaignWizardStep === 3) {
    campaignWizardData.country = (document.getElementById('cw-country')||{}).value||'Colombia';
    campaignWizardData.city    = (document.getElementById('cw-city')||{}).value||'';
    campaignWizardData.ageMin  = parseInt((document.getElementById('cw-age-min')||{}).value||18);
    campaignWizardData.ageMax  = parseInt((document.getElementById('cw-age-max')||{}).value||55);
  } else if (campaignWizardStep === 4) {
    campaignWizardData.adTitle       = (document.getElementById('cw-ad-title')||{}).value||'';
    campaignWizardData.adBody        = (document.getElementById('cw-ad-body')||{}).value||'';
    campaignWizardData.adDescription = (document.getElementById('cw-ad-description')||{}).value||'';
    campaignWizardData.adUrl         = (document.getElementById('cw-ad-url')||{}).value||'';
    // pageId se carga en background por cwLoadPages — no hay input visible
    if (!campaignWizardData.adFormat) campaignWizardData.adFormat = 'image';
  }
  campaignWizardStep++;
  renderCampaignWizard();
}

function cwPrev() { campaignWizardStep--; renderCampaignWizard(); }

function closeCampaignWizard() {
  var el = document.getElementById('cw-overlay');
  if (el) el.remove();
}

async function cwLaunch() {
  var btn = document.getElementById('cw-launch-btn');
  var msg = document.getElementById('cw-launch-msg');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando campaña...'; }

  try {
    var r = await fetch('/api/meta-ads?action=create-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken:   campaignWizardData.token,
        adAccountId:   campaignWizardData.adAccountId,
        name:          campaignWizardData.name,
        objective:     campaignWizardData.objective,
        budget:        campaignWizardData.budget,
        currency:      campaignWizardData.currency || 'USD',
        durationDays:  campaignWizardData.durationDays,
        country:       campaignWizardData.country,
        city:          campaignWizardData.city,
        ageMin:        campaignWizardData.ageMin,
        ageMax:        campaignWizardData.ageMax,
        gender:        campaignWizardData.gender,
        pageId:        campaignWizardData.pageId       || '',
        messagingApp:  campaignWizardData.messagingApp || 'whatsapp',
      }),
    });
    var data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error al crear la campaña');

    // Guardar IDs para el botón de activar
    campaignWizardData.createdCampaignId = data.campaignId;
    campaignWizardData.createdAdsetId    = data.adsetId;

    // Crear anuncio según formato seleccionado
    // Para WhatsApp: el creative requiere WhatsApp Business vinculado a la página,
    // lo que depende de la configuración del cliente en Meta Business → se omite y se guía al usuario.
    var isMessagingCampaign = campaignWizardData.objective === 'OUTCOME_MESSAGES';
    var adFmt = campaignWizardData.adFormat || 'image';
    var hasCreative = (adFmt==='carousel' && (campaignWizardData.carouselImages||[]).length>0) ||
                      (adFmt==='video'    && campaignWizardData.adVideo) ||
                      (adFmt==='image'    && campaignWizardData.adImage);
    if (!isMessagingCampaign && hasCreative && campaignWizardData.pageId) {
      try {
        var adPayload = {
          accessToken:   campaignWizardData.token,
          adAccountId:   campaignWizardData.adAccountId,
          adsetId:       data.adsetId,
          pageId:        campaignWizardData.pageId,
          adTitle:       campaignWizardData.adTitle,
          adBody:        campaignWizardData.adBody,
          adDescription: campaignWizardData.adDescription || '',
          adUrl:         campaignWizardData.adUrl || 'https://www.facebook.com',
          format:        adFmt,
        };
        if (adFmt === 'carousel') {
          adPayload.imagesBase64 = campaignWizardData.carouselImages.map(function(i){ return i.base64; });
        } else if (adFmt === 'video') {
          adPayload.videoBase64 = campaignWizardData.adVideo.base64;
        } else {
          adPayload.imageBase64 = campaignWizardData.adImage.base64;
        }
        var adR = await fetch('/api/meta-ads?action=create-ad', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(adPayload),
        });
        var adData = await adR.json();
        if (adData.adId) data.adId = adData.adId;
        if (adData.error) data.adWarning = adData.error;
      } catch(adErr) {
        console.warn('Ad creation failed (campaign still created):', adErr.message);
        data.adWarning = 'Campaña creada. Error en el anuncio: ' + adErr.message;
      }
    } else if (isMessagingCampaign) {
      // Para WhatsApp/Messenger/IG DM: el creative necesita configuración específica en Meta
      data.adWarning = 'whatsapp_manual';
    }

    // Mostrar pantalla de éxito dentro del wizard
    var overlay = document.getElementById('cw-overlay');
    if (overlay) {
      overlay.querySelector('div').innerHTML =
        '<div style="text-align:center;padding:32px 24px">' +
        '<div style="font-size:48px;margin-bottom:12px">✅</div>' +
        '<h3 style="margin:0 0 8px;font-size:18px;color:#111">Campaña creada</h3>' +
        '<p style="color:#555;font-size:14px;margin:0 0 4px"><strong>' + campaignWizardData.name + '</strong></p>' +
        '<p style="color:#888;font-size:12px;margin:0 0 24px">Estado actual: <strong style="color:#f59e0b">PAUSADA</strong> — no está gastando presupuesto</p>' +
        '<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:20px;text-align:left;font-size:12px;color:#666">' +
        '<div style="margin-bottom:4px">Campaign ID: <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px">' + data.campaignId + '</code></div>' +
        '<div style="margin-bottom:4px">Ad Set ID: <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px">' + data.adsetId + '</code></div>' +
        (data.adId ? '<div>Ad ID: <code style="background:#e5e7eb;padding:1px 5px;border-radius:4px">' + data.adId + '</code></div>' : '') +
        '</div>' +
        (data.adWarning === 'whatsapp_manual'
          ? '<div style="background:#e8f5e9;border-radius:8px;padding:12px;font-size:12px;color:#2e7d32;margin-bottom:16px;text-align:left">'+
            '💬 <strong>Campaña de WhatsApp creada.</strong> Para agregar el anuncio ve a <strong>Meta Ads Manager → ' + campaignWizardData.name + ' → Agregar anuncio</strong> y selecciona tu número de WhatsApp Business como destino.</div>'
          : data.adWarning
            ? '<div style="background:#fff3cd;border-radius:8px;padding:10px;font-size:12px;color:#856404;margin-bottom:16px;text-align:left">⚠️ ' + data.adWarning + '</div>'
            : '') +
        '<p style="font-size:12px;color:#888;margin-bottom:20px">¿Quieres activarla ahora? Confirma que los creativos y el targeting están listos antes de gastar presupuesto.</p>' +
        '<div style="display:flex;flex-direction:column;gap:10px">' +
        '<button id="cw-activate-btn" onclick="activateCreatedCampaign()" style="width:100%;padding:13px;background:#1877F2;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600">▶ Activar campaña ahora</button>' +
        '<button onclick="closeCampaignWizard()" style="width:100%;padding:12px;background:#f3f4f6;color:#333;border:none;border-radius:8px;cursor:pointer;font-size:13px">Dejar pausada · activar luego en Meta Ads Manager</button>' +
        '</div></div>';
    }
  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Crear campaña'; }
    if (msg) { msg.style.display='block'; msg.style.cssText='display:block;background:#fee2e2;color:#991b1b;border-radius:8px;padding:12px;font-size:13px;margin-top:8px'; msg.textContent = '❌ ' + err.message; }
  }
}

async function activateCreatedCampaign() {
  var campaignId = campaignWizardData.createdCampaignId;
  var adsetId    = campaignWizardData.createdAdsetId;
  var token      = campaignWizardData.token;
  if (!campaignId || !token) return;
  var btn = document.getElementById('cw-activate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Activando...'; }
  try {
    var r = await fetch('/api/meta-ads?action=update-campaign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, adAccountId: campaignWizardData.adAccountId, campaignId, adsetId, status: 'ACTIVE' }),
    });
    var data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error al activar');
    closeCampaignWizard();
    addAgent('▶️ **Campaña activada — está gastando presupuesto**\n\n' +
      '**' + campaignWizardData.name + '** está ahora activa en Meta Ads.\n\n' +
      'Monitorearé el rendimiento y te alertaré si detecto anomalías (frecuencia alta, CPA elevado, 0 conversiones). ' +
      'Puedes pausarla o ajustar el presupuesto directamente desde aquí cuando quieras.');
  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Activar campaña ahora'; }
    alert('Error al activar: ' + err.message);
  }
}

function requestImageVariation(encodedPrompt, format) {
  var cin = document.getElementById('cin');
  if (cin) { cin.value = 'Genera una variacion diferente, mismo concepto pero composicion distinta. Formato: ' + format + '.'; sendMsg(); }
}

// =============================================
// GOOGLE ADS CAMPAIGN WIZARD
// =============================================

var googleWizardStep = 1;
var googleWizardData = {};

async function launchGoogleCampaignFlow() {
  var token      = sessionStorage.getItem('ads_access_token')  || localStorage.getItem('ads_access_token_persist');
  var customerId = sessionStorage.getItem('ads_customer_id')   || localStorage.getItem('ads_customer_id_persist');
  var accStr     = sessionStorage.getItem('ads_active_account')|| localStorage.getItem('ads_active_account_persist') || '{}';
  var acc = {}; try { acc = JSON.parse(accStr); } catch(e){}

  if (!token) {
    alert('Para crear una campaña necesitas conectar tu cuenta de Google Ads en Configuración.');
    openSettings(); return;
  }
  if (!customerId) {
    alert('Selecciona una cuenta de Google Ads en Configuración → Conexiones.');
    openSettings(); return;
  }

  googleWizardData  = { token: token, customerId: customerId, currency: acc.currency || 'USD', accountName: acc.name || '' };
  googleWizardStep  = 1;
  renderGoogleCampaignWizard();
}

function gcwSelectObj(obj) {
  gcwSaveStep1Fields();
  googleWizardData.objective = obj;
  renderGoogleCampaignWizard();
}
function gcwSelectLang(id) {
  gcwSaveStep2Fields();
  googleWizardData.languageId = id;
  renderGoogleCampaignWizard();
}
function gcwSaveStep1Fields() {
  var n = document.getElementById('gcw-name');   if (n) googleWizardData.name   = n.value;
  var b = document.getElementById('gcw-budget'); if (b) googleWizardData.budget = parseFloat(b.value)||0;
}
function gcwSaveStep2Fields() {
  var c = document.getElementById('gcw-country'); if (c) googleWizardData.countryGeoId = c.value;
}
function gcwSaveStep3Fields() {
  var k = document.getElementById('gcw-keywords');          if (k) googleWizardData.keywordsText          = k.value;
  var n = document.getElementById('gcw-negative-keywords'); if (n) googleWizardData.negativeKeywordsText  = n.value;
}
function gcwSaveStep4Fields() {
  var u = document.getElementById('gcw-final-url'); if (u) googleWizardData.finalUrl = u.value;
  var heads = document.querySelectorAll('.gcw-headline');
  var descs = document.querySelectorAll('.gcw-description');
  googleWizardData.headlines    = Array.from(heads).map(function(el){ return el.value; });
  googleWizardData.descriptions = Array.from(descs).map(function(el){ return el.value; });
}
function gcwCountChars(input, max) {
  var len = input.value.length;
  var counter = input.nextElementSibling;
  if (counter) {
    counter.textContent = len + '/' + max;
    counter.style.color = len > max ? '#dc2626' : (len > max * 0.9 ? '#f59e0b' : '#888');
  }
  input.style.borderColor = len > max ? '#dc2626' : '#ddd';
}

function gcwNext() {
  if (googleWizardStep === 1) {
    gcwSaveStep1Fields();
    if (!googleWizardData.name || !googleWizardData.name.trim()) { alert('Ingresa un nombre para la campaña.'); return; }
    if (!googleWizardData.objective) { alert('Selecciona un objetivo.'); return; }
    if (!googleWizardData.budget || googleWizardData.budget <= 0) { alert('Ingresa el presupuesto diario.'); return; }
  } else if (googleWizardStep === 2) {
    gcwSaveStep2Fields();
    if (!googleWizardData.countryGeoId) googleWizardData.countryGeoId = '2170';
    if (!googleWizardData.languageId)   googleWizardData.languageId   = '1003';
  } else if (googleWizardStep === 3) {
    gcwSaveStep3Fields();
  } else if (googleWizardStep === 4) {
    gcwSaveStep4Fields();
  }
  googleWizardStep++;
  renderGoogleCampaignWizard();
}
function gcwPrev() {
  if (googleWizardStep === 2) gcwSaveStep2Fields();
  if (googleWizardStep === 3) gcwSaveStep3Fields();
  if (googleWizardStep === 4) gcwSaveStep4Fields();
  googleWizardStep--;
  renderGoogleCampaignWizard();
}
function closeGoogleCampaignWizard() {
  var el = document.getElementById('gcw-overlay');
  if (el) el.remove();
}

async function gcwGenerateContent() {
  var btn = document.getElementById('gcw-gen-btn') || document.querySelector('[onclick*="gcwGenerateContent"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando...'; }
  try {
    var clientProfile = '';
    try { clientProfile = JSON.stringify(mem || {}); } catch(e){}
    var r = await fetch('/api/google-ads?action=generate-ad-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignName:  googleWizardData.name,
        objective:     googleWizardData.objective,
        clientProfile: clientProfile,
        userId:        (typeof clerkInstance !== 'undefined' && clerkInstance?.user?.id) || '',
        customerId:    googleWizardData.customerId,
        accessToken:   googleWizardData.token,
      }),
    });
    var data = await r.json();
    if (data.error) throw new Error(data.error);

    // Guardar todo en wizardData
    if (data.keywords)         googleWizardData.generatedKeywords    = data.keywords;
    if (data.negativeKeywords) googleWizardData.generatedNegatives   = data.negativeKeywords;
    if (data.headlines)        googleWizardData.headlines            = data.headlines;
    if (data.descriptions)     googleWizardData.descriptions         = data.descriptions;

    // Si estamos en el paso 3, poblar los textareas
    if (googleWizardStep === 3) {
      var kwEl = document.getElementById('gcw-keywords');
      var negEl = document.getElementById('gcw-negative-keywords');
      if (kwEl && data.keywords) {
        googleWizardData.keywordsText = data.keywords.map(function(k){
          if (k.matchType === 'EXACT')   return '[' + k.text + ']';
          if (k.matchType === 'PHRASE')  return '"' + k.text + '"';
          return k.text;
        }).join('\n');
        kwEl.value = googleWizardData.keywordsText;
      }
      if (negEl && data.negativeKeywords) {
        googleWizardData.negativeKeywordsText = data.negativeKeywords.join('\n');
        negEl.value = googleWizardData.negativeKeywordsText;
      }
    }

    // Si estamos en el paso 4, poblar los inputs RSA
    if (googleWizardStep === 4) {
      renderGoogleCampaignWizard(); // re-render con los nuevos headlines/descriptions
    }

  } catch(e) {
    var errEl = document.getElementById('gcw-gen-error');
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.id = 'gcw-gen-error';
      errEl.style.cssText = 'color:#dc2626;font-size:12px;margin-top:6px';
      var genBtn = document.getElementById('gcw-gen-btn');
      if (genBtn && genBtn.parentNode) genBtn.parentNode.parentNode.appendChild(errEl);
    }
    errEl.textContent = '⚠️ ' + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '✨ Generar con IA'; }
  }
}

function renderGoogleCampaignWizard() {
  var steps = ['Campaña','Segmentación','Keywords','Anuncio RSA'];
  var stepInd = steps.map(function(s, i) {
    var done    = i + 1 < googleWizardStep;
    var current = i + 1 === googleWizardStep;
    var dotSt   = current ? 'background:#1E2BCC;color:#fff' : (done ? 'background:#e8eafc;color:#1E2BCC' : 'background:#f3f4f6;color:#999');
    var lblSt   = 'font-size:11px;color:' + (current ? '#1E2BCC' : '#999') + ';font-weight:' + (current ? '600' : '400');
    return '<div style="display:flex;align-items:center;gap:5px">' +
      '<div style="width:22px;height:22px;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;'+dotSt+'">'+(done?'✓':(i+1))+'</div>'+
      '<span style="'+lblSt+'">'+s+'</span></div>' +
      (i < steps.length - 1 ? '<div style="flex:1;height:1px;background:#e5e7eb;margin:0 2px"></div>' : '');
  }).join('');

  var body = '';
  var isLastStep = googleWizardStep === 4;

  if (googleWizardStep === 1) {
    var objectives = [
      ['LEADS',    '🎯','Generación de leads',  'Formularios y llamadas'],
      ['SALES',    '🛒','Ventas',               'Conversiones en el sitio web'],
      ['TRAFFIC',  '🌐','Tráfico',              'Visitas al sitio web'],
      ['AWARENESS','👁️','Reconocimiento de marca','Impresiones y visibilidad'],
    ];
    body =
      '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Nombre de la campaña</label>'+
        '<input id="gcw-name" placeholder="Ej: Leads - Servicios Contables Nov 2025" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box" value="'+(googleWizardData.name||'')+'"></div>'+
      '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:8px">Objetivo de campaña</label>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">'+
          objectives.map(function(o){
            var sel = googleWizardData.objective === o[0] ? 'border:2px solid #1E2BCC;background:#e8eafc' : 'border:1px solid #e5e7eb;background:#fff';
            return '<div onclick="gcwSelectObj(\''+o[0]+'\')" style="'+sel+';border-radius:10px;padding:12px;cursor:pointer;transition:all .1s">'+
              '<div style="font-size:18px;margin-bottom:4px">'+o[1]+'</div>'+
              '<div style="font-size:12px;font-weight:600;color:#1E2BCC">'+o[2]+'</div>'+
              '<div style="font-size:11px;color:#888;margin-top:2px">'+o[3]+'</div></div>';
          }).join('')+
        '</div></div>'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Presupuesto diario ('+googleWizardData.currency+')</label>'+
        '<input id="gcw-budget" type="number" min="1" placeholder="Ej: 50" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:18px;font-weight:700;box-sizing:border-box" value="'+(googleWizardData.budget||'')+'"></div>';

  } else if (googleWizardStep === 2) {
    var countries = [
      ['Colombia','2170'],['México','2484'],['Argentina','2032'],['Chile','2152'],
      ['Perú','2604'],['Venezuela','2862'],['Ecuador','2218'],['Bolivia','2068'],
      ['Costa Rica','2188'],['Guatemala','2320'],['El Salvador','2222'],['Honduras','2340'],
      ['Panamá','2591'],['Rep. Dominicana','2214'],['Uruguay','2858'],['Paraguay','2600'],
      ['España','2724'],['USA','2840'],
    ];
    var selGeoId = googleWizardData.countryGeoId || '2170';
    body =
      '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">País de segmentación</label>'+
        '<select id="gcw-country" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;background:#fff">'+
          countries.map(function(c){ return '<option value="'+c[1]+'"'+(selGeoId===c[1]?' selected':'')+'>'+c[0]+'</option>'; }).join('')+
        '</select></div>'+
      '<div style="margin-bottom:14px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:8px">Idioma del anuncio</label>'+
        '<div style="display:flex;gap:8px">'+
          [['1003','Español'],['1000','English'],['1014','Português']].map(function(l){
            var sel = (googleWizardData.languageId||'1003') === l[0] ? 'background:#1E2BCC;color:#fff;border-color:#1E2BCC' : 'background:#fff;color:#333;border-color:#ddd';
            return '<button onclick="gcwSelectLang(\''+l[0]+'\')" style="padding:8px 16px;border:1px solid;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;font-family:var(--font);'+sel+'">'+l[1]+'</button>';
          }).join('')+
        '</div></div>'+
      '<div style="background:#f0f4ff;border:1px solid #c7d7ff;border-radius:8px;padding:12px;font-size:12px;color:#1E2BCC">'+
        'ℹ️ La campaña se creará en estado <strong>Pausada</strong> para que puedas revisarla antes de activarla en Google Ads.</div>';

  } else if (googleWizardStep === 3) {
    body =
      '<div style="margin-bottom:12px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<label style="font-weight:600;font-size:13px">Palabras clave <span style="font-weight:400;color:#888;font-size:12px">(una por línea)</span></label>'+
          '<button id="gcw-gen-btn" onclick="gcwGenerateContent()" style="display:inline-flex;align-items:center;gap:5px;background:#f0f4ff;color:#1E2BCC;border:1px solid #c7d7ff;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font)">✨ Generar con IA</button>'+
        '</div>'+
        '<div style="font-size:11px;color:#888;margin-bottom:6px">Usa [corchetes] para exacta, "comillas" para frase, sin símbolo para amplia.</div>'+
        '<textarea id="gcw-keywords" rows="6" placeholder="servicios contables bogota\ncontador publico colombia\n[outsourcing contable]" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical">'+(googleWizardData.keywordsText||'')+'</textarea>'+
      '</div>'+
      '<div><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Keywords negativas <span style="font-weight:400;color:#888;font-size:12px">(opcional, una por línea)</span></label>'+
        '<textarea id="gcw-negative-keywords" rows="3" placeholder="gratis\ncomo hacer\ncurso" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box;resize:vertical">'+(googleWizardData.negativeKeywordsText||'')+'</textarea></div>'+
      '<div id="gcw-gen-error" style="color:#dc2626;font-size:12px;margin-top:6px"></div>';

  } else if (googleWizardStep === 4) {
    var defaultH = googleWizardData.headlines || ['','','','','','','','','',''];
    var defaultD = googleWizardData.descriptions || ['','',''];
    body =
      '<div style="margin-bottom:12px"><label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">URL final del anuncio</label>'+
        '<input id="gcw-final-url" type="url" placeholder="https://tusitio.com/landing" style="width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box" value="'+(googleWizardData.finalUrl||'')+'"></div>'+
      '<div style="margin-bottom:12px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'+
          '<label style="font-weight:600;font-size:13px">Headlines RSA <span style="font-weight:400;color:#888;font-size:12px">(máx 30c c/u — al menos 3)</span></label>'+
          '<button onclick="gcwGenerateContent()" style="display:inline-flex;align-items:center;gap:5px;background:#f0f4ff;color:#1E2BCC;border:1px solid #c7d7ff;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;font-family:var(--font)">✨ Regenerar IA</button>'+
        '</div>'+
        defaultH.map(function(h, i){
          return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'+
            '<span style="font-size:11px;color:#aaa;width:14px;text-align:right">'+(i+1)+'</span>'+
            '<input class="gcw-headline" maxlength="30" placeholder="Headline '+(i+1)+'" style="flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box" value="'+(h||'')+'" oninput="gcwCountChars(this,30)">'+
            '<span style="font-size:10px;color:#aaa;min-width:30px;text-align:right">'+(h?Math.min(h.length,30):0)+'/30</span>'+
          '</div>';
        }).join('')+
      '</div>'+
      '<div>'+
        '<label style="font-weight:600;font-size:13px;display:block;margin-bottom:6px">Descriptions RSA <span style="font-weight:400;color:#888;font-size:12px">(máx 90c c/u — al menos 2)</span></label>'+
        defaultD.map(function(d, i){
          return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px">'+
            '<span style="font-size:11px;color:#aaa;width:14px;text-align:right">'+(i+1)+'</span>'+
            '<input class="gcw-description" maxlength="90" placeholder="Description '+(i+1)+'" style="flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;box-sizing:border-box" value="'+(d||'')+'" oninput="gcwCountChars(this,90)">'+
            '<span style="font-size:10px;color:#aaa;min-width:36px;text-align:right">'+(d?Math.min(d.length,90):0)+'/90</span>'+
          '</div>';
        }).join('')+
      '</div>'+
      '<div id="gcw-launch-msg" style="margin-top:8px;font-size:13px;color:#dc2626"></div>';
  }

  var overlay = document.getElementById('gcw-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'gcw-overlay'; document.body.appendChild(overlay); }
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:16px;width:100%;max-width:540px;max-height:92vh;overflow-y:auto;font-family:var(--font)">'+
      '<div style="background:#1E2BCC;border-radius:16px 16px 0 0;padding:18px 20px;display:flex;justify-content:space-between;align-items:center">'+
        '<div>'+
          (googleWizardData.accountName ? '<div style="font-size:11px;color:rgba(255,255,255,.65);margin-bottom:2px">'+googleWizardData.accountName+'</div>' : '')+
          '<h3 style="margin:0;font-size:17px;color:#fff">🚀 Crear campaña en Google Ads</h3>'+
        '</div>'+
        '<button onclick="closeGoogleCampaignWizard()" style="background:none;border:none;font-size:22px;cursor:pointer;color:rgba(255,255,255,.7);line-height:1">×</button>'+
      '</div>'+
      '<div style="padding:16px 20px 8px">'+
        '<div style="display:flex;align-items:center;gap:4px;margin-bottom:18px">'+stepInd+'</div>'+
        body+
      '</div>'+
      '<div style="padding:12px 20px 18px;display:flex;gap:10px;border-top:1px solid #eee">'+
        (googleWizardStep > 1 ? '<button onclick="gcwPrev()" style="flex:1;padding:12px;background:#f3f4f6;color:#555;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;font-family:var(--font)">← Atrás</button>' : '')+
        (isLastStep
          ? '<button id="gcw-launch-btn" onclick="gcwLaunch()" style="flex:2;padding:12px;background:#1E2BCC;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;font-family:var(--font)">🚀 Crear campaña</button>'
          : '<button onclick="gcwNext()" style="flex:2;padding:12px;background:#1E2BCC;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;font-weight:600;font-family:var(--font)">Siguiente →</button>')+
      '</div>'+
    '</div>';
}

async function gcwLaunch() {
  gcwSaveStep4Fields();
  var btn = document.getElementById('gcw-launch-btn');
  var msg = document.getElementById('gcw-launch-msg');
  if (btn) { btn.disabled = true; btn.textContent = 'Creando campaña...'; }

  // Parsear keywords del textarea
  var keywords = [];
  var negatives = [];
  try {
    var lines = (googleWizardData.keywordsText || '').split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    lines.forEach(function(line) {
      if (/^\[.+\]$/.test(line))       keywords.push({ text: line.slice(1,-1), matchType: 'EXACT' });
      else if (/^".+"$/.test(line))    keywords.push({ text: line.slice(1,-1), matchType: 'PHRASE' });
      else                             keywords.push({ text: line, matchType: 'PHRASE' });
    });
    negatives = (googleWizardData.negativeKeywordsText || '').split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
    // Si el usuario usó keywords generadas por IA y no editó, también están en generatedKeywords
    if (!keywords.length && googleWizardData.generatedKeywords) keywords = googleWizardData.generatedKeywords;
  } catch(e){}

  try {
    var uid = (typeof clerkInstance !== 'undefined' && clerkInstance?.user?.id) || '';
    var r = await fetch('/api/google-ads?action=create-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken:      googleWizardData.token,
        customerId:       googleWizardData.customerId,
        userId:           uid,
        name:             googleWizardData.name,
        objective:        googleWizardData.objective,
        dailyBudget:      googleWizardData.budget,
        currency:         googleWizardData.currency,
        countryGeoId:     googleWizardData.countryGeoId || '2170',
        languageId:       googleWizardData.languageId   || '1003',
        keywords:         keywords,
        negativeKeywords: negatives,
        headlines:        (googleWizardData.headlines    || []).filter(function(h){ return h && h.trim(); }),
        descriptions:     (googleWizardData.descriptions || []).filter(function(d){ return d && d.trim(); }),
        finalUrl:         googleWizardData.finalUrl || '',
      }),
    });
    var data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'Error al crear la campaña');

    // Pantalla de éxito
    var overlay = document.getElementById('gcw-overlay');
    if (overlay) {
      overlay.querySelector('div').innerHTML =
        '<div style="background:#1E2BCC;border-radius:16px 16px 0 0;padding:18px 20px">'+
          '<h3 style="margin:0;font-size:17px;color:#fff">✅ ¡Campaña creada!</h3>'+
        '</div>'+
        '<div style="padding:24px 20px">'+
          '<div style="background:#f0f4ff;border-radius:12px;padding:16px;margin-bottom:16px">'+
            '<div style="font-size:13px;font-weight:700;color:#1E2BCC;margin-bottom:8px">'+googleWizardData.name+'</div>'+
            '<div style="font-size:12px;color:#555;line-height:1.7">'+
              '📋 Campaign ID: <strong>'+data.campaignId+'</strong><br>'+
              '📦 Ad Group ID: <strong>'+data.adGroupId+'</strong>'+
              (data.adId ? '<br>📢 Ad RSA ID: <strong>'+data.adId+'</strong>' : '')+
            '</div>'+
          '</div>'+
          '<div style="background:#fff8e6;border:1px solid #ffd970;border-radius:8px;padding:12px;font-size:12px;color:#7a5700;margin-bottom:16px">'+
            '⏸️ La campaña está <strong>Pausada</strong>. Revísala en Google Ads Manager y actívala cuando estés listo.'+
          '</div>'+
          '<a href="https://ads.google.com" target="_blank" style="display:block;text-align:center;padding:11px;background:#1E2BCC;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;margin-bottom:8px">Abrir Google Ads →</a>'+
          '<button onclick="closeGoogleCampaignWizard()" style="width:100%;padding:10px;background:#f3f4f6;color:#555;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-family:var(--font)">Cerrar</button>'+
        '</div>';
    }
    addAgent('✅ **Campaña creada en Google Ads**\n\n**'+googleWizardData.name+'** está lista (Pausada).\n\n'+(data.adId?'Se creó el anuncio RSA con '+((googleWizardData.headlines||[]).filter(function(h){return h&&h.trim();}).length)+' headlines y '+((googleWizardData.descriptions||[]).filter(function(d){return d&&d.trim();}).length)+' descriptions.\n\n':'')+'Actívala en Google Ads Manager cuando quieras. ¿Necesitas ajustar pujas, agregar más keywords o revisar la estructura antes de activarla?');

  } catch(err) {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Crear campaña'; }
    if (msg) msg.textContent = '⚠️ ' + err.message;
  }
}

// =============================================
// VARIACIONES A/B — Flujo Manus-style
// Sube anuncio → Claude analiza → genera N variaciones en paralelo → grid display
// =============================================

var _abImageData = null;
var _abVarCount = 2;
var _AB_LABELS = ['A','B','C','D'];
var _AB_COLORS = ['#2563EB','#7C3AED','#059669','#D97706'];
var _AB_BG = ['#EFF6FF','#F5F3FF','#ECFDF5','#FFFBEB'];

function showAdVariationAB() {
  _abImageData = null;
  _abVarCount = 2;
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var el = document.createElement('div');
  el.className = 'msg';
  el.id = 'ab-variation-card';
  el.innerHTML =
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg + '</div>' +
    '<div style="max-width:480px;width:100%">' +
      '<div style="background:#F9FAFB;border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
        '<h4 style="margin:0 0 4px;font-size:14px;font-weight:700;color:var(--text)">🔄 Variaciones de tu anuncio</h4>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">Sube tu anuncio actual. Claude genera <strong>variaciones donde el producto sigue siendo el protagonista</strong> — mismo mensaje de campaña, diferente tratamiento visual.</div>' +

        '<div id="ab-upload-zone" style="border:2px dashed var(--border2);border-radius:10px;padding:24px 16px;text-align:center;cursor:pointer;transition:all .15s;background:white" onclick="document.getElementById(\'ab-file-input\').click()" ondragover="event.preventDefault();this.style.borderColor=\'var(--blue)\';this.style.background=\'var(--blue-lt)\'" ondragleave="this.style.borderColor=\'var(--border2)\';this.style.background=\'white\'" ondrop="handleABDrop(event)">' +
          '<div id="ab-upload-placeholder">' +
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px;display:block"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
            '<div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:3px">Sube tu anuncio actual</div>' +
            '<div style="font-size:11px;color:var(--muted2)">JPG, PNG o WebP · máx 8 MB</div>' +
          '</div>' +
          '<img id="ab-preview" style="display:none;max-height:160px;max-width:100%;border-radius:8px;object-fit:contain" src="" alt="preview"/>' +
          '<input type="file" id="ab-file-input" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleABFile(this.files[0])">' +
        '</div>' +

        '<div id="ab-generate-wrap" style="display:none;margin-top:14px">' +

          // Campo de contexto adicional
          '<div style="margin-bottom:12px">' +
            '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Contexto adicional <span style="font-weight:400;text-transform:none;letter-spacing:0">(opcional)</span></div>' +
            '<textarea id="ab-context-input" placeholder="Ej: Camiseta blanca premium. Quiero que el producto sea el foco principal. La campaña es Black Friday 50% off." style="width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;color:var(--text);font-family:var(--font);resize:none;height:64px;line-height:1.5;background:white" oninput="this.style.height=\'auto\';this.style.height=Math.min(this.scrollHeight,100)+\'px\'"></textarea>' +
          '</div>' +

          '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">¿Cuántas variaciones?</div>' +
          '<div style="display:flex;gap:6px;margin-bottom:12px">' +
            [2,3,4].map(function(n){
              return '<div id="ab-chip-' + n + '" onclick="selectABCount(' + n + ')" style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;border:1.5px solid ' + (n===2?'#059669':'var(--border)') + ';background:' + (n===2?'#ECFDF5':'white') + ';color:' + (n===2?'#065F46':'var(--muted)') + ';transition:all .15s">' + n + '</div>';
            }).join('') +
          '</div>' +
          '<button id="ab-generate-btn" onclick="startABVariation()" style="width:100%;padding:12px;background:#059669;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">🔬 Analizar y generar variaciones</button>' +
        '</div>' +

      '</div>' +
    '</div>';
  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function selectABCount(n) {
  _abVarCount = n;
  [2,3,4].forEach(function(i) {
    var chip = document.getElementById('ab-chip-' + i);
    if (!chip) return;
    var sel = (i === n);
    chip.style.borderColor = sel ? '#059669' : 'var(--border)';
    chip.style.background = sel ? '#ECFDF5' : 'white';
    chip.style.color = sel ? '#065F46' : 'var(--muted)';
  });
}

function handleABDrop(event) {
  event.preventDefault();
  var zone = document.getElementById('ab-upload-zone');
  if (zone) { zone.style.borderColor = 'var(--border2)'; zone.style.background = 'white'; }
  var file = event.dataTransfer.files[0];
  if (file) handleABFile(file);
}

function handleABFile(file) {
  if (!file || !file.type.startsWith('image/')) { addAgent('Por favor sube una imagen en formato JPG, PNG o WebP.'); return; }
  if (file.size > 8 * 1024 * 1024) { addAgent('La imagen debe ser menor a 8 MB.'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    _abImageData = e.target.result;
    var placeholder = document.getElementById('ab-upload-placeholder');
    var preview = document.getElementById('ab-preview');
    var zone = document.getElementById('ab-upload-zone');
    if (placeholder) placeholder.style.display = 'none';
    if (preview) { preview.src = e.target.result; preview.style.display = 'block'; }
    if (zone) { zone.style.borderColor = '#059669'; zone.style.borderStyle = 'solid'; }
    var wrap = document.getElementById('ab-generate-wrap');
    if (wrap) wrap.style.display = 'block';
    scrollB();
  };
  reader.readAsDataURL(file);
}

async function startABVariation() {
  if (!_abImageData) { addAgent('Primero sube tu anuncio.'); return; }
  if (!canGenerateImage()) { showImageLimitReached(); return; }

  var count = _abVarCount || 2;
  var userContext = (document.getElementById('ab-context-input') || {}).value || '';

  var btn = document.getElementById('ab-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando anuncio...'; }
  var card = document.getElementById('ab-variation-card');
  if (card) card.style.display = 'none';

  var thinkId = addThinking();
  setTimeout(function() {
    var el = document.getElementById(thinkId);
    if (el) { var txt = el.querySelector('.thinking-bbl'); if (txt) txt.innerHTML = '<div class="spinner"></div>analizando tu anuncio con Claude Vision...'; }
  }, 100);

  // Detectar formato por dimensiones
  var adFormat = 'square';
  await new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() { adFormat = (img.width / img.height < 0.85) ? 'vertical' : 'square'; resolve(); };
    img.onerror = resolve;
    img.src = _abImageData;
  });

  // Construir instrucción JSON para N variaciones — MODO KONTEXT
  // Kontext edita la imagen original con instrucciones de texto, no genera desde cero
  var varFields = _AB_LABELS.slice(0, count).map(function(lbl) {
    return '"variation_' + lbl.toLowerCase() + '":{"concept":"nombre corto descriptivo del cambio (ej: Fondo oscuro dramático / Ambiente exterior soleado)","instruction":"instruccion de edicion en ingles ~40 palabras: empieza con KEEP o PRESERVE para lo que NO debe cambiar, luego CHANGE/REPLACE para lo que si cambia. Solo cambiar 1-2 elementos por variacion."}';
  }).join(',');
  var jsonInstruction = '{"ad_description":"descripcion breve del anuncio original en 1 linea","campaign_message":"mensaje o promocion central detectada",' + varFields + '}';

  var contextLine = userContext ? '\n\nCONTEXTO ADICIONAL DEL USUARIO: ' + userContext : '';

  var analysisResult = null;
  try {
    var mediaType = _abImageData.split(';')[0].split(':')[1];
    var b64 = _abImageData.split(',')[1];
    var fullText = await fetchChatFull({
      model: 'claude-sonnet-4-6',
      max_tokens: 150 + count * 200,
      system: 'Eres experto en edicion de imagenes publicitarias con IA. Generas instrucciones de edicion para Flux Kontext, un modelo que EDITA una imagen existente siguiendo instrucciones de texto precisas. Las instrucciones deben decir EXACTAMENTE que conservar y que cambiar. Responde SOLO con JSON valido, sin markdown, sin backticks.',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
        { type: 'text', text: 'Analiza este anuncio. El modelo de IA recibira ESTA MISMA IMAGEN y aplicara los cambios que le indiques. Genera ' + count + ' instrucciones de edicion distintas para A/B testing.' + contextLine + '\n\nREGLAS PARA LAS INSTRUCCIONES:\n1. Siempre empezar con "Keep [producto/sujeto principal] exactly as is." — NO cambiar el producto\n2. Luego indicar exactamente QUE cambiar: el fondo, la iluminacion, el color dominante, o el ambiente\n3. Cada variacion debe cambiar algo DIFERENTE a las demas\n4. Las instrucciones deben ser concisas y muy especificas — el modelo las aplica literalmente\n5. Ejemplos de buenas instrucciones: "Keep the white t-shirt exactly as is. Replace the background with a dark dramatic studio backdrop with rim lighting." / "Keep the product unchanged. Change the background to a bright outdoor sunny park setting with green bokeh."\n\nResponde SOLO con este JSON:\n' + jsonInstruction }
      ]}]
    });
    var clean = fullText.replace(/```json|```/g, '').trim();
    var bi = clean.indexOf('{'); if (bi > 0) clean = clean.slice(bi);
    analysisResult = JSON.parse(clean);
  } catch(e) {
    console.error('[AB] Error analizando anuncio:', e.message);
  }

  rmThinking(thinkId);

  if (!analysisResult) {
    addAgent('No pude analizar el anuncio. Por favor intenta con otra imagen.');
    return;
  }

  var fmt = adFormat;
  var variations = _AB_LABELS.slice(0, count).map(function(lbl) {
    var v = analysisResult['variation_' + lbl.toLowerCase()];
    return v || { concept: 'Variacion ' + lbl, instruction: 'Keep the main subject exactly as is. Change the background lighting and mood.' };
  });

  var conceptList = variations.map(function(v, i) { return '**' + _AB_LABELS[i] + '**: ' + v.concept; }).join(' · ');
  addAgent('Anuncio analizado. Editando imagen con Flux Kontext — ' + conceptList + '...');

  var thinkId2 = addThinking();
  setTimeout(function() {
    var el = document.getElementById(thinkId2);
    if (el) { var txt = el.querySelector('.thinking-bbl'); if (txt) txt.innerHTML = '<div class="spinner"></div>aplicando variaciones con Flux Kontext...'; }
  }, 100);

  var headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;

  try {
    // Usar modo kontext: envía la imagen original + instrucción de edición
    // Flux Kontext edita la imagen manteniendo lo que se indica y cambiando solo lo especificado
    var fetchPromises = variations.map(function(v) {
      return fetch('/api/generate-image', {
        method: 'POST', headers: headers,
        body: JSON.stringify({
          mode: 'kontext',
          referenceImage: _abImageData,   // imagen original completa en base64
          prompt: v.instruction,           // instrucción de edición (qué cambiar)
          format: fmt,
        })
      }).then(function(r){ return r.json(); });
    });
    var results = await Promise.all(fetchPromises);
    rmThinking(thinkId2);

    var images = results.map(function(r) { return (r.images && r.images.length) ? r.images[0] : null; });
    var anyOk = images.some(function(img) { return img !== null; });
    if (!anyOk) {
      var firstErr = results.map(function(r){ return r.error; }).filter(Boolean)[0] || 'Sin respuesta del servidor';
      addAgent('Error al generar variaciones: ' + firstErr);
      return;
    }

    images.forEach(function(img) { if (img) incrementImageUsage(); });

    renderVariationsGrid(images, variations.map(function(v){ return v.concept; }), fmt, analysisResult.ad_description || '', analysisResult.campaign_message || '');

  } catch(err) {
    rmThinking(thinkId2);
    addAgent('Error generando variaciones: ' + err.message);
  }
}

function renderVariationsGrid(images, concepts, format, adDesc, campaignMsg) {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';
  var count = images.length;
  var ratio = format === 'vertical' ? '4/5' : '1/1';
  var maxH = format === 'vertical' ? '240px' : '200px';
  // 2 imágenes: side by side; 3-4: grid 2 columnas
  var gridCols = count === 2 ? '1fr 1fr' : '1fr 1fr';

  function imgBlock(img, idx) {
    var label = _AB_LABELS[idx];
    var labelColor = _AB_COLORS[idx] || '#2563EB';
    var labelBg = _AB_BG[idx] || '#EFF6FF';
    var concept = (concepts[idx] || 'Variación ' + label).replace(/</g,'&lt;');
    var b64 = img ? img.base64 : null;
    var mt = img ? img.mediaType : 'image/jpeg';
    var dlOnClick = b64 ? 'downloadAdImage(\'' + b64 + '\',\'' + mt + '\',\'variacion_' + label.toLowerCase() + '_' + format + '.png\')' : '';
    var lbOnClick = b64 ? 'openAdLightbox(\'' + b64 + '\',\'' + mt + '\',\'Variaci\\u00f3n ' + label + '\')' : '';

    return '<div style="display:flex;flex-direction:column;gap:7px;min-width:0">' +
      '<div style="display:flex;align-items:center;gap:6px">' +
        '<div style="background:' + labelBg + ';color:' + labelColor + ';font-size:11px;font-weight:800;padding:2px 9px;border-radius:100px">Var. ' + label + '</div>' +
      '</div>' +
      '<div style="font-size:11px;font-weight:600;color:var(--text);line-height:1.3">' + concept + '</div>' +
      (b64
        ? '<div style="cursor:zoom-in;border-radius:9px;overflow:hidden;aspect-ratio:' + ratio + ';max-height:' + maxH + ';background:#F3F4F6" onclick="' + lbOnClick + '">' +
            '<img src="data:' + mt + ';base64,' + b64 + '" style="width:100%;height:100%;object-fit:cover" alt="Variacion ' + label + '">' +
          '</div>'
        : '<div style="border-radius:9px;background:#FEF2F2;border:1px solid #FCA5A5;aspect-ratio:' + ratio + ';max-height:' + maxH + ';display:flex;align-items:center;justify-content:center;font-size:11px;color:#EF4444;text-align:center;padding:12px">Error al generar</div>'
      ) +
      '<div style="display:flex;gap:5px">' +
        (b64
          ? '<button onclick="' + dlOnClick + '" style="flex:1;padding:6px 0;background:white;border:1px solid var(--border);border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;color:var(--text);font-family:var(--font);display:flex;align-items:center;justify-content:center;gap:3px"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Descargar</button>'
          : ''
        ) +
        '<button onclick="qSend(\'Quiero publicar la Variacion ' + label + ' en Meta Ads. Ayudame a crear la campana.\')" style="flex:1;padding:6px 0;background:' + labelColor + ';color:white;border:none;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;font-family:var(--font)">Lanzar →</button>' +
      '</div>' +
    '</div>';
  }

  var concatConcepts = concepts.map(function(c,i){ return _AB_LABELS[i] + ': ' + c.replace(/'/g,''); }).join('. ');

  var el = document.createElement('div');
  el.className = 'msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';
  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text)">' + count + ' variaciones listas para test en Meta</div>' +
        (campaignMsg
          ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">Campaña: ' + campaignMsg.replace(/</g,'&lt;').slice(0,100) + '</div>'
          : (adDesc ? '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + adDesc.replace(/</g,'&lt;').slice(0,100) + '</div>' : '')
        ) +
      '</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:' + gridCols + ';gap:12px;width:100%;max-width:600px;padding-left:40px">' +
      images.map(function(img, i){ return imgBlock(img, i); }).join('') +
    '</div>' +
    '<div style="padding-left:40px;margin-top:12px">' +
      '<button onclick="qSend(\'Tengo ' + count + ' variaciones listas para test A/B. ' + concatConcepts + '. Como estructuro el test A/B en Meta Ads: presupuesto, duracion, metrica de exito y como interpretar los resultados?\')" style="background:none;border:1.5px solid #059669;color:#059669;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)">📊 Cómo estructurar el test en Meta</button>' +
    '</div>';

  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

// =============================================
// VARIACIONES DE ANUNCIO EXISTENTE (Ideogram Remix)
// =============================================

// =============================================
// VARIACIONES DE ANUNCIO — Sistema JSON prompt-based
// Descompone la imagen en componentes visuales (JSON),
// genera N versiones modificando ejes distintos por variación,
// y crea imágenes completamente nuevas (text-to-image) coherentes.
// =============================================

var variationUploadData = { imageDataUrl: null, count: 5 };

function showVariationUploader() {
  variationUploadData = { imageDataUrl: null, count: 5 };

  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';

  var el = document.createElement('div');
  el.className = 'msg';
  el.id = 'variation-uploader-card';
  el.innerHTML =
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg + '</div>' +
    '<div style="max-width:460px;width:100%">' +
      '<div style="background:#F9FAFB;border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
          '<h4 style="margin:0;font-size:14px;font-weight:700;color:var(--text)">🔄 Variaciones de tu anuncio</h4>' +
          '<div style="background:var(--blue-lt);color:var(--blue);padding:3px 8px;border-radius:12px;font-size:10px;font-weight:700">IA generativa</div>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">La IA analiza tu anuncio, lo descompone en componentes visuales y genera imágenes nuevas con variaciones reales de fondo, personaje, estilo y paleta — sin distorsionar texto.</div>' +

        '<div class="var-upload-zone" id="var-upload-zone" onclick="document.getElementById(\'var-file-input\').click()" ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ondragleave="this.classList.remove(\'drag-over\')" ondrop="handleVariationDrop(event)">' +
          '<div id="var-upload-placeholder">' +
            '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--muted2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' +
            '<div style="font-size:13px;font-weight:600;color:var(--muted);margin-bottom:3px">Sube tu anuncio</div>' +
            '<div style="font-size:11px;color:var(--muted2)">JPG, PNG o WebP · máx 8 MB</div>' +
          '</div>' +
          '<img id="var-preview" class="var-preview-img" style="display:none" src="" alt="preview"/>' +
          '<input type="file" id="var-file-input" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="handleVariationFile(this.files[0])">' +
        '</div>' +

        '<div id="var-options" style="display:none;margin-top:14px">' +
          '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px">¿Cuántas variaciones?</div>' +
          '<div style="display:flex;gap:6px;margin-bottom:16px">' +
            [3,4,5,6,8].map(function(n){
              return '<div class="var-count-chip' + (n===5?' selected':'') + '" onclick="selectVarCount(this,' + n + ')">' + n + '</div>';
            }).join('') +
          '</div>' +
          '<button onclick="startVariationGeneration()" id="var-generate-btn" style="width:100%;padding:12px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">✨ Analizar y generar variaciones</button>' +
        '</div>' +

      '</div>' +
    '</div>';

  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

function handleVariationDrop(event) {
  event.preventDefault();
  document.getElementById('var-upload-zone').classList.remove('drag-over');
  var file = event.dataTransfer.files[0];
  if (file) handleVariationFile(file);
}

function handleVariationFile(file) {
  if (!file || !file.type.startsWith('image/')) { addAgent('Por favor sube una imagen en formato JPG, PNG o WebP.'); return; }
  if (file.size > 8 * 1024 * 1024) { addAgent('La imagen debe ser menor a 8 MB.'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    variationUploadData.imageDataUrl = e.target.result;
    var zone = document.getElementById('var-upload-zone');
    var placeholder = document.getElementById('var-upload-placeholder');
    var preview = document.getElementById('var-preview');
    zone.classList.add('has-image');
    placeholder.style.display = 'none';
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('var-options').style.display = 'block';
    scrollB();
  };
  reader.readAsDataURL(file);
}

function selectVarCount(el, n) {
  variationUploadData.count = n;
  document.querySelectorAll('.var-count-chip').forEach(function(c){ c.classList.remove('selected'); });
  el.classList.add('selected');
}

// Ejes de variación: qué dimensión visual cambiar en cada variación
var VARIATION_AXES = [
  { field: 'background', values: [
    'modern minimalist studio with soft white and beige tones, clean gradient',
    'warm coffee shop interior with wooden textures and ambient golden light',
    'bright outdoor urban setting with natural daylight, city architecture in background',
    'elegant dark background with dramatic professional rim lighting',
    'lush green nature park setting with soft bokeh and dappled natural light',
    'contemporary home living room with modern furniture and warm ambient tones',
    'vibrant abstract gradient background in complementary accent colors',
    'professional office environment with glass walls and clean steel aesthetic'
  ]},
  { field: 'subject', values: [
    'young latin woman, 25-30 years old, warm genuine smile, confident relaxed posture',
    'mature latin man, 40-45 years old, professional demeanor, trustworthy friendly expression',
    'young latin man, 28-33 years old, casual energetic, approachable open smile',
    'latin couple, mid-30s, natural happy interaction, authentic connection',
    'latin woman, 35-40 years old, professional business attire, empowered poised expression',
    'diverse group of latin professionals, collaborative positive energy, teamwork',
    'latin family with child, warm authentic moment, genuine happiness',
    'latin senior woman, 55-60 years old, elegant dignified serene expression'
  ]},
  { field: 'lighting', values: [
    'soft diffused studio lighting, even flattering illumination, clean shadows',
    'warm golden hour sunlight streaming from side, cinematic and emotive quality',
    'bright clean daylight, fresh energetic feel, high key',
    'dramatic side lighting with rich shadows, premium editorial feel',
    'cool blue-toned professional lighting, modern trustworthy atmosphere'
  ]},
  { field: 'color_accent', values: [
    'warm terracotta and cream color palette',
    'refreshing teal and white color palette',
    'rich emerald green and gold color palette',
    'vibrant coral and off-white color palette',
    'deep navy blue and silver color palette',
    'soft lavender and warm white color palette'
  ]},
  { field: 'composition', values: [
    'centered subject with generous negative space, clean symmetrical framing',
    'rule of thirds, subject left-aligned, open space for text on right',
    'close-up portrait framing, emotional connection, shallow depth of field',
    'wide environmental shot, subject integrated into setting, storytelling composition',
    'dynamic diagonal composition, energetic and modern feel'
  ]}
];


// Nueva función de variaciones: Sonnet analiza → usuario confirma texto → se generan imágenes

// =============================================
// VARIACIONES CON REMIX — Flujo A/B Testing
// 1. Sonnet extrae texto
// 2. Usuario elige QUÉ variar (personaje/fondo/paleta/composición)
// 3. Ideogram Remix image_weight 0.88 — mantiene 88% de la imagen base
// 4. Canvas pinta el texto extraído encima
// =============================================

// =============================================
// VARIACIONES CON PLANTILLA CANVAS
// Flujo: Sonnet analiza diseño → plantilla Canvas fiel →
// usuario elige eje → Ideogram genera fondo → Canvas compone
// =============================================

// Helper: lee SSE de /api/chat y devuelve el texto completo
// El proxy siempre devuelve streaming — no se puede usar .json() directamente
async function fetchChatFull(payload) {
  var headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;
  var res = await fetch('/api/chat', { method: 'POST', headers: headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var reader = res.body.getReader();
  var decoder = new TextDecoder();
  var buffer = '', fullText = '', done = false;
  while (!done) {
    var chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    var lines = buffer.split('\n');
    buffer = lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line.startsWith('data: ')) continue;
      try {
        var evt = JSON.parse(line.slice(6).trim());
        if (evt.delta !== undefined) fullText += evt.delta;
        if (evt.done && evt.full !== undefined) { fullText = evt.full; done = true; }
        if (evt.error) throw new Error(evt.error);
      } catch(e) { /* continuar */ }
    }
  }
  return fullText;
}

async function startVariationGeneration() {
  var data = variationUploadData;
  if (!data.imageDataUrl) { addAgent('Primero sube tu anuncio.'); return; }

  var btn = document.getElementById('var-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando anuncio...'; }

  var thinkId = addThinking();
  setTimeout(function() {
    var el = document.getElementById(thinkId);
    if (el) { var txt = el.querySelector('.thinking-bbl'); if (txt) txt.innerHTML = '<div class="spinner"></div>analizando diseño del anuncio con Sonnet...'; }
  }, 100);

  var design = null;
  try {
    var fullText = await fetchChatFull({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: 'You are an expert at analyzing ad design and returning precise JSON. No markdown, no backticks, only valid JSON.',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: data.imageDataUrl.split(';')[0].split(':')[1], data: data.imageDataUrl.split(',')[1] } },
        { type: 'text', text: 'Analyze this ad image and return ONLY a JSON with these fields: {"format":"square or vertical","text_zone":"left or right or center","text_zone_width_pct":0.55,"overlay_color":"#000000","overlay_opacity":0.6,"headline":"exact headline text","headline_size_pct":0.07,"headline_color":"#ffffff","headline_weight":"bold","body_items":["item1","item2"],"body_size_pct":0.035,"body_color":"#ffffff","bullet_style":"dot or dash or number or none","logo":"brand name or empty","logo_position":"bottom-left or bottom-right or top-left or top-right","logo_size_pct":0.04,"logo_color":"#ffffff","bg_dark":true,"visual_style":"style in english","main_subject":"person or object description","background":"background description","color_palette":"#hex1, #hex2","lighting":"lighting description","overall_mood":"mood"}. Return ONLY valid JSON.' }
      ]}]
    });
    var clean = fullText.replace(/```json|```/g, '').trim();
    var bi = clean.indexOf('{'); if (bi > 0) clean = clean.slice(bi);
    design = JSON.parse(clean);
    console.log('[Acuarius] Design JSON OK:', JSON.stringify(design, null, 2));
  } catch(e) { console.error('[Acuarius] Error análisis:', e.message); }

  rmThinking(thinkId);

  // Detectar formato real por dimensiones
  var formatDetect = 'square';
  var tempImg = new Image();
  await new Promise(function(resolve) {
    tempImg.onload = function() { formatDetect = (tempImg.width / tempImg.height < 0.85) ? 'vertical' : 'square'; resolve(); };
    tempImg.onerror = resolve;
    tempImg.src = data.imageDataUrl;
  });

  if (!design) {
    design = {
      format: formatDetect, text_zone: 'left', text_zone_width_pct: 0.55,
      overlay_color: '#000000', overlay_opacity: 0.6,
      headline: '', headline_size_pct: 0.07, headline_color: '#ffffff', headline_weight: 'bold',
      body_items: [], body_size_pct: 0.035, body_color: '#ffffff', bullet_style: 'dot',
      logo: '', logo_position: 'bottom-left', logo_size_pct: 0.04, logo_color: '#ffffff',
      bg_dark: true, visual_style: 'professional advertising photography',
      main_subject: 'latin adult professional person', background: 'clean studio background',
      color_palette: '#1E2BCC, #ffffff', lighting: 'soft studio lighting', overall_mood: 'professional'
    };
  }
  design.format = formatDetect;

  showVariationAxisCard(design, formatDetect, variationUploadData.count);
}

// Tarjeta: elegir eje + ver texto detectado (solo lectura, editable si necesita)
function showVariationAxisCard(design, format, count) {
  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';

  var designEncoded = encodeURIComponent(JSON.stringify(design));
  var hasText = !!(design.headline || (design.body_items && design.body_items.length) || design.logo);

  var detectedHtml = '<div style="background:#F0F9FF;border:1px solid #BAE6FD;border-radius:8px;padding:12px 14px;margin-bottom:14px">' +
    '<div style="font-size:11px;font-weight:600;color:#0369A1;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Diseño detectado</div>';
  if (design.headline) detectedHtml += '<div style="font-size:12px;color:#0C4A6E;margin-bottom:4px"><strong>Título:</strong> ' + design.headline.replace(/</g,'&lt;') + '</div>';
  if (design.body_items && design.body_items.length) {
    detectedHtml += '<div style="font-size:12px;color:#0C4A6E;margin-bottom:4px"><strong>Items (' + design.body_items.length + '):</strong> ' + design.body_items.slice(0,3).map(function(i){ return i.replace(/</g,'&lt;'); }).join(', ') + (design.body_items.length > 3 ? '...' : '') + '</div>';
  }
  if (design.logo) detectedHtml += '<div style="font-size:12px;color:#0C4A6E"><strong>Marca:</strong> ' + design.logo.replace(/</g,'&lt;') + '</div>';
  if (!hasText) detectedHtml += '<div style="font-size:12px;color:#0C4A6E">No se detectó texto (se generarán variaciones solo visuales)</div>';
  detectedHtml += '</div>';

  var AXES = [
    { key:'subject',     emoji:'👤', label:'Personaje',   desc:'Cambia modelo manteniendo fondo, texto y diseño idénticos' },
    { key:'background',  emoji:'🏙️', label:'Fondo',       desc:'Cambia escenario manteniendo personaje, texto y diseño idénticos' },
    { key:'palette',     emoji:'🎨', label:'Paleta',      desc:'Varía los colores dominantes manteniendo composición y texto idénticos' },
    { key:'composition', emoji:'📐', label:'Composición', desc:'Varía encuadre y posición del sujeto manteniendo estilo y texto idénticos' },
  ];
  var axisHtml = AXES.map(function(ax) {
    return '<div id="axis-' + ax.key + '" onclick="selectAxis(\'' + ax.key + '\')" style="border:1.5px solid var(--border);border-radius:10px;padding:12px 14px;cursor:pointer;background:white;transition:all .15s" onmouseover="if(!this.classList.contains(\'ax-sel\')){this.style.borderColor=\'var(--blue-md)\';this.style.background=\'var(--blue-lt)\'}" onmouseout="if(!this.classList.contains(\'ax-sel\')){this.style.borderColor=\'var(--border)\';this.style.background=\'white\'}">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px"><span style="font-size:16px">' + ax.emoji + '</span><span style="font-size:13px;font-weight:700;color:var(--text)">' + ax.label + '</span></div>' +
      '<div style="font-size:11px;color:var(--muted);line-height:1.4">' + ax.desc + '</div>' +
    '</div>';
  }).join('');

  var el = document.createElement('div');
  el.className = 'msg';
  el.id = 'variation-axis-card';
  el.innerHTML =
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
    '<div style="max-width:500px;width:100%"><div style="background:#F9FAFB;border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:3px">✅ Anuncio analizado</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.5">El diseño tipográfico quedará <strong>idéntico al original</strong>. Solo elige qué elemento visual variar.</div>' +
      detectedHtml +
      '<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">¿Qué quieres variar?</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' + axisHtml + '</div>' +
      '<button id="axis-generate-btn" onclick="launchAxisVariations(\'' + designEncoded + '\',\'' + format + '\',' + count + ')" disabled style="width:100%;padding:11px;background:#9CA3AF;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:not-allowed;font-family:var(--font)">Selecciona qué variar ↑</button>' +
    '</div></div>';

  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

var selectedAxis = null;
function selectAxis(key) {
  selectedAxis = key;
  var labels = { subject:'Personaje', background:'Fondo', palette:'Paleta', composition:'Composición' };
  document.querySelectorAll('[id^="axis-"]').forEach(function(el) {
    if (!el.id.includes('generate') && !el.id.includes('card')) {
      var isSelected = el.id === 'axis-' + key;
      el.style.borderColor = isSelected ? 'var(--blue)' : 'var(--border)';
      el.style.background = isSelected ? 'var(--blue-lt)' : 'white';
      isSelected ? el.classList.add('ax-sel') : el.classList.remove('ax-sel');
    }
  });
  var genBtn = document.getElementById('axis-generate-btn');
  if (genBtn) {
    genBtn.disabled = false;
    genBtn.style.background = 'var(--blue)';
    genBtn.style.cursor = 'pointer';
    genBtn.textContent = '✨ Variar ' + (labels[key] || key) + ' — Generar ' + (variationUploadData.count || 3) + ' variaciones';
  }
}

async function launchAxisVariations(designEncoded, format, count) {
  var design = JSON.parse(decodeURIComponent(designEncoded));
  if (!selectedAxis) return;

  var card = document.getElementById('variation-axis-card');
  if (card) card.style.display = 'none';

  // subject/background → text-to-image + plantilla Canvas
  // palette/composition → Remix (preserva texto en imagen original)
  var useRemix = false; // Todos los ejes usan text-to-image + Canvas para evitar distorsión de texto

  var prompts = buildAxisPrompts(selectedAxis, design, count);
  addAgent('🎨 Generando **' + count + ' variaciones** variando el **' + prompts.label + '**...');

  var thinkId = addThinking();
  setTimeout(function() {
    var el = document.getElementById(thinkId);
    if (el) { var txt = el.querySelector('.thinking-bbl'); if (txt) txt.innerHTML = '<div class="spinner"></div>generando variaciones...'; }
  }, 100);

  generatedAdImages = [];
  adImgGridEl = null;
  var allImages = [];

  try {
    var imgPromises = prompts.list.map(function(p) {
      var body = { prompt: p, format: format, variations: 1, hasText: false };
      return fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'Authorization': 'Bearer ' + sessionToken } : {}) },
        body: JSON.stringify(body)
      }).then(function(r) { return r.json(); });
    });
    var results = await Promise.all(imgPromises);
    results.forEach(function(r) { if (r.images && r.images.length) allImages.push(r.images[0]); });
  } catch(err) {
    rmThinking(thinkId);
    addAgent('Error generando variaciones: ' + err.message);
    return;
  }

  rmThinking(thinkId);
  if (!allImages.length) { addAgent('No se pudieron generar las variaciones. Intenta de nuevo.'); return; }

  // Siempre text-to-image + Canvas — imagen limpia + diseño tipográfico idéntico
  for (var i = 0; i < allImages.length; i++) {
    await composeWithDesignTemplate(allImages[i], i + 1, allImages.length, format, design);
  }
}

function buildAxisPrompts(axis, design, count) {
  var baseStyle = (design.visual_style || 'professional advertising photography') + ', ' + (design.overall_mood || 'professional') + ' mood';
  var rnd = Math.floor(Math.random() * 100);

  var SUBJECTS = [
    'young latin woman 25-30, warm confident smile, professional casual attire, arms crossed, looking at camera',
    'mature latin man 42-48, trustworthy calm expression, business casual shirt, looking at camera',
    'young latin man 28-33, energetic approachable smile, modern casual open collar, looking at camera',
    'latin woman 35-40, empowered professional posture, elegant blazer, looking at camera',
    'latin senior man 55-62, experienced dignified calm expression, professional attire, looking at camera',
    'latin woman 45-50, warm approachable expression, smart casual blouse, looking at camera',
    'young latin woman 22-27, fresh enthusiastic smile, colorful casual attire, looking at camera',
    'latin man 30-36, confident modern style, casual button shirt, arms crossed, looking at camera'
  ];
  var BACKGROUNDS = [
    'modern minimalist white studio, soft clean gradient wall, professional',
    'warm coffee shop interior, wooden bokeh background, golden ambient light',
    'bright outdoor city setting, natural daylight, blurred urban architecture',
    'contemporary living room, comfortable modern home interior, warm ambient',
    'lush outdoor park, soft green nature bokeh, dappled natural sunlight',
    'elegant dark teal to black gradient, subtle professional rim light',
    'bright modern office, clean glass and white walls, airy professional',
    'outdoor rooftop urban view, city skyline bokeh background, golden hour'
  ];
  var PALETTES = [
    'shift all tones to warm terracotta and cream color palette',
    'shift all tones to cool teal and fresh white color palette',
    'shift all tones to rich navy blue and gold color palette',
    'shift all tones to vibrant coral and off-white color palette',
    'shift all tones to deep forest green and warm beige color palette',
    'shift all tones to soft lavender and clean white color palette'
  ];
  var COMPOSITIONS = [
    'reframe centered symmetrical, generous breathing room, subject prominent',
    'reframe subject left rule of thirds, open right space',
    'reframe close-up portrait tight crop, emotional shallow depth of field',
    'reframe subject right, strong open left negative space',
    'reframe environmental wide shot, subject integrated in setting',
    'reframe dynamic diagonal, energetic modern composition'
  ];

  var list = [];
  var label = '';
  for (var v = 0; v < count; v++) {
    var p = '';
    if (axis === 'subject') {
      label = 'Personaje';
      p = baseStyle + '. Person: ' + SUBJECTS[(v + rnd) % SUBJECTS.length] + '. Background: ' + (design.background || 'professional background') + '. Lighting: ' + (design.lighting || 'soft studio lighting') + '. Color palette: ' + (design.color_palette || '#1E2BCC') + '. Professional Meta Ads creative, Latin American market. NO text, NO words — clean visual only.';
    } else if (axis === 'background') {
      label = 'Fondo';
      p = baseStyle + '. Person: ' + (design.main_subject || 'latin professional person looking at camera') + '. Background: ' + BACKGROUNDS[(v + rnd) % BACKGROUNDS.length] + '. Lighting: ' + (design.lighting || 'soft studio lighting') + '. Color palette: ' + (design.color_palette || '#1E2BCC') + '. Professional Meta Ads creative, Latin American market. NO text, NO words — clean visual only.';
    } else if (axis === 'palette') {
      label = 'Paleta';
      p = PALETTES[(v + rnd) % PALETTES.length] + '. Keep all composition, people, layout and elements exactly as in the reference image. Professional Meta Ads creative.';
    } else if (axis === 'composition') {
      label = 'Composición';
      p = baseStyle + '. ' + COMPOSITIONS[(v + rnd) % COMPOSITIONS.length] + '. Keep same person, background, colors as reference image. Professional Meta Ads creative.';
    }
    list.push(p);
  }
  return { label: label, list: list };
}

// Fuentes cargadas una sola vez
var _acuariusFontsLoaded = false;
async function loadCanvasFonts() {
  if (_acuariusFontsLoaded) return;
  try {
    var fonts = [
      new FontFace('Montserrat', 'url(https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw5aXo.woff2)', { weight: '900' }),
      new FontFace('Montserrat', 'url(https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM73w5aXo.woff2)', { weight: '700' }),
      new FontFace('Montserrat', 'url(https://fonts.gstatic.com/s/montserrat/v26/JTUSjIg1_i6t8kCHKm459WlhyyTh89Y.woff2)',                  { weight: '400' }),
      new FontFace('Playfair Display', 'url(https://fonts.gstatic.com/s/playfairdisplay/v37/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvXDXbtM.woff2)', { weight: '700', style: 'italic' }),
      new FontFace('Playfair Display', 'url(https://fonts.gstatic.com/s/playfairdisplay/v37/nuFiD-vYSZviVYUb_rj3ij__anPXBYf9lW4e5j5hNKc.woff2)', { weight: '700' }),
    ];
    await Promise.all(fonts.map(f => f.load().then(lf => { document.fonts.add(lf); return lf; }).catch(() => null)));
    _acuariusFontsLoaded = true;
  } catch(e) { _acuariusFontsLoaded = true; }
}

// Canvas reconstruye el diseño tipográfico original sobre la nueva imagen base
async function composeWithDesignTemplate(imgData, index, total, format, design) {
  await loadCanvasFonts();
  return new Promise(function(resolve) {
    var canvas = document.createElement('canvas');
    var W = 1080, H = format === 'vertical' ? 1350 : 1080;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');

    // ── Layouts predefinidos por variante ────────────────────────────────────
    // Cada variante tiene un layout distinto para verse diferente
    var layouts = [
      // V1: Overlay izquierdo amplio — clásico agencia
      { zone:'left',   zonePct:0.58, overlayType:'gradient', textY:0.10, logoPos:'top-left',   ctaPos:'bottom', titleSize:0.078 },
      // V2: Overlay derecho — diferenciador visual
      { zone:'right',  zonePct:0.55, overlayType:'gradient', textY:0.12, logoPos:'top-right',  ctaPos:'bottom', titleSize:0.072 },
      // V3: Full overlay oscuro + imagen centrada — estilo editorial
      { zone:'center', zonePct:1.0,  overlayType:'full',     textY:0.55, logoPos:'top-center', ctaPos:'bottom', titleSize:0.082 },
      // V4: Bottom third — producto protagonista arriba
      { zone:'bottom', zonePct:1.0,  overlayType:'bottom',   textY:0.68, logoPos:'top-left',   ctaPos:'inline', titleSize:0.074 },
      // V5: Top third — texto arriba, producto abajo
      { zone:'top',    zonePct:1.0,  overlayType:'top',      textY:0.06, logoPos:'bottom-right',ctaPos:'inline', titleSize:0.076 },
    ];
    var lyt = layouts[(index - 1) % layouts.length];

    // ── Colores del design ───────────────────────────────────────────────────
    var overlayColor   = design.overlay_color   || '#1A0A00';
    var headlineColor  = design.headline_color  || '#FFD700';
    var bodyColor      = design.body_color      || '#FFFFFF';
    var logoColor      = design.logo_color      || '#FFD700';
    var r = parseInt(overlayColor.slice(1,3)||'00',16);
    var g = parseInt(overlayColor.slice(3,5)||'00',16);
    var b = parseInt(overlayColor.slice(5,7)||'00',16);
    var overlayOp      = design.overlay_opacity || 0.68;

    // ── Helper: rounded rect ─────────────────────────────────────────────────
    function roundRect(x, y, w, h, rad) {
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.lineTo(x + w - rad, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
      ctx.lineTo(x + w, y + h - rad);
      ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      ctx.lineTo(x + rad, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
      ctx.lineTo(x, y + rad);
      ctx.quadraticCurveTo(x, y, x + rad, y);
      ctx.closePath();
    }

    // ── Helper: word wrap centrado o izquierdo ───────────────────────────────
    function drawWrappedAdv(text, fontSize, color, weight, yPos, xPos, maxWidth, align, letterSpacing) {
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = 8; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 2;
      ctx.fillStyle = color;
      ctx.textAlign = align || 'left';

      var words = text.split(' ');
      var lines = [];
      var cur = '';
      words.forEach(function(w) {
        var test = cur ? cur + ' ' + w : w;
        // Approximate letter spacing impact
        var testW = ctx.measureText(test).width + (letterSpacing || 0) * test.length;
        if (testW > maxWidth && cur) { lines.push(cur); cur = w; }
        else cur = test;
      });
      if (cur) lines.push(cur);

      lines.forEach(function(line) {
        if (letterSpacing) {
          // Manual letter spacing
          var chars = line.split('');
          var totalW = ctx.measureText(line).width + letterSpacing * chars.length;
          var startX = align === 'center' ? xPos - totalW/2 : xPos;
          ctx.textAlign = 'left';
          chars.forEach(function(ch) {
            ctx.fillText(ch, startX, yPos);
            startX += ctx.measureText(ch).width + letterSpacing;
          });
          ctx.textAlign = align || 'left';
        } else {
          ctx.fillText(line, xPos, yPos);
        }
        yPos += Math.round(fontSize * 1.22);
      });
      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.textAlign = 'left';
      return yPos;
    }

    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      try {
        // ── 1. Imagen base (object-cover: escalar y centrar) ─────────────────
        var iW = img.naturalWidth || img.width;
        var iH = img.naturalHeight || img.height;
        var scale = Math.max(W / iW, H / iH);
        var dW = iW * scale, dH = iH * scale;
        var dX = (W - dW) / 2, dY = (H - dH) / 2;
        ctx.drawImage(img, dX, dY, dW, dH);

        var margin = Math.round(W * 0.052);

        // ── 2. Overlay según layout ──────────────────────────────────────────
        if (lyt.overlayType === 'gradient') {
          var isLeft = lyt.zone === 'left';
          var zW = Math.round(W * lyt.zonePct);
          var zX = isLeft ? 0 : W - zW;
          var grad = ctx.createLinearGradient(
            isLeft ? 0 : zX + zW, 0,
            isLeft ? zX + zW : zX, 0
          );
          grad.addColorStop(0,    'rgba('+r+','+g+','+b+','+(overlayOp)+')');
          grad.addColorStop(0.7,  'rgba('+r+','+g+','+b+','+(overlayOp*0.9)+')');
          grad.addColorStop(1,    'rgba('+r+','+g+','+b+',0)');
          ctx.fillStyle = grad;
          ctx.fillRect(isLeft ? 0 : zX, 0, zW + Math.round(W*0.07), H);

        } else if (lyt.overlayType === 'full') {
          // Full overlay más claro para dejar ver el producto
          var gFull = ctx.createRadialGradient(W/2, H/2, H*0.1, W/2, H/2, H*0.7);
          gFull.addColorStop(0, 'rgba('+r+','+g+','+b+',0.35)');
          gFull.addColorStop(1, 'rgba('+r+','+g+','+b+',0.80)');
          ctx.fillStyle = gFull;
          ctx.fillRect(0, 0, W, H);

        } else if (lyt.overlayType === 'bottom') {
          // Gradiente de abajo hacia arriba — producto protagonista
          var gBot = ctx.createLinearGradient(0, H*0.45, 0, H);
          gBot.addColorStop(0, 'rgba('+r+','+g+','+b+',0)');
          gBot.addColorStop(0.35, 'rgba('+r+','+g+','+b+',0.72)');
          gBot.addColorStop(1,  'rgba('+r+','+g+','+b+',0.92)');
          ctx.fillStyle = gBot;
          ctx.fillRect(0, 0, W, H);

        } else if (lyt.overlayType === 'top') {
          // Gradiente de arriba hacia abajo
          var gTop = ctx.createLinearGradient(0, 0, 0, H*0.55);
          gTop.addColorStop(0,   'rgba('+r+','+g+','+b+',0.88)');
          gTop.addColorStop(0.6, 'rgba('+r+','+g+','+b+',0.60)');
          gTop.addColorStop(1,   'rgba('+r+','+g+','+b+',0)');
          ctx.fillStyle = gTop;
          ctx.fillRect(0, 0, W, H);
        }

        // ── 3. Calcular zona de texto ────────────────────────────────────────
        var textX, textMaxW, textAlign;
        if (lyt.zone === 'left') {
          textX = margin; textMaxW = Math.round(W * lyt.zonePct) - margin * 2; textAlign = 'left';
        } else if (lyt.zone === 'right') {
          var zWr = Math.round(W * lyt.zonePct);
          textX = W - zWr + margin; textMaxW = zWr - margin * 2; textAlign = 'left';
        } else {
          textX = W / 2; textMaxW = W - margin * 4; textAlign = 'center';
        }

        var y = Math.round(H * lyt.textY);
        var titleFontSize = Math.round(W * lyt.titleSize);

        // ── 4. LOGO (pill con fondo semitransparente) ────────────────────────
        if (design.logo) {
          var lSize = Math.round(W * 0.034);
          ctx.font = '700 ' + lSize + 'px "Montserrat", Arial, sans-serif';
          ctx.shadowBlur = 0;
          var logoText = design.logo.toUpperCase();
          var logoW = ctx.measureText(logoText).width;
          var padX = Math.round(lSize * 0.6), padY = Math.round(lSize * 0.4);
          var pillW = logoW + padX * 2, pillH = lSize + padY * 2;

          var lpX, lpY;
          if (lyt.logoPos === 'top-left')    { lpX = margin; lpY = Math.round(H * 0.05); }
          else if (lyt.logoPos === 'top-right')  { lpX = W - margin - pillW; lpY = Math.round(H * 0.05); }
          else if (lyt.logoPos === 'top-center') { lpX = (W - pillW)/2; lpY = Math.round(H * 0.05); }
          else if (lyt.logoPos.includes('bottom')){ lpX = lyt.logoPos.includes('right') ? W - margin - pillW : margin; lpY = H - Math.round(H * 0.08); }
          else { lpX = margin; lpY = Math.round(H * 0.05); }

          // Pill background
          ctx.fillStyle = 'rgba('+r+','+g+','+b+',0.55)';
          roundRect(lpX, lpY - pillH + padY, pillW, pillH, pillH/2);
          ctx.fill();

          // Logo text
          ctx.fillStyle = logoColor;
          ctx.textAlign = 'left';
          ctx.fillText(logoText, lpX + padX, lpY + padY * 0.4);
          ctx.textAlign = 'left';
        }

        // ── 5. Línea decorativa (acento de color) ────────────────────────────
        // Solo dibujar si el logo NO está en la misma zona que el texto
        var logoZone = lyt.logoPos.includes('top') ? 'top' : 'bottom';
        var textZone = (lyt.textY < 0.35) ? 'top' : 'bottom';
        var drawAccent = (logoZone !== textZone) || lyt.zone === 'center';
        if (drawAccent && lyt.zone !== 'center') {
          // Línea siempre debajo del margen del logo, antes del headline
          var lineY2 = y;
          var lineLen = Math.round(textMaxW * 0.28);
          ctx.fillStyle = headlineColor;
          ctx.fillRect(textX, lineY2, lineLen, Math.round(W * 0.007));
          y = lineY2 + Math.round(titleFontSize * 0.7);
        }

        // ── 6. HEADLINE con tipografía variable por variante ─────────────────
        var hlStyles = [
          { font:'Montserrat',       weight:'900', letterSpacing: 0,  italic: false },  // V1: Black sans
          { font:'Playfair Display', weight:'700', letterSpacing: 0,  italic: true  },  // V2: Serif italic elegante
          { font:'Montserrat',       weight:'700', letterSpacing: 2,  italic: false },  // V3: Bold spaced
          { font:'Playfair Display', weight:'700', letterSpacing: 0,  italic: false },  // V4: Serif bold
          { font:'Montserrat',       weight:'900', letterSpacing:-1,  italic: false },  // V5: Black condensed
        ];
        var hlStyle = hlStyles[(index-1) % hlStyles.length];
        var italic = hlStyle.italic ? 'italic ' : '';
        ctx.font = italic + hlStyle.weight + ' ' + titleFontSize + 'px "' + hlStyle.font + '", Arial, sans-serif';
        ctx.fillStyle = headlineColor;
        if (design.headline) {
          y = drawWrappedAdv(design.headline, titleFontSize, headlineColor,
              hlStyle.weight, y, textX, textMaxW, textAlign, hlStyle.letterSpacing);
          y += Math.round(titleFontSize * 0.3);
        }

        // ── 7. Separador sutil ───────────────────────────────────────────────
        var sepAlpha = 0.45;
        ctx.fillStyle = 'rgba(255,255,255,' + sepAlpha + ')';
        if (textAlign === 'center') {
          ctx.fillRect(textX - 60, y, 120, 2);
        } else {
          ctx.fillRect(textX, y, Math.round(textMaxW * 0.4), 2);
        }
        y += Math.round(titleFontSize * 0.55);

        // ── 8. BODY ITEMS ────────────────────────────────────────────────────
        if (design.body_items && design.body_items.length) {
          var bSize = Math.round(titleFontSize * 0.44);
          ctx.font = '400 ' + bSize + 'px "Montserrat", Arial, sans-serif';
          design.body_items.slice(0,3).forEach(function(item) {
            var line = (design.bullet_style === 'none' ? '' : '• ') + item;
            y = drawWrappedAdv(line, bSize, bodyColor, '400', y, textX, textMaxW, textAlign, 0);
            y += Math.round(bSize * 0.2);
          });
          y += Math.round(bSize * 0.5);
        }

        // ── 9. CTA (botón pill) ──────────────────────────────────────────────
        var ctaText = 'Ver oferta →';
        var ctaSize = Math.round(W * 0.032);
        ctx.font = '700 ' + ctaSize + 'px "Montserrat", Arial, sans-serif';
        var ctaW = ctx.measureText(ctaText).width + ctaSize * 2.2;
        var ctaH = ctaSize * 2.1;
        var ctaX, ctaY;

        if (lyt.ctaPos === 'inline') {
          ctaX = textAlign === 'center' ? (W - ctaW)/2 : textX;
          ctaY = y + Math.round(ctaSize * 0.2);
        } else {
          // bottom fijo
          ctaX = textAlign === 'center' ? (W - ctaW)/2 : textX;
          ctaY = H - Math.round(H * 0.10);
        }

        // Fondo del botón
        ctx.fillStyle = headlineColor;
        ctx.shadowBlur = 12; ctx.shadowColor = 'rgba(0,0,0,0.4)';
        roundRect(ctaX, ctaY, ctaW, ctaH, ctaH/2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Texto del botón
        ctx.fillStyle = overlayColor;
        ctx.font = '700 ' + ctaSize + 'px "Montserrat", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ctaText, ctaX + ctaW/2, ctaY + ctaH*0.67);
        ctx.textAlign = 'left';

        // ── 10. Render final ─────────────────────────────────────────────────
        var b64 = canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
        renderAdImage({ base64: b64, mediaType: 'image/jpeg' }, index, total, format, 'diseño', false);
      } catch(err) {
        console.error('[Acuarius] Canvas error:', err);
        renderAdImage(imgData, index, total, format, 'diseño', false);
      }
      resolve();
    };
    img.onerror = function() { renderAdImage(imgData, index, total, format, 'diseño', false); resolve(); };
    img.src = 'data:' + imgData.mediaType + ';base64,' + imgData.base64;
  });
}

// Sistema de cuestionario de diseño
var designQData = {};

// ─────────────────────────────────────────────────────────────────────────────
// MÓDULO DE CREACIÓN DE IMÁGENES — Director Creativo IA
// Flujo: Brief (2 preguntas) → Claude genera 5 conceptos → usuario aprueba → Ideogram
// ─────────────────────────────────────────────────────────────────────────────

function showDesignQuestionnaire() {
  loadImageUsage();
  if (!canGenerateImage()) { showImageLimitReached(); return; }

  // Pre-cargar datos del cliente activo si existe
  var activeClient = null;
  if (agencyActiveClientId) {
    activeClient = agencyClients.find(c => c.id === agencyActiveClientId) || null;
  }
  if (activeClient) {
    designQData.brand        = activeClient.name        || '';
    designQData.colors       = activeClient.colores     || '';
    designQData.estiloVisual = activeClient.estiloVisual|| '';
    designQData.productos    = activeClient.productos   || '';
    designQData.industria    = activeClient.industria   || activeClient.descripcion || '';
    designQData.audiencia    = activeClient.audiencia   || '';
    designQData.diferenciador= activeClient.diferenciador || '';
    designQData.tono         = activeClient.tono        || '';
    designQData.propuesta    = activeClient.propuesta   || '';
    designQData.tipoOferta   = activeClient.tipoOferta  || '';
    designQData.descripcion  = activeClient.descripcion || '';
    designQData.fromBrief    = true;
  } else {
    designQData = {};
  }

  const isAdmin   = isAdminUser();
  const isLimited = userPlan !== 'pro' && !isAdmin;
  const remaining = isLimited ? (imageUsage.limit - imageUsage.generated) : '∞';

  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.52 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';

  var el = document.createElement('div');
  el.className = 'msg';
  el.id = 'design-questionnaire-msg';

  if (isLimited) {
    el.innerHTML =
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg + '</div>' +
      '<div style="max-width:420px">' +
        '<div style="background:#F9FAFB;border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
            '<h4 style="margin:0;font-size:14px;font-weight:700;color:var(--text)">🔒 Diseño básico</h4>' +
            '<div style="background:#FEE2E2;color:#DC2626;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600">Restantes: ' + remaining + '</div>' +
          '</div>' +
          '<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:12px;margin-bottom:14px">' +
            '<div style="font-size:12px;font-weight:600;color:#92400E;margin-bottom:4px">⚠️ Modo básico activo</div>' +
            '<div style="font-size:11px;color:#92400E">Se generará 1 imagen con diseño estándar. Para diseño profesional con director creativo IA, actualiza a Pro.</div>' +
          '</div>' +
          '<button onclick="generateBasicImage()" style="width:100%;padding:12px;background:#F59E0B;color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">Generar imagen básica</button>' +
          '<div style="text-align:center;margin-top:10px">' +
            '<button onclick="window.open(\'/pricing.html\',\'_blank\')" style="padding:6px 12px;background:none;color:var(--blue);border:1px solid var(--blue);border-radius:6px;font-size:11px;cursor:pointer;font-family:var(--font)">🚀 Actualizar a Pro</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.getElementById('chat-area').appendChild(el);
    scrollB();
    return;
  }

  // ── Modo Pro/Admin: brief simplificado ──────────────────────────────────────
  var briefBadge = activeClient
    ? '<div style="display:inline-flex;align-items:center;gap:5px;background:#ECFDF5;border:1px solid #6EE7B7;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:600;color:#059669;margin-bottom:10px">' +
      '<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="#10B981"/></svg>' +
      'Cliente: ' + activeClient.name + '</div><br>'
    : '';

  var step1Html = activeClient
    ? '' // Si hay cliente, saltamos el paso de nombre — ya está en designQData.brand
    : '<div id="dq-step-brand" class="dq-step">' +
        '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:8px">¿Cuál es el nombre de tu marca?</div>' +
        '<input type="text" id="dq-brand" placeholder="Ej: Iluminata, Clínica Sorelle" style="width:100%;padding:10px;border:1px solid #E0E0E0;border-radius:8px;font-size:13px;font-family:var(--font);box-sizing:border-box">' +
        '<button onclick="dqStepBrandNext()" style="margin-top:10px;padding:8px 18px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">Siguiente →</button>' +
      '</div>';

  el.innerHTML =
    '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0">' + logoSvg + '</div>' +
    '<div style="max-width:460px">' +
      '<div style="background:#F9FAFB;border:1px solid var(--border);border-radius:12px;padding:18px 20px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
          '<h4 style="margin:0;font-size:14px;font-weight:700;color:var(--text)">🎬 Director Creativo IA' + (isAdmin ? ' <span style=\'font-size:10px;background:#10B981;color:white;padding:2px 7px;border-radius:10px\'>ADMIN</span>' : '') + '</h4>' +
        '</div>' +
        briefBadge +

        // Paso: oferta/campaña
        '<div id="dq-step-offer" class="dq-step"' + (activeClient ? '' : ' style="display:none"') + '>' +
          '<div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px">¿Qué quieres promocionar?</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Sé específico: oferta, producto, ocasión, descuento, lanzamiento...</div>' +
          '<textarea id="dq-offer" rows="2" placeholder="Ej: 20% de descuento en velas aromáticas este fin de semana · Lanzamiento set regalo navideño · Envío gratis en pedidos +$50" style="width:100%;padding:10px;border:1px solid #E0E0E0;border-radius:8px;font-size:13px;font-family:var(--font);resize:none;box-sizing:border-box;line-height:1.4"></textarea>' +

          '<div style="margin-top:12px">' +
            '<div style="font-size:11px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Formato</div>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
              '<button onclick="dqSelectFormat(this,\'vertical\')" class="dq-fmt-btn" style="padding:7px 14px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text)">Feed vertical<br><span style="font-size:10px;font-weight:400;color:var(--muted)">1080×1350</span></button>' +
              '<button onclick="dqSelectFormat(this,\'square\')" class="dq-fmt-btn" style="padding:7px 14px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text)">Cuadrado<br><span style="font-size:10px;font-weight:400;color:var(--muted)">1080×1080</span></button>' +
              '<button onclick="dqSelectFormat(this,\'story\')" class="dq-fmt-btn" style="padding:7px 14px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text)">Stories<br><span style="font-size:10px;font-weight:400;color:var(--muted)">1080×1920</span></button>' +
            '</div>' +
          '</div>' +

          '<div style="margin-top:14px">' +
            // ── Tipo de negocio — ramifica la sección visual ──────────────────
            '<div style="font-size:11px;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">¿Qué tipo de negocio es?</div>' +
            '<div style="display:flex;gap:8px;margin-bottom:12px">' +
              '<button onclick="dqSelectTipoNegocio(this,\'producto\')" class="dq-tipo-btn" id="dq-tipo-producto" style="flex:1;padding:10px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text);text-align:center">🛍️ Producto<br><span style="font-size:10px;font-weight:400;color:var(--muted)">tiene objeto físico</span></button>' +
              '<button onclick="dqSelectTipoNegocio(this,\'servicio\')" class="dq-tipo-btn" id="dq-tipo-servicio" style="flex:1;padding:10px 8px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text);text-align:center">🛠️ Servicio<br><span style="font-size:10px;font-weight:400;color:var(--muted)">vende experiencia o trabajo</span></button>' +
            '</div>' +

            // ── Sección producto: subir foto ──────────────────────────────────
            '<div id="dq-seccion-producto" style="display:none">' +
              '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Sube la foto de tu producto — el resultado será mucho más fiel a tu marca.</div>' +
              '<div id="dq-product-preview" style="display:none;margin-bottom:8px">' +
                '<div style="position:relative;display:inline-block">' +
                  '<img id="dq-product-img-preview" style="height:70px;border-radius:8px;border:1px solid var(--border);object-fit:cover"/>' +
                  '<button onclick="dqRemoveProductImg()" style="position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:#EF4444;color:white;border:none;font-size:10px;cursor:pointer;font-weight:700;line-height:1">×</button>' +
                '</div>' +
              '</div>' +
              '<input type="file" id="dq-product-file" accept="image/*" style="display:none" onchange="dqHandleProductImg(this)">' +
              '<button onclick="document.getElementById(\'dq-product-file\').click()" style="padding:8px 14px;border:1.5px dashed var(--blue-md);border-radius:8px;font-size:11px;font-weight:600;color:var(--blue);background:var(--blue-lt);cursor:pointer;font-family:var(--font)">📷 Subir foto del producto</button>' +
              '<div style="margin-top:8px;font-size:10px;color:var(--muted2)">Sin foto: la IA generará escenas del producto. Con foto: usará tu imagen real.</div>' +
            '</div>' +

            // ── Sección servicio: elegir enfoque visual ───────────────────────
            '<div id="dq-seccion-servicio" style="display:none">' +
              '<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Para servicios el visual se construye desde una situación. ¿Qué quieres transmitir?</div>' +
              '<div style="display:flex;flex-direction:column;gap:6px">' +
                '<button onclick="dqSelectEnfoqueServicio(this,\'resultado\')" class="dq-enfoque-btn" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text);text-align:left">✨ Resultado / transformación<br><span style="font-size:10px;font-weight:400;color:var(--muted)">Cliente antes vs. después — el cambio que genera el servicio</span></button>' +
                '<button onclick="dqSelectEnfoqueServicio(this,\'contexto\')" class="dq-enfoque-btn" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text);text-align:left">🏢 Contexto / ambiente<br><span style="font-size:10px;font-weight:400;color:var(--muted)">El lugar y momento donde ocurre el servicio</span></button>' +
                '<button onclick="dqSelectEnfoqueServicio(this,\'confianza\')" class="dq-enfoque-btn" style="padding:9px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;background:white;cursor:pointer;font-family:var(--font);color:var(--text);text-align:left">🏆 Confianza / credencial<br><span style="font-size:10px;font-weight:400;color:var(--muted)">Profesionalismo, expertise, prueba social</span></button>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<button onclick="dqLaunchCreativeConcepts()" id="dq-generate-concepts-btn" style="margin-top:16px;width:100%;padding:12px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:var(--font)">✨ Crear 5 conceptos creativos</button>' +
        '</div>' +

        step1Html +
      '</div>' +
    '</div>';

  document.getElementById('chat-area').appendChild(el);
  scrollB();

  // ── Auto-seleccionar tipo de negocio si viene del brief ──────────────────
  if (activeClient && designQData.tipoOferta) {
    var tipoOferta = designQData.tipoOferta.toLowerCase();
    var tipoAuto = tipoOferta.includes('producto') || tipoOferta.includes('e-commerce') || tipoOferta.includes('food') || tipoOferta.includes('restaurante')
      ? 'producto' : 'servicio';
    setTimeout(function() {
      var btn = document.getElementById('dq-tipo-' + tipoAuto);
      if (btn) dqSelectTipoNegocio(btn, tipoAuto);
    }, 50);
  }
}

function dqStepBrandNext() {
  var brand = (document.getElementById('dq-brand') || {}).value;
  if (!brand || !brand.trim()) return;
  designQData.brand = brand.trim();
  document.getElementById('dq-step-brand').style.display = 'none';
  document.getElementById('dq-step-offer').style.display = 'block';
}

function dqSelectFormat(btn, fmt) {
  designQData.format = fmt;
  document.querySelectorAll('.dq-fmt-btn').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background  = 'white';
    b.style.color       = 'var(--text)';
  });
  btn.style.borderColor = 'var(--blue)';
  btn.style.background  = 'var(--blue-lt)';
  btn.style.color       = 'var(--blue)';
}

function dqSelectTipoNegocio(btn, tipo) {
  designQData.tipoNegocio = tipo;
  document.querySelectorAll('.dq-tipo-btn').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background  = 'white';
    b.style.color       = 'var(--text)';
  });
  btn.style.borderColor = 'var(--blue)';
  btn.style.background  = 'var(--blue-lt)';
  btn.style.color       = 'var(--blue)';
  // Mostrar la sección correspondiente
  var secProd = document.getElementById('dq-seccion-producto');
  var secServ = document.getElementById('dq-seccion-servicio');
  if (secProd) secProd.style.display = tipo === 'producto' ? 'block' : 'none';
  if (secServ) secServ.style.display = tipo === 'servicio' ? 'block' : 'none';
  // Limpiar enfoque de servicio si cambia a producto
  if (tipo === 'producto') designQData.enfoqueServicio = null;
}

function dqSelectEnfoqueServicio(btn, enfoque) {
  designQData.enfoqueServicio = enfoque;
  document.querySelectorAll('.dq-enfoque-btn').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background  = 'white';
    b.style.color       = 'var(--text)';
  });
  btn.style.borderColor = 'var(--blue)';
  btn.style.background  = 'var(--blue-lt)';
  btn.style.color       = 'var(--blue)';
}

function dqHandleProductImg(input) {
  var file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('La imagen debe ser menor a 5MB.'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    designQData.productImageBase64     = e.target.result.split(',')[1];
    designQData.productImageMediaType  = file.type || 'image/jpeg';
    var preview    = document.getElementById('dq-product-preview');
    var previewImg = document.getElementById('dq-product-img-preview');
    if (preview && previewImg) { previewImg.src = e.target.result; preview.style.display = 'block'; }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function dqRemoveProductImg() {
  designQData.productImageBase64    = null;
  designQData.productImageMediaType = null;
  var preview = document.getElementById('dq-product-preview');
  if (preview) preview.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 2: Claude actúa como Director Creativo — genera 5 conceptos
// ─────────────────────────────────────────────────────────────────────────────

function buildEjemplosProducto(contexto) {
  return 'CADA concepto DEBE tener setting, ángulo, luz y sujeto completamente diferente.\n\nEjemplos de variedad esperada (adapta al producto real):\n- Concepto 1: macro extremo del producto con detalle de textura, fondo negro, foco de luz puntual\n- Concepto 2: flat lay cenital: producto rodeado de props relacionados sobre superficie de mármol, luz solar lateral\n- Concepto 3: manos sosteniendo el producto frente a ventana, contraluz suave\n- Concepto 4: producto en uso en su ambiente natural, persona de espaldas, luz de tarde cálida\n- Concepto 5: producto solo sobre superficie elegante, luz de estudio lateral, fondo neutro';
}

function buildEjemplosServicio(industria, enfoque) {
  var ind = (industria || '').toLowerCase();

  // Ejemplos específicos por industria y enfoque
  var eMap = {
    'consultoria': {
      resultado: 'Ej: empresario latinoamericano mirando dashboard con métricas creciendo en laptop · mujer celebrando con equipo en sala · persona caminando segura hacia cámara en traje formal · hombre en reunión con clientes satisfechos · manos apuntando a gráfica de crecimiento en whiteboard',
      contexto:  'Ej: sala de juntas moderna con luz de ventana · oficina con vista a ciudad · videoconferencia en pantalla grande · coworking moderno con personas trabajando · escritorio organizado con café y laptop',
      confianza: 'Ej: mano firme haciendo handshake de negocios · certificados enmarcados en pared de oficina profesional · equipo diverso en reunión · persona hablando en conferencia con audiencia · laptop con resultados de cliente exitoso'
    },
    'lavadoras': {
      resultado: 'Ej: ropa blanca perfectamente doblada vs. ropa sucia antes · técnico con herramientas sonriendo junto a lavadora reparada · familia celebrando lavadora funcionando · manos mostrando ropa limpia y sin manchas · lavadora brillante en cocina ordenada',
      contexto:  'Ej: técnico uniformado abriendo lavadora en hogar de familia · manos expertas ajustando componente interno · herramientas organizadas sobre piso de cocina · técnico revisando lavadora con linterna · furgoneta de servicio técnico frente a casa',
      confianza: 'Ej: técnico con uniforme y logo mostrando herramienta a cámara · certificado de garantía en mano · reseñas 5 estrellas en pantalla de celular · técnico uniformado con postura profesional · antes/después de lavadora oxidada vs. reparada'
    },
    'inglés': {
      resultado: 'Ej: persona latinoamericana en videollamada de trabajo en inglés, sonriendo confiada · estudiante recibiendo certificado · persona hablando con extranjero en aeropuerto · CV con idiomas destacados · persona presentando en inglés ante grupo internacional',
      contexto:  'Ej: estudiante con audífonos aprendiendo en laptop, ventana con luz natural · clase virtual en pantalla · persona practicando frente a espejo · app de idiomas en celular en el metro · cuaderno con notas en inglés y café',
      confianza: 'Ej: certificado de nivel B2/C1 sostenido con manos orgullosas · pantalla con calificación perfecta · antes: persona bloqueada / después: persona segura hablando · testimonio en pantalla de celular · mapa mental de vocabulario aprendido'
    }
  };

  // Encontrar la industria más cercana
  var ejemplos = null;
  if (ind.includes('consul') || ind.includes('marketing') || ind.includes('agencia')) ejemplos = eMap['consultoria'];
  else if (ind.includes('lavad') || ind.includes('técnic') || ind.includes('repair') || ind.includes('electrod')) ejemplos = eMap['lavadoras'];
  else if (ind.includes('inglés') || ind.includes('ingles') || ind.includes('idioma') || ind.includes('curso') || ind.includes('educ')) ejemplos = eMap['inglés'];

  if (ejemplos && ejemplos[enfoque]) {
    return 'CADA concepto DEBE mostrar una SITUACIÓN HUMANA diferente — no imágenes abstractas ni corporativas genéricas.\n\nEjemplos para este tipo de servicio con enfoque "' + enfoque + '":\n' + ejemplos[enfoque] + '\n\nVARÍA radicalmente: setting (interior/exterior/urbano/hogar), ángulo (frontal/lateral/contrapicado/cenital), luz (natural/artificial/cálida/fría), y la emoción del sujeto.';
  }

  // Fallback genérico para servicios
  var focusMap = {
    resultado: 'CADA concepto muestra el CAMBIO que genera el servicio: persona antes (frustrada, bloqueada, con problema) vs. persona después (segura, exitosa, satisfecha). Usa situaciones cotidianas reconocibles para latinoamericanos.',
    contexto:  'CADA concepto muestra el AMBIENTE donde ocurre el servicio: el lugar real, los props del oficio, la interacción entre proveedor y cliente. Que se vea auténtico y profesional al mismo tiempo.',
    confianza: 'CADA concepto transmite CREDIBILIDAD: expertise visible, resultados tangibles, prueba social. Usa elementos que generen confianza inmediata: uniformes, certificados, resultados en pantalla, gestos de profesionalismo.'
  };
  return 'CADA concepto DEBE mostrar una SITUACIÓN HUMANA diferente — personas latinoamericanas reales en momentos concretos.\n\nEnfoque elegido: ' + (focusMap[enfoque] || focusMap.resultado) + '\n\nVARÍA radicalmente: setting, ángulo, luz, emoción del sujeto y composición.';
}

async function dqLaunchCreativeConcepts() {
  var offer = (document.getElementById('dq-offer') || {}).value;
  if (!offer || !offer.trim()) {
    document.getElementById('dq-offer').style.borderColor = '#EF4444';
    return;
  }
  designQData.offer  = offer.trim();
  designQData.format = designQData.format || 'vertical';

  // Deshabilitar botón
  var btn = document.getElementById('dq-generate-concepts-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando brief...'; }

  // Ocultar el cuestionario
  var qMsg = document.getElementById('design-questionnaire-msg');
  if (qMsg) qMsg.style.display = 'none';

  // Mostrar thinking
  var thinkId = addThinking();
  setTimeout(function() {
    var el = document.getElementById(thinkId);
    if (el) { var t = el.querySelector('.thinking-bbl'); if (t) t.innerHTML = '<div class="spinner"></div>desarrollando conceptos creativos...'; }
  }, 100);

  // Construir brief completo para Claude
  var tipoNegocio = designQData.tipoNegocio || (designQData.tipoOferta
    ? (designQData.tipoOferta.toLowerCase().includes('producto') ? 'producto' : 'servicio')
    : 'producto');
  var esServicio = tipoNegocio === 'servicio';
  var enfoqueServicio = designQData.enfoqueServicio || 'resultado';

  var brief = [
    'MARCA: ' + (designQData.brand || 'Sin nombre'),
    'TIPO DE NEGOCIO: ' + (esServicio ? 'SERVICIO (no tiene producto físico)' : 'PRODUCTO FÍSICO'),
    designQData.industria    ? 'INDUSTRIA: '      + designQData.industria    : '',
    designQData.descripcion  ? 'DESCRIPCIÓN: '    + designQData.descripcion  : '',
    !esServicio && designQData.productos ? 'PRODUCTOS ESTRELLA: ' + designQData.productos : '',
    esServicio ? 'ENFOQUE VISUAL ELEGIDO: ' + enfoqueServicio : '',
    designQData.audiencia    ? 'AUDIENCIA: '      + designQData.audiencia    : '',
    designQData.tono         ? 'TONO DE MARCA: '  + designQData.tono         : '',
    designQData.estiloVisual ? 'ESTILO VISUAL: '  + designQData.estiloVisual : '',
    designQData.colors       ? 'COLORES: '        + designQData.colors       : '',
    designQData.diferenciador? 'DIFERENCIADOR: '  + designQData.diferenciador: '',
    designQData.propuesta    ? 'PROPUESTA DE VALOR: ' + designQData.propuesta : '',
    'CAMPAÑA: ' + designQData.offer,
    'FORMATO: ' + designQData.format,
    (!esServicio && designQData.productImageBase64) ? 'FOTO DE PRODUCTO: el usuario subió una foto del producto — úsala como fondo en todos los conceptos.' : '',
  ].filter(Boolean).join('\n');

  // ── System prompt diferenciado ────────────────────────────────────────────
  var systemPrompt = esServicio
    ? 'Eres el director creativo de una agencia de publicidad especializada en Meta Ads para servicios en Latinoamérica. CONTEXTO CRÍTICO: Este cliente vende un SERVICIO, no un producto físico. NO puedes poner el "producto" en la imagen porque no existe un objeto que mostrar. El visual SIEMPRE debe construirse desde una SITUACIÓN HUMANA concreta: personas reales en momentos específicos, ambientes que evocan el antes/después, o contextos que transmiten credibilidad profesional. REGLAS: (1) Cada concepto ocurre en un setting físico y momento completamente diferente. (2) Usa personas latinoamericanas reales en situaciones cotidianas reconocibles. (3) Muestra el CAMBIO emocional o el contexto del servicio — nunca imágenes abstractas o corporativas genéricas. (4) Varía radicalmente el ángulo, luz y composición entre conceptos. (5) El ideogram_prompt debe crear una escena tan específica y humana que cualquiera pueda sentirse identificado. Responde SOLO con JSON válido, sin markdown.'
    : 'Eres el director creativo de una agencia de publicidad de primer nivel especializada en Meta Ads para marcas latinoamericanas. REGLAS CRÍTICAS: (1) NUNCA repitas el mismo setting o escena entre conceptos. (2) Varía radicalmente el ángulo de cámara: macro extremo, cenital, frontal, 45 grados, primer plano de manos. (3) Varía el sujeto: solo el producto, manos sosteniéndolo, ambiente sin producto visible, persona usándolo. (4) Varía la fuente de luz: luz solar, vela encendida, ventana difusa, luz artificial, penumbra. (5) El ideogram_prompt debe ser imposible de confundir con otro concepto. Responde SOLO con JSON válido, sin markdown.';

  // ── User prompt diferenciado ─────────────────────────────────────────────
  var ejemplosConceptos = esServicio ? buildEjemplosServicio(designQData.industria || '', enfoqueServicio) : buildEjemplosProducto(designQData.productos || designQData.industria || '');

  var userPrompt = 'Crea 5 conceptos creativos RADICALMENTE DIFERENTES entre sí para este brief:\n\n' + brief + '\n\n' + ejemplosConceptos + '\n\nDevuelve SOLO este JSON:\n{\n  "concepts": [\n    {\n      "id": 1,\n      "nombre": "Nombre evocador del concepto en 3-4 palabras",\n      "concepto": "1 frase que describe la idea creativa central",\n      "escena": "Descripción visual detallada: qué se ve, dónde, cómo está iluminado, quién aparece, qué está pasando",\n      "angulo": "Tipo de toma fotográfica exacto",\n      "atmosfera": "3 palabras que definen el mood",\n      "headline": "Titular en español, máximo 6 palabras, impactante y emocional",\n      "subheadline": "Frase de apoyo en español, máximo 8 palabras, beneficio concreto",\n      "cta": "Call to action en español, máximo 4 palabras",\n      "ideogram_prompt": "Prompt en inglés para Ideogram, 70-90 palabras. OBLIGATORIO: setting exacto, ángulo de cámara, fuente de luz, sujeto principal, props específicos, mood, estilo fotográfico, paleta de color. Termina con: no text, no letters, no words, photorealistic, ultra detailed, professional commercial photography"\n    }\n  ]\n}';

  var concepts = null;
  try {
    var raw = await fetchChatFull({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });
    var clean = raw.replace(/```json|```/g, '').trim();
    var bi = clean.indexOf('{');
    if (bi >= 0) clean = clean.slice(bi);
    concepts = JSON.parse(clean);
  } catch(e) {
    console.warn('[Acuarius] concepts parse error:', e.message);
  }

  rmThinking(thinkId);

  if (!concepts || !concepts.concepts || !concepts.concepts.length) {
    addAgent('No pude generar los conceptos creativos. Por favor intenta de nuevo.');
    return;
  }

  showConceptCards(concepts.concepts);
}

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 3: Mostrar tarjetas de concepto para que el usuario apruebe
// ─────────────────────────────────────────────────────────────────────────────

function showConceptCards(concepts) {
  // Guardar conceptos en designQData para usarlos al generar
  designQData.concepts = concepts;

  var logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75"><rect width="75" height="75" fill="#1E2BCC" rx="8"/><path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/><path fill="#fff" d="M57.52 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/><circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/></svg>';

  var el = document.createElement('div');
  el.className = 'msg';
  el.id = 'concept-cards-msg';
  el.style.cssText = 'flex-direction:column;align-items:flex-start;max-width:100%';

  var cardsHtml = concepts.map(function(c, i) {
    return '<div class="concept-card" id="concept-card-' + c.id + '" style="border:1.5px solid var(--border);border-radius:12px;padding:14px 16px;background:var(--bg);transition:all .15s;cursor:pointer;margin-bottom:8px" onclick="dqToggleConcept(' + c.id + ')">' +
      '<div style="display:flex;align-items:flex-start;gap:10px">' +
        '<div style="width:18px;height:18px;border-radius:4px;border:2px solid var(--border);flex-shrink:0;margin-top:2px;display:flex;align-items:center;justify-content:center;transition:all .15s" id="concept-check-' + c.id + '"></div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<span style="font-size:10px;font-weight:700;color:var(--blue);background:var(--blue-lt);padding:2px 7px;border-radius:10px">V' + c.id + '</span>' +
            '<span style="font-size:13px;font-weight:700;color:var(--text)">' + c.nombre + '</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:8px;font-style:italic">' + c.concepto + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">' +
            '<div style="background:var(--sidebar);border-radius:7px;padding:7px 9px">' +
              '<div style="font-size:9px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Escena</div>' +
              '<div style="font-size:11px;color:var(--text);line-height:1.4">' + c.escena + '</div>' +
            '</div>' +
            '<div style="background:var(--sidebar);border-radius:7px;padding:7px 9px">' +
              '<div style="font-size:9px;font-weight:700;color:var(--muted2);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Atmósfera</div>' +
              '<div style="font-size:11px;color:var(--text);line-height:1.4">' + c.atmosfera + ' · ' + c.angulo + '</div>' +
            '</div>' +
          '</div>' +
          '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:7px;padding:7px 9px">' +
            '<div style="font-size:9px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Copy del anuncio</div>' +
            '<div style="font-size:12px;font-weight:700;color:var(--text)">' + c.headline + '</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + c.subheadline + '</div>' +
            '<div style="margin-top:5px;display:inline-block;background:var(--blue);color:white;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700">' + c.cta + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">' +
      '<div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">' + logoSvg + '</div>' +
      '<div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--text)">5 conceptos creativos listos</div>' +
        '<div style="font-size:11px;color:var(--muted)">Selecciona los que quieres generar como imagen</div>' +
      '</div>' +
    '</div>' +
    '<div style="padding-left:42px;width:100%;max-width:560px">' +
      cardsHtml +
      '<div style="display:flex;gap:8px;margin-top:4px">' +
        '<button onclick="dqSelectAllConcepts()" style="flex:1;padding:9px;background:var(--sidebar);color:var(--text);border:1px solid var(--border);border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">Seleccionar todos</button>' +
        '<button onclick="dqGenerateSelectedConcepts()" id="dq-gen-selected-btn" style="flex:2;padding:9px;background:var(--blue);color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font)" disabled>🎨 Generar seleccionados</button>' +
      '</div>' +
    '</div>';

  document.getElementById('chat-area').appendChild(el);
  scrollB();
}

var dqSelectedConcepts = new Set();

function dqToggleConcept(id) {
  var card  = document.getElementById('concept-card-' + id);
  var check = document.getElementById('concept-check-' + id);
  if (dqSelectedConcepts.has(id)) {
    dqSelectedConcepts.delete(id);
    card.style.borderColor  = 'var(--border)';
    card.style.background   = 'var(--bg)';
    check.style.background  = 'transparent';
    check.style.borderColor = 'var(--border)';
    check.innerHTML = '';
  } else {
    dqSelectedConcepts.add(id);
    card.style.borderColor  = 'var(--blue)';
    card.style.background   = 'var(--blue-lt)';
    check.style.background  = 'var(--blue)';
    check.style.borderColor = 'var(--blue)';
    check.innerHTML = '<svg width="10" height="10" viewBox="0 0 12 12"><polyline points="2,6 5,9 10,3" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
  var genBtn = document.getElementById('dq-gen-selected-btn');
  if (genBtn) {
    genBtn.disabled = dqSelectedConcepts.size === 0;
    genBtn.textContent = dqSelectedConcepts.size > 0
      ? '🎨 Generar ' + dqSelectedConcepts.size + ' creativo' + (dqSelectedConcepts.size > 1 ? 's' : '')
      : '🎨 Generar seleccionados';
  }
}

function dqSelectAllConcepts() {
  if (!designQData.concepts) return;
  designQData.concepts.forEach(function(c) {
    if (!dqSelectedConcepts.has(c.id)) dqToggleConcept(c.id);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ETAPA 4: Generar imágenes con los conceptos aprobados
// ─────────────────────────────────────────────────────────────────────────────

async function dqGenerateSelectedConcepts() {
  if (dqSelectedConcepts.size === 0) return;

  var selected = (designQData.concepts || []).filter(c => dqSelectedConcepts.has(c.id));
  if (!selected.length) return;

  var conceptMsg = document.getElementById('concept-cards-msg');
  if (conceptMsg) conceptMsg.style.display = 'none';

  var brand         = designQData.brand   || 'marca';
  var offer         = designQData.offer   || '';
  var format        = designQData.format  || 'vertical';
  var hasProductImg = !!(designQData.productImageBase64);
  var colorDesc     = designQData.colors  || '';

  // ── Extraer colores en hex para pasarlos al servidor ─────────────────────
  function extractBrandColors(colorStr) {
    if (!colorStr) return null;
    var hexMatches = colorStr.match(/#([0-9A-Fa-f]{6})/g);
    if (hexMatches && hexMatches.length >= 1) {
      return { primary: hexMatches[0], secondary: hexMatches[1] || '#FFFFFF', overlay: null };
    }
    // Mapeo de keywords a hex aproximados para pasarle a Ideogram color_palette
    var kwHex = {
      dorado:'#C9942A', oro:'#C9942A', golden:'#C9942A', crema:'#F5E6C8', beige:'#F0DDB8',
      café:'#6B3A2A', cafe:'#6B3A2A', marrón:'#6B3A2A', marron:'#6B3A2A', terracota:'#C1440E',
      azul:'#1E2BCC', navy:'#0D1B4B', celeste:'#2196F3', negro:'#111111', black:'#111111',
      blanco:'#FFFFFF', gris:'#666666', rojo:'#CC0000', verde:'#2D6A4F', rosa:'#C9184A',
      lila:'#7B2FBE', morado:'#5B21B6', violeta:'#5B21B6', naranja:'#E85D04', amarillo:'#F5E800',
    };
    var s = colorStr.toLowerCase();
    var primary = null, secondary = '#FFFFFF';
    for (var kw in kwHex) {
      if (s.includes(kw)) { if (!primary) primary = kwHex[kw]; else { secondary = kwHex[kw]; break; } }
    }
    return primary ? { primary, secondary, overlay: null } : null;
  }

  var brandColors = extractBrandColors(colorDesc);

  addAgent('generando **' + selected.length + ' creativo' + (selected.length > 1 ? 's' : '') + '** para **' + brand + '**...\n\ncampaña: *' + offer + '*');
  hist.push({ role: 'assistant', content: 'Generando creativos para ' + brand });

  generatedAdImages = [];
  adImgGridEl = null;
  loading = true;
  document.getElementById('sbtn').disabled = true;

  var total = selected.length;

  for (var i = 0; i < selected.length; i++) {
    var concept = selected[i];
    var thinkId = addThinking();
    (function(tid, c) {
      setTimeout(function() {
        var el = document.getElementById(tid);
        if (el) { var t = el.querySelector('.thinking-bbl'); if (t) t.innerHTML = '<div class="spinner"></div>generando "' + c.nombre + '"...'; }
      }, 100);
    })(thinkId, concept);

    try {
      var headers = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = 'Bearer ' + sessionToken;

      // ── Construir adCopy desde el concepto de Claude ──────────────────────
      var adCopy = {
        brand:       brand,
        headline:    concept.headline,
        subheadline: concept.subheadline,
        cta:         concept.cta,
      };

      // ── Llamada al servidor en modo DESIGN ────────────────────────────────
      // Ideogram V3 style:DESIGN genera el anuncio completo con texto integrado
      var body = {
        prompt:      concept.ideogram_prompt,
        format:      format,
        variations:  1,
        designMode:  true,          // ← activa el nuevo modo DESIGN en el servidor
        adCopy:      adCopy,
        brandColors: brandColors,
      };

      // Si hay foto del producto, pasarla para replace-background
      if (hasProductImg) {
        body.productImageBase64 = 'data:' + (designQData.productImageMediaType || 'image/jpeg') + ';base64,' + designQData.productImageBase64;
      }

      var res = await fetch('/api/generate-image', {
        method: 'POST', headers: headers,
        body: JSON.stringify(body)
      });
      var result = await res.json();
      rmThinking(thinkId);

      if (result.error || !result.images || !result.images.length) {
        addAgent('No pude generar el creativo "' + concept.nombre + '". ' + (result.error || 'Intenta de nuevo.'));
        continue;
      }

      var img = result.images[0];
      renderAdImage(img, i + 1, total, format, concept.nombre, false);
      incrementImageUsage();

    } catch(err) {
      rmThinking(thinkId);
      addAgent('Error generando "' + concept.nombre + '": ' + err.message);
    }
  }

  loading = false;
  document.getElementById('sbtn').disabled = false;
  dqSelectedConcepts = new Set();
  designQData = {};
}

// ─────────────────────────────────────────────────────────────────────────────
// Imagen básica para plan free
// ─────────────────────────────────────────────────────────────────────────────

function generateBasicImage() {
  const negocio  = mem.negocio   || 'tu negocio';
  const industria= mem.industria || 'servicios';
  hist.push({ role: 'assistant', content: 'Generando imagen básica...' });
  const imgMatch = ('[GENERAR_IMAGEN: {"prompt": "Professional advertisement for ' + negocio + ' in ' + industria + ', happy person using the service, corporate colors blue and white, clean professional design, no text, no letters", "format": "vertical", "variations": 1, "hasText": false}]').match(/\[GENERAR_IMAGEN:\s*(\{[\s\S]+?\})\]/);
  if (imgMatch) {
    try {
      const imgCmd = JSON.parse(imgMatch[1]);
      imgCmd._index = 1; imgCmd._total = 1;
      generateAdImages(imgCmd);
      incrementImageUsage();
    } catch(e) { addAgent('Error generando imagen básica'); }
  }
}





// =============================================
// META ADS — Conexión OAuth + Selector de cuentas
// =============================================
let metaAccounts = [];
let metaActiveAccount = null;

(function checkMetaCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('meta_connected') === 'true') {
    const token    = params.get('meta_token');   // solo en fallback sin userId
    const name     = params.get('meta_name');
    const email    = params.get('meta_email');
    const metaUid  = params.get('meta_user_id');
    const platform = params.get('platform');     // 'meta_ads' cuando se guardó en Supabase
    window.history.replaceState({}, '', window.location.pathname);
    if (token) {
      sessionStorage.setItem('meta_access_token', token);
      localStorage.setItem('meta_access_token_persist', token);
      sessionStorage.setItem('meta_user_name',   name   || '');
      sessionStorage.setItem('meta_user_email',  email  || '');
      sessionStorage.setItem('meta_user_id',     metaUid || '');
      updateMetaUI(true, name);
      setTimeout(() => { openSettings(); loadMetaAccounts(); }, 400);
    } else if (platform === 'meta_ads') {
      updateMetaUI(true, name || 'Conectado');
      // Clerk tarda 1-4s en cargar después de un redirect — reintentamos con backoff
      (async function waitForClerkAndLoad() {
        const delays = [800, 1500, 2500, 4000];
        for (const delay of delays) {
          await new Promise(res => setTimeout(res, delay));
          const uid = clerkInstance?.user?.id;
          if (!uid) continue;
          try {
            const r = await fetch(`/api/admin?action=get-connection&userId=${encodeURIComponent(uid)}&platform=meta_ads`);
            const conn = await r.json();
            if (conn.connected && conn.access_token) {
              sessionStorage.setItem('meta_access_token', conn.access_token);
              localStorage.setItem('meta_access_token_persist', conn.access_token);
              sessionStorage.setItem('meta_user_name', conn.account_name || name || '');
              if (conn.extra_data?.meta_user_id) sessionStorage.setItem('meta_user_id', conn.extra_data.meta_user_id);
              updateMetaUI(true, conn.account_name || name);
              openSettings(); loadMetaAccounts();
              return;
            }
          } catch {}
        }
      })();
    }
  }
  if (params.get('meta_error')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  const savedToken   = sessionStorage.getItem('meta_access_token');
  const savedName    = sessionStorage.getItem('meta_user_name');
  const savedAccount = sessionStorage.getItem('meta_active_account');
  if (savedToken) {
    updateMetaUI(true, savedName);
    if (savedAccount) {
      try { metaActiveAccount = JSON.parse(savedAccount); renderMetaActiveAccount(); } catch {}
    }
  }
})();

function connectMetaAds() {
  const uid = clerkInstance?.user?.id || '';
  window.location.href = '/api/meta-auth' + (uid ? '?userId=' + encodeURIComponent(uid) : '');
}

function disconnectMetaAds() {
  ['meta_access_token','meta_user_name','meta_user_email','meta_user_id','meta_active_account','meta_ad_account_id']
    .forEach(k => sessionStorage.removeItem(k));
  metaAccounts = []; metaActiveAccount = null;
  updateMetaUI(false);
  hidePlatformDashboard();
  const uid = clerkInstance?.user?.id;
  if (uid) fetch('/api/admin?action=disconnect-platform', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: uid, platform: 'meta_ads' }) }).catch(() => {});
}

async function loadMetaAccounts() {
  const token = sessionStorage.getItem('meta_access_token');
  if (!token) return;
  document.getElementById('metaAccountsLoading').style.display = 'block';
  document.getElementById('metaAccountsList').style.display    = 'none';
  document.getElementById('metaActiveAccount').style.display   = 'none';
  document.getElementById('metaAccountsError').style.display   = 'none';
  try {
    const res  = await fetch('/api/meta-list-accounts', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ accessToken: token }),
    });
    const data = await res.json();
    document.getElementById('metaAccountsLoading').style.display = 'none';
    if (data.error || !data.accounts?.length) {
      showMetaError('No se encontraron cuentas publicitarias. Verifica que tu cuenta tenga acceso a Meta Business Manager.');
      return;
    }
    metaAccounts = data.accounts;
    renderMetaAccountSelector();
  } catch(e) {
    document.getElementById('metaAccountsLoading').style.display = 'none';
    showMetaError('Error de conexión al cargar las cuentas.');
  }
}

function renderMetaAccountSelector() {
  const container = document.getElementById('metaAccountsContainer');
  container.innerHTML = metaAccounts.map(acc => {
    const isActive = metaActiveAccount?.id === acc.id;
    return `<div onclick="selectMetaAccount('${acc.id}')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;
      border:1.5px solid ${isActive ? 'var(--blue)' : 'var(--border)'};
      background:${isActive ? 'var(--blue-lt)' : 'var(--bg)'};transition:all .15s"
      onmouseover="this.style.borderColor='var(--blue-md)'"
      onmouseout="this.style.borderColor='${isActive ? 'var(--blue)' : 'var(--border)'}'">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(acc.name)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:1px">${acc.id} · ${acc.currency} · ${acc.status}${acc.business ? ' · '+esc(acc.business) : ''}</div>
      </div>
      ${isActive ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M20 6L9 17l-5-5" stroke="var(--blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
    </div>`;
  }).join('');
  document.getElementById('metaAccountsList').style.display = 'block';
  if (metaActiveAccount) renderMetaActiveAccount();
}

async function selectMetaAccount(accountId) {
  const acc = metaAccounts.find(a => a.id === accountId);
  if (!acc) return;
  metaActiveAccount = acc;
  sessionStorage.setItem('meta_active_account', JSON.stringify(acc));
  sessionStorage.setItem('meta_ad_account_id', acc.id);
  // Persistir en localStorage para restaurar tras recarga de página
  localStorage.setItem('meta_active_account_persist', JSON.stringify(acc));
  localStorage.setItem('meta_ad_account_id_persist', acc.id);
  // Guardar account_id en Supabase para que los crons de alertas/reportes lo usen
  const uid2 = clerkInstance?.user?.id;
  if (uid2) {
    fetch('/api/admin?action=save-platform-account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: uid2, platform: 'meta_ads', accountId: acc.id, accountName: acc.name })
    }).catch(() => {});
  }
  renderMetaActiveAccount();
  renderMetaAccountSelector();
  closeSettings();
  setTimeout(async () => {
    const saved = await dbLoadProfile('meta-ads');
    if (saved) {
      try {
        Object.assign(mem, saved); updateMem(); onDone = true;
        clientStage = mapStage(mem.etapa);
        document.getElementById('mem-card').style.display = 'block';
        document.getElementById('m-stage').textContent = clientStage;
        hist = [];
        addAgent(`cuenta Meta cambiada a **${acc.name}**.\n\n¿En qué trabajamos hoy?`);
      } catch { startNewMetaOnboarding(acc); }
    } else { startNewMetaOnboarding(acc); }
  }, 300);
}

function startNewMetaOnboarding(acc) {
  mem = {}; hist = []; onDone = false; obStep = 0;
  document.getElementById('mem-card').style.display = 'none';
  document.getElementById('chat-area').innerHTML = '';
  showView('chat'); setAgentContext('meta-ads');
  addAgent(`nueva cuenta Meta: **${acc.name}**.\n\nPara darte recomendaciones precisas, necesito conocer este negocio. Son 7 preguntas rápidas.`);
  setTimeout(() => renderOb(), 600);
}

function renderMetaActiveAccount() {
  if (!metaActiveAccount) return;
  const el = document.getElementById('metaActiveAccount');
  document.getElementById('metaActiveName').textContent = metaActiveAccount.name;
  document.getElementById('metaActiveId').textContent   = `${metaActiveAccount.id} · ${metaActiveAccount.currency}`;
  if (el) el.style.display = 'block';
}

function showMetaAccountSelector() {
  document.getElementById('metaActiveAccount').style.display = 'none';
  metaAccounts.length ? renderMetaAccountSelector() : loadMetaAccounts();
}

function showMetaError(msg) {
  const el = document.getElementById('metaAccountsError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function updateMetaUI(connected, name) {
  const badge     = document.getElementById('metaStatusBadge');
  const discDiv   = document.getElementById('metaDisconnected');
  const connDiv   = document.getElementById('metaConnected');
  const nameSpan  = document.getElementById('metaUserName');
  if (connected) {
    if (badge) { badge.textContent = '● conectado'; badge.style.background = 'rgba(5,150,105,.1)'; badge.style.color = 'var(--success)'; }
    if (discDiv) discDiv.style.display = 'none';
    if (connDiv) connDiv.style.display = 'block';
    if (name && nameSpan) nameSpan.textContent = name;
    if (!metaAccounts.length && !metaActiveAccount) loadMetaAccounts();
  } else {
    if (badge) { badge.textContent = 'sin conectar'; badge.style.background = 'var(--sidebar2)'; badge.style.color = 'var(--muted)'; }
    if (discDiv) discDiv.style.display = 'block';
    if (connDiv) connDiv.style.display = 'none';
  }
}

// Llamada a Meta Marketing API
async function callMetaAPI(endpoint, method = 'GET', params = {}) {
  const token     = sessionStorage.getItem('meta_access_token');
  const accountId = sessionStorage.getItem('meta_ad_account_id');
  if (!token)     return { error: 'No hay sesión de Meta Ads. Conecta tu cuenta en Configuración.' };
  if (!accountId && endpoint.includes('{AD_ACCOUNT_ID}'))
    return { error: 'No hay cuenta de Meta activa. Selecciona una en Configuración → Conexiones.' };
  const resolvedEndpoint = endpoint.replace('{AD_ACCOUNT_ID}', accountId?.replace('act_','') || '');
  try {
    const res  = await fetch('/api/meta-ads', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ accessToken: token, adAccountId: accountId, endpoint: resolvedEndpoint, method, params }),
    });
    return await res.json();
  } catch(e) { return { error: e.message }; }
}


function openSettings() {
  const panel = document.getElementById('settings-panel');
  const overlay = document.getElementById('settings-overlay');
  panel.style.display = 'flex';
  overlay.style.display = 'block';
  // Poblar datos de cuenta
  if (clerkInstance && clerkInstance.user) {
    const u = clerkInstance.user;
    const name = u.firstName ? (u.firstName + (u.lastName ? ' ' + u.lastName : '')) : (u.username || '—');
    const email = u.primaryEmailAddress?.emailAddress || '—';
    const initials = name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
    document.getElementById('cfg-avatar').textContent = initials;
    document.getElementById('cfg-name').textContent = name;
    document.getElementById('cfg-email').textContent = email;
    document.getElementById('cfg-plan').textContent = userPlan === 'pro' ? 'Pro' : 'Free';
  }
  // Sincronizar estado de conexiones desde sessionStorage al abrir el panel
  const metaToken = sessionStorage.getItem('meta_access_token');
  const metaName  = sessionStorage.getItem('meta_user_name');
  updateMetaUI(!!metaToken, metaName || '');
  const adsToken = sessionStorage.getItem('ads_access_token');
  const adsEmail = sessionStorage.getItem('ads_email');
  if (typeof updateAdsUI === 'function') updateAdsUI(!!adsToken, adsEmail || '');
}

function closeSettings() {
  document.getElementById('settings-panel').style.display = 'none';
  document.getElementById('settings-overlay').style.display = 'none';
}

function switchSettingsTab(tab) {
  ['connections','account'].forEach(t => {
    document.getElementById('stab-content-'+t).style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById('stab-'+t);
    if (t === tab) {
      btn.style.color = 'var(--blue)';
      btn.style.borderBottom = '2px solid var(--blue)';
      btn.style.fontWeight = '600';
    } else {
      btn.style.color = 'var(--muted)';
      btn.style.borderBottom = '2px solid transparent';
      btn.style.fontWeight = '500';
    }
  });
}

// =============================================
// GOOGLE ADS — Conexión OAuth + Selector de cuentas MCC
// =============================================

// Estado global de cuentas
let adsAccounts = [];       // todas las cuentas accesibles
// adsActiveAccount declarado al inicio del script para evitar ReferenceError

(function checkAdsCallback() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('ads_connected') === 'true') {
    const token   = params.get('ads_token');   // solo presente en fallback sin userId
    const refresh = params.get('ads_refresh');
    const email   = params.get('ads_email');
    const platform = params.get('platform');   // 'google_ads' cuando se guardó en Supabase
    window.history.replaceState({}, '', window.location.pathname);
    if (token) {
      // Fallback: token llegó por URL (sin userId)
      sessionStorage.setItem('ads_access_token', token);
      sessionStorage.setItem('ads_refresh_token', refresh || '');
      sessionStorage.setItem('ads_email', email || '');
      localStorage.setItem('ads_access_token_persist', token);
      localStorage.setItem('ads_refresh_token_persist', refresh || '');
      localStorage.setItem('ads_email_persist', email || '');
      updateAdsUI(true, email);
      setTimeout(() => { openSettings(); loadAdsAccounts(); }, 400);
    } else if (platform === 'google_ads') {
      // Token guardado en Supabase — restaurar via get-connection
      updateAdsUI(true, email || 'Conectado');
      setTimeout(async () => {
        const uid = clerkInstance?.user?.id;
        if (!uid) return;
        try {
          const r = await fetch(`/api/admin?action=get-connection&userId=${encodeURIComponent(uid)}&platform=google_ads`);
          const conn = await r.json();
          if (conn.connected && conn.access_token) {
            sessionStorage.setItem('ads_access_token', conn.access_token);
            sessionStorage.setItem('ads_email', conn.account_name || email || '');
            localStorage.setItem('ads_access_token_persist', conn.access_token);
            localStorage.setItem('ads_email_persist', conn.account_name || email || '');
            updateAdsUI(true, conn.account_name || email);
            openSettings(); loadAdsAccounts();
          }
        } catch {}
      }, 600);
    }
  }
  if (params.get('ads_error')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
  // Restaurar sesión — sessionStorage primero, luego localStorage como fallback
  var savedToken   = sessionStorage.getItem('ads_access_token')   || localStorage.getItem('ads_access_token_persist');
  var savedEmail   = sessionStorage.getItem('ads_email')          || localStorage.getItem('ads_email_persist');
  var savedAccount = sessionStorage.getItem('ads_active_account') || localStorage.getItem('ads_active_account_persist');
  var savedCustId  = sessionStorage.getItem('ads_customer_id')    || localStorage.getItem('ads_customer_id_persist');
  if (savedToken) {
    if (!sessionStorage.getItem('ads_access_token')) sessionStorage.setItem('ads_access_token', savedToken);
    if (savedEmail  && !sessionStorage.getItem('ads_email'))       sessionStorage.setItem('ads_email', savedEmail);
    if (savedCustId && !sessionStorage.getItem('ads_customer_id')) sessionStorage.setItem('ads_customer_id', savedCustId);
    updateAdsUI(true, savedEmail);
    if (savedAccount) {
      try {
        adsActiveAccount = JSON.parse(savedAccount);
        if (!sessionStorage.getItem('ads_active_account')) sessionStorage.setItem('ads_active_account', savedAccount);
        renderActiveAccount();
      } catch {}
    }
  }
})();

function connectGoogleAds() {
  const uid = clerkInstance?.user?.id || '';
  window.location.href = '/api/google-ads-auth' + (uid ? '?userId=' + encodeURIComponent(uid) : '');
}

function disconnectGoogleAds() {
  sessionStorage.removeItem('ads_access_token');
  sessionStorage.removeItem('ads_refresh_token');
  sessionStorage.removeItem('ads_email');
  sessionStorage.removeItem('ads_active_account');
  sessionStorage.removeItem('ads_customer_id');
  localStorage.removeItem('ads_access_token_persist');
  localStorage.removeItem('ads_refresh_token_persist');
  localStorage.removeItem('ads_email_persist');
  localStorage.removeItem('ads_active_account_persist');
  localStorage.removeItem('ads_customer_id_persist');
  adsAccounts = [];
  adsActiveAccount = null;
  updateAdsUI(false);
  hidePlatformDashboard();
  const uid = clerkInstance?.user?.id;
  if (uid) fetch('/api/admin?action=disconnect-platform', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ userId: uid, platform: 'google_ads' }) }).catch(() => {});
}

// Carga las cuentas desde la API y muestra el selector
async function loadAdsAccounts() {
  const accessToken = sessionStorage.getItem('ads_access_token') || localStorage.getItem('ads_access_token_persist');
  if (!accessToken) return;
  if (!sessionStorage.getItem('ads_access_token')) sessionStorage.setItem('ads_access_token', accessToken);

  // Mostrar loading
  document.getElementById('adsAccountsLoading').style.display = 'block';
  document.getElementById('adsAccountsList').style.display = 'none';
  document.getElementById('adsActiveAccount').style.display = 'none';
  document.getElementById('adsAccountsError').style.display = 'none';

  try {
    const res = await fetch('/api/list-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const data = await res.json();
    document.getElementById('adsAccountsLoading').style.display = 'none';

    if (data.error || !data.accounts?.length) {
      showAdsError('No se pudieron cargar las cuentas. Puede ser que la API aún esté en revisión por Google.');
      return;
    }

    adsAccounts = data.accounts;
    renderAccountSelector();

  } catch (err) {
    document.getElementById('adsAccountsLoading').style.display = 'none';
    showAdsError('Error de conexión al cargar las cuentas.');
  }
}

function renderAccountSelector() {
  const container = document.getElementById('adsAccountsContainer');
  const isAgency  = userPlan === 'agency';
  const nonManager = adsAccounts.filter(a => !a.isManager);
  const toShow    = nonManager.length > 0 ? nonManager : adsAccounts;

  // Gate de plan: individual solo puede ver/activar 1 cuenta
  const gateMsg = document.getElementById('adsPlanGateMsg');
  if (!isAgency && toShow.length > 1) {
    gateMsg.style.display = 'block';
  } else {
    gateMsg.style.display = 'none';
  }

  container.innerHTML = toShow.map((acc, idx) => {
    const isLocked = !isAgency && idx > 0; // solo la primera disponible en plan individual
    const isActive = adsActiveAccount?.id === acc.id;
    return `
    <div onclick="${isLocked ? 'showUpgradeHint()' : `selectAdsAccount('${acc.id}')`}"
      style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:${isLocked ? 'default' : 'pointer'};
      border:1.5px solid ${isActive ? 'var(--blue)' : 'var(--border)'};
      background:${isActive ? 'var(--blue-lt)' : isLocked ? 'var(--sidebar2)' : 'var(--bg)'};
      opacity:${isLocked ? '.5' : '1'};transition:all .15s"
      onmouseover="if(!${isLocked})this.style.borderColor='${isActive ? 'var(--blue)' : 'var(--blue-md)'}'"
      onmouseout="this.style.borderColor='${isActive ? 'var(--blue)' : 'var(--border)'}'">
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(acc.name)}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:1px">ID: ${acc.id} · ${acc.currency}${acc.isTest ? ' · cuenta de prueba' : ''}</div>
      </div>
      ${isActive ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><path d="M20 6L9 17l-5-5" stroke="var(--blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ''}
      ${isLocked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" style="flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2" stroke="var(--muted2)" stroke-width="2"/><path d="M7 11V7a5 5 0 0110 0v4" stroke="var(--muted2)" stroke-width="2" stroke-linecap="round"/></svg>' : ''}
    </div>`;
  }).join('');

  document.getElementById('adsAccountsList').style.display = 'block';

  // Si ya hay una cuenta activa, mostrarla también
  if (adsActiveAccount) renderActiveAccount();
}

async function selectAdsAccount(accountId) {
  const acc = adsAccounts.find(a => a.id === accountId);
  if (!acc) return;

  adsActiveAccount = acc;
  sessionStorage.setItem('ads_active_account', JSON.stringify(acc));
  localStorage.setItem('ads_active_account_persist', JSON.stringify(acc));

  // Guardar también el customerId para queryGoogleAds
  sessionStorage.setItem('ads_customer_id', acc.id);
  localStorage.setItem('ads_customer_id_persist', acc.id);

  renderActiveAccount();
  renderAccountSelector(); // re-render para marcar el activo

  // Verificar si esta cuenta tiene perfil guardado
  const savedProfile = await dbLoadProfile('google-ads');

  // Notificar al agente del cambio de cuenta
  const accountMsg = savedProfile
    ? `He cambiado a la cuenta **${acc.name}** (ID: ${acc.id}). Ya tengo perfil guardado para esta cuenta.`
    : `He cambiado a la cuenta **${acc.name}** (ID: ${acc.id}). Esta es una cuenta nueva — inicia el onboarding.`;

  // Cerrar settings y notificar
  closeSettings();
  setTimeout(() => {
    if (savedProfile) {
      // Restaurar perfil de esta cuenta
      try {
        const profile = typeof savedProfile === 'string' ? JSON.parse(savedProfile) : savedProfile;
        Object.assign(mem, profile);
        updateMem();
        onDone = true;
        document.getElementById('mem-card').style.display = 'block';
        clientStage = mapStage(mem.etapa);
        document.getElementById('m-stage').textContent = clientStage;
        hist = [];
        addAgent(`cuenta cambiada a **${acc.name}**.\n\nPerfil cargado:\n**negocio:** ${mem.negocio||'—'}\n**objetivo:** ${mem.objetivo||'—'}\n\n¿En qué trabajamos hoy para esta cuenta?`);
      } catch {
        startNewAccountOnboarding(acc);
      }
    } else {
      startNewAccountOnboarding(acc);
    }
  }, 300);
}

function startNewAccountOnboarding(acc) {
  // Reiniciar perfil para cuenta nueva
  mem = {};
  hist = [];
  onDone = false;
  obStep = 0;
  document.getElementById('mem-card').style.display = 'none';
  document.getElementById('chat-area').innerHTML = '';
  showView('chat');
  addAgent(`nueva cuenta detectada: **${acc.name}** (ID: ${acc.id}).\n\nPara darte recomendaciones precisas, necesito conocer a este cliente. Son 7 preguntas rápidas.`);
  setTimeout(() => renderOb(), 600);
}

// Guarda perfil al completar onboarding por cuenta
const _origFinishOb = window.finishOb;
async function finishObWithAccountSave() {
  // Guardar perfil en Supabase (con fallback a localStorage)
  await dbSaveProfile(currentAgentCtx, mem);

  onDone = true;
  document.getElementById('mem-card').style.display = 'block';
  clientStage = mapStage(mem.etapa);
  document.getElementById('m-stage').textContent = clientStage;
  hist = [];

  const accountName = adsActiveAccount ? ' para **' + adsActiveAccount.name + '**' : '';

  // Construir resumen según agente
  let resumen = 'perfecto, ya tengo el perfil completo' + accountName + ':\n\n';
  resumen += '**negocio:** ' + (mem.negocio || '—') + '\n';
  resumen += '**industria:** ' + (mem.industria || '—') + '\n';
  if (mem.producto)    resumen += '**producto:** ' + mem.producto + '\n';
  resumen += '**presupuesto mensual:** ' + (mem.presupuesto || '—') + '\n';
  resumen += '**objetivo:** ' + (mem.objetivo || '—') + '\n';
  if (mem.mercado)     resumen += '**mercado:** ' + mem.mercado + '\n';
  if (mem.canales)     resumen += '**canales activos:** ' + mem.canales + '\n';
  if (mem.desafio)     resumen += '**mayor reto:** ' + mem.desafio + '\n';
  if (mem.etapa)       resumen += '**etapa:** ' + clientStage + '\n';

  resumen += '\ntodo guardado.';

  addAgent(resumen);

  // Mostrar cards de acción según el agente
  if (currentAgentCtx === 'google-ads')   { setTimeout(showGoogleAdsActionCards, 400); setTimeout(function(){ loadRecentConversations(); }, 700); return; }
  if (currentAgentCtx === 'meta-ads')     { setTimeout(showMetaActionCards, 400); setTimeout(function(){ loadRecentConversations(); }, 700); return; }
  if (currentAgentCtx === 'tiktok-ads')  { setTimeout(showTikTokActionCards, 400); setTimeout(function(){ loadRecentConversations(); }, 700); return; }
  if (currentAgentCtx === 'linkedin-ads') { setTimeout(showLinkedInActionCards, 400); setTimeout(function(){ loadRecentConversations(); }, 700); return; }
  if (currentAgentCtx === 'seo')          { setTimeout(showSeoActionCards, 400); setTimeout(function(){ loadRecentConversations(); }, 700); return; }
  if (currentAgentCtx === 'social')       { setTimeout(showSocialActionCards, 400); setTimeout(function(){ loadRecentConversations(); }, 700); return; }

  // Para el consultor: generar Plan de 30 días automáticamente, luego mostrar cards
  if (currentAgentCtx === 'consultor') {
    // Inyectar el prompt del plan en hist sin mostrarlo al usuario
    const planPrompt = 'Con base en el perfil de mi negocio que acabas de registrar, genera un **Plan de Marketing Digital de 30 días** personalizado. ' +
      'Estructura el plan por semanas (Semana 1 a 4), con acciones concretas y priorizadas según mi presupuesto, industria y objetivos. ' +
      'Incluye: canales recomendados, tareas específicas por semana, métricas clave a seguir y un consejo táctico de alto impacto para el primer mes. ' +
      'Sé directo, práctico y orientado a resultados para el mercado latinoamericano.';

    hist.push({ role: 'user', content: planPrompt });

    // Llamar a callClaude() directamente (sin addUser → el prompt no aparece en el chat)
    // Después del streaming, agregar las cards de profundización
    const _origOnDone = onDone; // ya es true
    await callClaude();

    // Mostrar cards de profundización después de que el plan se haya generado
    setTimeout(() => {
      const pasos = [
        { icon: '🗺️', titulo: 'Diagnóstico de canales', desc: '¿Dónde deberías invertir tu presupuesto? Te digo qué plataformas usar y cuáles evitar.', prompt: 'Analiza mi situación de marketing digital y dime qué canales debo priorizar para mi negocio' },
        { icon: '💰', titulo: 'Distribución de presupuesto', desc: 'Cómo repartir tu dinero entre canales para el máximo resultado desde el primer mes.', prompt: 'Ayúdame a definir cómo distribuir mi presupuesto de marketing digital entre los mejores canales para mi negocio' },
        { icon: '📣', titulo: 'Estrategia de contenido', desc: 'Qué publicar, cuándo y en qué formato para construir audiencia y generar demanda.', prompt: 'Crea una estrategia de contenido para redes sociales adaptada a mi negocio y presupuesto' },
        { icon: '📊', titulo: 'Métricas que importan', desc: 'Qué números seguir y cómo saber si tu marketing está funcionando o no.', prompt: 'Explícame qué métricas debo medir en mi marketing digital y cómo interpretarlas' },
      ];

      const cards = pasos.map(p => `
        <div class="next-step-card" onclick="document.getElementById('obc-steps')?.remove();qSend('${p.prompt.replace(/'/g,"\\'")}');">
          <div class="next-step-icon">${p.icon}</div>
          <div class="next-step-title">${p.titulo}</div>
          <div class="next-step-desc">${p.desc}</div>
        </div>`).join('');

      const el = document.createElement('div');
      el.id = 'obc-steps';
      el.style.cssText = 'display:flex;gap:10px;align-items:flex-start;margin-top:4px';
      el.innerHTML = `
        <div class="av ag" style="background:transparent;border:none;overflow:hidden;padding:0;flex-shrink:0">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 75 75" style="width:28px;height:28px">
            <rect width="75" height="75" fill="#1E2BCC" rx="8"/>
            <path fill="#fff" d="M67.52 61.99L53.7 38.06l-6.09 10.57 10.76 18.64c.97 1.68 2.75 2.64 4.58 2.64.89 0 1.8-.24 2.63-.72 2.54-1.46 3.4-4.68 1.94-7.2z"/>
            <path fill="#fff" d="M57.82 24.91l-5.86 10.16-6.1 10.56-9.44 16.35c-2.82 4.9-8.1 7.95-13.75 7.95-5.74 0-10.89-2.97-13.77-7.95-2.87-4.97-2.87-10.92 0-15.89L25.41 17.5c1.72-2.97 4.79-4.75 8.21-4.75s6.49 1.78 8.21 4.75l.6 1.04 1.71 2.96-6.1 10.57-4.42-7.65L18.06 51.36c-1.39 2.4-.47 4.53 0 5.33.47.8 1.84 2.67 4.62 2.67 1.89 0 3.67-1.02 4.6-2.67l12.48-21.62 6.11-10.57 2.8-4.86c1.46-2.53 4.69-3.4 7.22-1.93 2.52 1.45 3.39 4.67 1.93 7.2z"/>
            <circle fill="#fff" cx="60.13" cy="10.7" r="5.3"/>
          </svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:var(--muted2);margin-bottom:10px">¿quieres profundizar en algún tema?</div>
          <div class="next-steps-grid">${cards}</div>
        </div>`;
      document.getElementById('chat-area').appendChild(el);
      scrollB();
    }, 400);
  }
}

function renderActiveAccount() {
  if (!adsActiveAccount) return;
  const el = document.getElementById('adsActiveAccount');
  const nameEl = document.getElementById('adsActiveName');
  const idEl   = document.getElementById('adsActiveId');
  if (nameEl) nameEl.textContent = adsActiveAccount.name;
  if (idEl)   idEl.textContent   = `ID: ${adsActiveAccount.id} · ${adsActiveAccount.currency}`;
  if (el)     el.style.display   = 'block';
}

function showAccountSelector() {
  document.getElementById('adsActiveAccount').style.display = 'none';
  if (adsAccounts.length > 0) {
    renderAccountSelector();
  } else {
    loadAdsAccounts();
  }
}

function showAdsError(msg) {
  const el = document.getElementById('adsAccountsError');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showUpgradeHint() {
  showAdsError('Para conectar múltiples cuentas necesitas el Plan Agencia. Próximamente disponible.');
}

function updateAdsUI(connected, email) {
  const badge      = document.getElementById('adsStatusBadge');
  const disconnDiv = document.getElementById('adsDisconnected');
  const connDiv    = document.getElementById('adsConnected');
  const emailSpan  = document.getElementById('adsEmail');
  const connBadge  = document.getElementById('connBadge');
  if (connected) {
    if (badge) { badge.textContent = '● conectado'; badge.style.background = 'rgba(5,150,105,.1)'; badge.style.color = 'var(--success)'; }
    if (disconnDiv) disconnDiv.style.display = 'none';
    if (connDiv) connDiv.style.display = 'block';
    if (email && emailSpan) emailSpan.textContent = email;
    if (connBadge) connBadge.style.display = 'block';
    if (!adsAccounts.length && !adsActiveAccount) loadAdsAccounts();
  } else {
    if (badge) { badge.textContent = 'sin conectar'; badge.style.background = 'var(--sidebar2)'; badge.style.color = 'var(--muted)'; }
    if (disconnDiv) disconnDiv.style.display = 'block';
    if (connDiv) connDiv.style.display = 'none';
    if (connBadge) connBadge.style.display = 'none';
  }
}

async function queryGoogleAds(gaqlQuery) {
  const accessToken = sessionStorage.getItem('ads_access_token') || localStorage.getItem('ads_access_token_persist');
  const customerId  = sessionStorage.getItem('ads_customer_id')  || localStorage.getItem('ads_customer_id_persist');
  if (!accessToken) return { error: 'No hay sesión de Google Ads. Conecta tu cuenta en Configuración.' };
  if (!customerId)  return { error: 'No hay cuenta activa seleccionada. Ve a Configuración → Conexiones y selecciona una cuenta.' };
  try {
    const res = await fetch('/api/google-ads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId, query: gaqlQuery, accessToken }),
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}


const COMING_SOON_DATA = {
  'tiktok-ads': {
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="#010101"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.78a4.85 4.85 0 01-1-.09z"/></svg>`,
    iconBg: '#F0F0F0',
    title: 'Agente TikTok Ads',
    desc: 'Pronto tendrás un especialista en TikTok Ads que te ayudará a crear campañas, videos virales y estrategias de contenido adaptadas al algoritmo de TikTok en Latinoamérica.',
    features: [
      '🎬 Guiones y hooks para videos de alto impacto',
      '🎯 Estrategia de campaña y segmentación de audiencias',
      '💰 Presupuesto y pujas recomendadas para LatAm',
      '📊 Análisis de rendimiento y optimización',
      '✍️ Copys y textos para anuncios In-Feed y TopView',
    ]
  },
  'linkedin-ads': {
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
    iconBg: '#E8F3FC',
    title: 'Agente LinkedIn Ads',
    desc: 'Un especialista B2B enfocado en generar leads de calidad para empresas latinoamericanas a través de LinkedIn Ads, con conocimiento profundo de segmentación profesional y formatos de alto rendimiento.',
    features: [
      '🎯 Segmentación por cargo, industria y empresa',
      '✍️ Copys para Sponsored Content, InMail y Lead Gen Forms',
      '💰 Estrategia de presupuesto para B2B en LatAm',
      '📊 Análisis de CPL y optimización de campañas',
      '🏢 Estrategia de Account-Based Marketing (ABM)',
    ]
  },
};

function showComingSoon(agentKey) {
  const data = COMING_SOON_DATA[agentKey];
  if (!data) return;
  const modal = document.getElementById('coming-soon-modal');
  document.getElementById('csm-icon').style.background = data.iconBg;
  document.getElementById('csm-icon').innerHTML = data.icon;
  document.getElementById('csm-title').textContent = data.title;
  document.getElementById('csm-desc').textContent = data.desc;
  document.getElementById('csm-features').innerHTML = data.features
    .map(f => `<div style="font-size:13px;color:var(--text);padding:5px 0;border-bottom:1px solid var(--border);line-height:1.4">${f}</div>`)
    .join('').replace(/style="([^"]*);border-bottom[^"]*"(?=[^<]*<\/div>\s*$)/, 'style="$1"');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeComingSoon() {
  document.getElementById('coming-soon-modal').style.display = 'none';
  document.body.style.overflow = '';
}