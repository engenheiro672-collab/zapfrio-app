// Funções pra chamar a API do Asaas. Centralizado aqui pra não repetir
// headers/URL em todo lugar.
require('dotenv').config();

const BASE_URL = process.env.ASAAS_API_URL;
const API_KEY = process.env.ASAAS_API_KEY;

async function asaasRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'access_token': API_KEY,
      ...options.headers
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.errors?.[0]?.description || 'Erro na chamada ao Asaas');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

// Cria (ou você pode adaptar pra buscar se já existir) um cliente no Asaas
function createAsaasCustomer({ name, email, cpfCnpj, phone }) {
  return asaasRequest('/customers', {
    method: 'POST',
    body: JSON.stringify({ name, email, cpfCnpj, mobilePhone: phone })
  });
}

// Cria uma assinatura recorrente.
// cycle: 'MONTHLY' ou 'YEARLY' — value: valor em reais — billingType: 'CREDIT_CARD' ou 'PIX'
// nextDueDate: 'YYYY-MM-DD' — primeira data de cobrança (7 dias à frente, no caso do trial)
function createAsaasSubscription({ customerId, value, cycle, billingType, nextDueDate, description, creditCard, creditCardHolderInfo }) {
  const body = { customer: customerId, billingType, value, cycle, nextDueDate, description };
  if (billingType === 'CREDIT_CARD' && creditCard) {
    body.creditCard = creditCard;
    body.creditCardHolderInfo = creditCardHolderInfo;
  }
  return asaasRequest('/subscriptions', { method: 'POST', body: JSON.stringify(body) });
}

function cancelAsaasSubscription(subscriptionId) {
  return asaasRequest(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
}

// Quando você cria uma assinatura, o Asaas gera a primeira COBRANÇA (payment) dela
// de forma meio assíncrona — o ID da assinatura não serve pra buscar o QR code do Pix,
// precisamos do ID da cobrança. Essa função busca essa cobrança, tentando algumas vezes
// caso ainda não tenha sido gerada no exato instante em que chamamos.
async function findFirstPaymentOfSubscription(subscriptionId, tentativas = 6) {
  for (let i = 0; i < tentativas; i++) {
    const result = await asaasRequest(`/subscriptions/${subscriptionId}/payments`);
    if (result.data && result.data.length > 0) return result.data[0];
    await new Promise(r => setTimeout(r, 1000)); // espera um pouquinho e tenta de novo
  }
  return null;
}

// Gera um Pix copia-e-cola pra uma cobrança específica (usado se o cliente escolher Pix em vez de cartão)
function getPixQrCode(paymentId) {
  return asaasRequest(`/payments/${paymentId}/pixQrCode`);
}

module.exports = {
  asaasRequest,
  createAsaasCustomer,
  createAsaasSubscription,
  cancelAsaasSubscription,
  findFirstPaymentOfSubscription,
  getPixQrCode
};
