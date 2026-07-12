// Cliente Supabase do BACKEND — usa a service_role key, que ignora RLS.
// Isso é seguro aqui porque esse arquivo nunca roda no navegador do cliente,
// só no servidor Node (Render), protegido pelo .env.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = supabaseAdmin;
