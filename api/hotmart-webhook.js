import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HOTMART_SECRET = process.env.HOTMART_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verificar firma de Hotmart
  const signature = req.headers['x-hotmart-hottok'];
  if (HOTMART_SECRET && signature !== HOTMART_SECRET) {
    console.error('Firma Hotmart inválida');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const event = req.body;
  const eventType = event?.event;
  const data = event?.data;

  console.log('Hotmart webhook recibido:', eventType);

  // Solo procesamos estos eventos
  const eventosValidos = [
    'PURCHASE_APPROVED',
    'PURCHASE_COMPLETE',
    'SUBSCRIPTION_REACTIVATED'
  ];
  const eventosCancelacion = [
    'PURCHASE_REFUNDED',
    'PURCHASE_CHARGEBACK',
    'SUBSCRIPTION_CANCELLATION'
  ];

  if (!eventosValidos.includes(eventType) && !eventosCancelacion.includes(eventType)) {
    return res.status(200).json({ received: true, action: 'ignored' });
  }

  // Extraer datos del comprador
  const email = data?.buyer?.email;
  const transactionId = data?.purchase?.transaction;
  const subscriptionId = data?.subscription?.subscriber?.code || null;
  const productName = data?.product?.name || '';

  if (!email) {
    console.error('No se encontró email en el webhook');
    return res.status(400).json({ error: 'Missing email' });
  }

  // Determinar plan según nombre del producto
  let plan = 'individual';
  if (productName.toLowerCase().includes('agencia')) plan = 'agencia';

  // Buscar usuario en Supabase por email
  const { data: usuario, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (userError || !usuario) {
    console.error('Usuario no encontrado en Supabase:', email);
    // Guardamos igual para procesarlo luego desde el admin
    return res.status(200).json({ received: true, action: 'user_not_found', email });
  }

  if (eventosCancelacion.includes(eventType)) {
    // Cancelar plan
    await supabase
      .from('billing')
      .update({ status: 'cancelled' })
      .eq('user_id', usuario.id);

    console.log('Plan cancelado para:', email);
    return res.status(200).json({ received: true, action: 'cancelled' });
  }

  // Activar o renovar plan
  const ahora = new Date();
  const vencimiento = new Date(ahora);
  vencimiento.setMonth(vencimiento.getMonth() + 1);

  const { error: billingError } = await supabase
    .from('billing')
    .upsert({
      user_id: usuario.id,
      plan: plan,
      status: 'active',
      amount: plan === 'agencia' ? 19 : 19,
      currency: 'USD',
      period_start: ahora.toISOString(),
      period_end: vencimiento.toISOString(),
      hotmart_transaction: transactionId,
      hotmart_subscription_id: subscriptionId,
      notes: `Activado via Hotmart webhook - ${eventType}`
    }, {
      onConflict: 'user_id'
    });

  if (billingError) {
    console.error('Error actualizando billing:', billingError);
    return res.status(500).json({ error: 'DB error' });
  }

  console.log(`Plan ${plan} activado para ${email}`);
  return res.status(200).json({ received: true, action: 'activated', plan, email });
}
```

Luego agrega estas variables en Vercel (Settings → Environment Variables):
```
HOTMART_WEBHOOK_SECRET = (lo obtienes cuando crees el webhook en Hotmart)
SUPABASE_SERVICE_KEY = (la service_role key de Supabase, no la anon key)
