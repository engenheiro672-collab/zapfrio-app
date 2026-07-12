const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supabaseAdmin = require('../config/supabaseAdmin');
const { createAsaasCustomer, createAsaasSubscription, findFirstPaymentOfSubscription, getPixQrCode } = require('../utils/asaasClient');

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]; // formato YYYY-MM-DD que o Asaas espera
}

// Garante que a empresa já tem um cliente criado no Asaas (cria na primeira vez, reaproveita depois)
async function ensureAsaasCustomer(company, { nome, cpfCnpj }) {
  if (company.asaas_customer_id) return company.asaas_customer_id;

  const customer = await createAsaasCustomer({
    name: nome || company.name,
    email: company.email,
    cpfCnpj,
    phone: company.phone
  });

  await supabaseAdmin.from('companies').update({ asaas_customer_id: customer.id }).eq('id', company.id);
  return customer.id;
}

// ── Ativar teste grátis de 7 dias (precisa de cartão salvo, cobrança só depois de 7 dias) ──
router.post('/create-trial', requireAuth, async (req, res) => {
  try {
    const { nomeCompleto, cpfCnpj, creditCard, creditCardHolderInfo } = req.body;
    const company = req.company;

    const customerId = await ensureAsaasCustomer(company, { nome: nomeCompleto, cpfCnpj });

    const subscription = await createAsaasSubscription({
      customerId,
      value: 197,
      cycle: 'MONTHLY',
      billingType: 'CREDIT_CARD',
      nextDueDate: addDays(new Date(), 7), // só cobra depois dos 7 dias de trial
      description: 'ZapFrio — Plano Mensal (após teste grátis)',
      creditCard,
      creditCardHolderInfo
    });

    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 7);

    await supabaseAdmin.from('companies').update({
      plan: 'trial',
      subscription_status: 'trial',
      trial_ends_at: trialEndsAt.toISOString(),
      asaas_subscription_id: subscription.id
    }).eq('id', company.id);

    res.json({ success: true, trialEndsAt: trialEndsAt.toISOString() });
  } catch (err) {
    console.error('[ZapFrio] Erro ao criar trial:', err.details || err.message);
    res.status(500).json({ error: 'Não foi possível ativar o teste grátis agora. Tente novamente.' });
  }
});

// ── Assinar direto (mensal ou anual, cartão ou Pix) ──
router.post('/create-subscription', requireAuth, async (req, res) => {
  try {
    const { plano, nomeCompleto, cpfCnpj, metodoPagamento, creditCard, creditCardHolderInfo } = req.body;
    const company = req.company;

    if (!['mensal', 'anual'].includes(plano)) {
      return res.status(400).json({ error: 'Plano inválido.' });
    }

    const customerId = await ensureAsaasCustomer(company, { nome: nomeCompleto, cpfCnpj });
    const value = plano === 'anual' ? 897 : 197;
    const cycle = plano === 'anual' ? 'YEARLY' : 'MONTHLY';
    const billingType = metodoPagamento === 'pix' ? 'PIX' : 'CREDIT_CARD';

    const subscription = await createAsaasSubscription({
      customerId,
      value,
      cycle,
      billingType,
      nextDueDate: addDays(new Date(), 0), // cobra hoje mesmo, sem trial
      description: `ZapFrio — Plano ${plano === 'anual' ? 'Anual' : 'Mensal'}`,
      creditCard,
      creditCardHolderInfo
    });

    const subscriptionEndsAt = new Date();
    if (plano === 'anual') subscriptionEndsAt.setFullYear(subscriptionEndsAt.getFullYear() + 1);
    else subscriptionEndsAt.setMonth(subscriptionEndsAt.getMonth() + 1);

    let pix = null;
    if (billingType === 'PIX') {
      // Pix não confirma na hora — o acesso só é liberado de verdade quando o webhook
      // avisar que o pagamento caiu. Aqui só guardamos o ID da assinatura, sem marcar como "ativo".
      await supabaseAdmin.from('companies').update({
        plan: plano,
        asaas_subscription_id: subscription.id
      }).eq('id', company.id);

      // O ID da assinatura não serve pra pegar o QR code — precisamos achar a cobrança (payment)
      // que o Asaas gerou automaticamente a partir dessa assinatura.
      const payment = await findFirstPaymentOfSubscription(subscription.id);
      if (!payment) {
        return res.status(500).json({ error: 'Não conseguimos gerar o Pix agora. Tente novamente em instantes.' });
      }
      pix = await getPixQrCode(payment.id);
    } else {
      // Cartão: o Asaas já tenta cobrar na hora da criação — se chegou até aqui sem erro, foi aprovado.
      await supabaseAdmin.from('companies').update({
        plan: plano,
        subscription_status: 'ativo',
        subscription_ends_at: subscriptionEndsAt.toISOString(),
        asaas_subscription_id: subscription.id
      }).eq('id', company.id);
    }

    res.json({ success: true, subscriptionEndsAt: subscriptionEndsAt.toISOString(), pix, aguardandoPix: billingType==='PIX' });
  } catch (err) {
    console.error('[ZapFrio] Erro ao criar assinatura:', err.details || err.message);
    res.status(500).json({ error: 'Não foi possível concluir a assinatura agora. Tente novamente.' });
  }
});

module.exports = router;
