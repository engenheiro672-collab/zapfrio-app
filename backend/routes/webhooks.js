const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../config/supabaseAdmin');

// O Asaas manda um POST aqui toda vez que algo acontece com uma cobrança
// (confirmada, atrasada, estornada, etc.). A gente confirma que é o Asaas mesmo
// checando o token secreto que configuramos lá no painel deles, e atualiza o banco.
router.post('/asaas', express.json(), async (req, res) => {
  const tokenRecebido = req.headers['asaas-access-token'];
  if (tokenRecebido !== process.env.ASAAS_WEBHOOK_TOKEN) {
    console.warn('[ZapFrio] Webhook recebido com token inválido — ignorado.');
    return res.status(401).send('Token inválido.');
  }

  const { event, payment } = req.body;
  if (!payment) return res.status(200).send('OK (sem payment, nada a fazer)');

  try {
    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('asaas_customer_id', payment.customer)
      .single();

    if (!company) {
      console.warn('[ZapFrio] Webhook: nenhuma empresa encontrada pro customer', payment.customer);
      return res.status(200).send('OK (empresa não encontrada)');
    }

    // Registra a transação no histórico, sempre
    await supabaseAdmin.from('payments').insert([{
      company_id: company.id,
      asaas_payment_id: payment.id,
      value: payment.value,
      billing_type: payment.billingType,
      status: payment.status,
      due_date: payment.dueDate,
      paid_at: payment.paymentDate || null
    }]);

    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
      const wasTrial = company.subscription_status === 'trial';
      const novaDataFim = new Date();
      if (company.plan === 'anual') novaDataFim.setFullYear(novaDataFim.getFullYear() + 1);
      else novaDataFim.setMonth(novaDataFim.getMonth() + 1);

      await supabaseAdmin.from('companies').update({
        subscription_status: 'ativo',
        subscription_ends_at: novaDataFim.toISOString(),
        plan: company.plan === 'trial' ? 'mensal' : company.plan
      }).eq('id', company.id);

      await supabaseAdmin.from('admin_notifications').insert([{
        company_id: company.id,
        type: wasTrial ? 'payment_success' : 'payment_success',
        message: `${company.name}: pagamento confirmado (R$${payment.value}).`,
        needs_action: false
      }]);
    }

    if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED') {
      const wasTrial = company.subscription_status === 'trial';
      await supabaseAdmin.from('companies').update({
        subscription_status: 'vencido'
      }).eq('id', company.id);

      await supabaseAdmin.from('admin_notifications').insert([{
        company_id: company.id,
        type: wasTrial ? 'payment_failed_trial' : 'payment_failed_sub',
        message: event === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
          ? `${company.name}: o cartão foi recusado. ${wasTrial ? 'O teste grátis vai acabar' : 'A assinatura vai vencer'} se não regularizar.`
          : `${company.name}: a cobrança não foi paga e ${wasTrial ? 'o teste grátis acabou' : 'a assinatura venceu'}. Entre em contato.`,
        contact: company.phone,
        needs_action: true
      }]);
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[ZapFrio] Erro ao processar webhook do Asaas:', err.message);
    res.status(200).send('OK (erro registrado no log, mas confirmando recebimento pro Asaas não reenviar)');
  }
});

module.exports = router;
