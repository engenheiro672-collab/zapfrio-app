// Middleware de autenticação — confirma que quem está chamando essa rota
// realmente está logado no ZapFrio, e descobre de qual EMPRESA ele é.
//
// Como funciona: o painel do cliente (zapfrio.html) já tem uma sessão do Supabase Auth.
// A gente pega o "access_token" dessa sessão e manda no cabeçalho Authorization
// de toda chamada pro backend. Aqui a gente confirma que esse token é válido.
const supabaseAdmin = require('../config/supabaseAdmin');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado.' });
  }

  // Confirma que o token é válido e descobre quem é o usuário
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }

  // Descobre a qual empresa esse usuário pertence
  const { data: company, error: companyError } = await supabaseAdmin
    .from('companies')
    .select('*')
    .eq('auth_user_id', userData.user.id)
    .single();

  if (companyError || !company) {
    return res.status(404).json({ error: 'Empresa não encontrada para esse usuário.' });
  }

  req.user = userData.user;
  req.company = company; // disponível em todas as rotas protegidas, como req.company.id
  next();
}

module.exports = { requireAuth };
