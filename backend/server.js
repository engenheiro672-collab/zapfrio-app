require('dotenv').config();
const express = require('express');
const cors = require('cors');

const asaasRoutes = require('./routes/asaas');
const webhookRoutes = require('./routes/webhooks');
const shelbyRoutes = require('./routes/shelby');

const app = express();

// CORS: só o domínio do seu app do cliente pode chamar esse backend
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

// Os webhooks precisam do corpo "cru" às vezes, mas aqui usamos JSON normal —
// o Asaas manda JSON, então express.json() dá conta.
app.use(express.json());

app.get('/', (req, res) => {
  res.send('ZapFrio backend está no ar. ✅');
});

app.use('/api/asaas', asaasRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/shelby', shelbyRoutes);

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`🧊 ZapFrio backend rodando na porta ${PORT}`);
});
