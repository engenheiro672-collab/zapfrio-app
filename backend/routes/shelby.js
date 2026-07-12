const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const supabaseAdmin = require('../config/supabaseAdmin');

// Monta o contexto de dados da empresa (só dela, nunca de outra) pra injetar no prompt da IA.
async function buildCompanyContext(companyId) {
  const { data: services } = await supabaseAdmin.from('services').select('*').eq('company_id', companyId);
  const { data: expenses } = await supabaseAdmin.from('expenses').select('*').eq('company_id', companyId);

  const concluidos = (services || []).filter(s => s.status === 'Concluído' || s.status === 'Garantia');
  const faturamento = concluidos.reduce((a, s) => a + Number(s.total_value || 0), 0);
  const custoPecas = concluidos.reduce((a, s) => a + Number(s.cost_value || 0), 0);
  const despesas = (expenses || []).filter(e => !e.is_entrada).reduce((a, e) => a + Number(e.value || 0), 0);
  const emGarantia = (services || []).filter(s => s.status === 'Garantia');

  return `
DADOS DA EMPRESA (use só isso, nunca invente números):
- Faturamento total (serviços concluídos): R$${faturamento.toFixed(2)}
- Custo de peças: R$${custoPecas.toFixed(2)}
- Despesas registradas: R$${despesas.toFixed(2)}
- Lucro líquido: R$${(faturamento - custoPecas - despesas).toFixed(2)}
- Total de OS: ${(services || []).length} (${concluidos.length} concluídas)
- Em garantia ativa: ${emGarantia.length}
- Serviços recentes: ${concluidos.slice(0, 10).map(s => `${s.client_name} — ${s.equipment} ${s.brand}, R$${s.total_value}, em ${new Date(s.completed_at || s.created_at).toLocaleDateString('pt-BR')}`).join('; ') || 'nenhum ainda'}
`;
}

// Função compartilhada: manda a mensagem (com ou sem foto) pra OpenAI e devolve a resposta.
// Usada tanto pelo chat de texto quanto pelo fluxo de voz (depois de transcrever o áudio).
async function getShelbyReply(company, message, imageBase64, history) {
  const context = await buildCompanyContext(company.id);

  const systemPrompt = `Você é a Shelby, assistente virtual de uma oficina de refrigeração chamada "${company.name}" dentro do sistema ZapFrio.

Você tem DOIS papéis:
1. Responder perguntas sobre os dados dessa empresa específica (faturamento, OS, clientes, garantias) — use SOMENTE os dados abaixo, nunca invente números, e nunca mencione dados de outra empresa (você não tem acesso a nenhuma outra).
2. Ser uma assistente técnica geral de refrigeração — ajudar a diagnosticar problemas em geladeiras, máquinas de lavar, ar-condicionado, câmaras frias, freezers, identificar equipamentos por foto (marca/modelo), e orientar o técnico sobre possíveis causas e próximos passos quando ele descrever um defeito.

Fale em português do Brasil, de forma natural e direta, como um colega experiente ajudando outro técnico. Seja objetiva mas simpática. Escreva como se estivesse falando em voz alta: frases curtas, sem markdown, sem listas com asteriscos, sem pontuação em excesso — só o jeito natural de alguém conversando.

${context}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...(history || []),
  ];

  if (imageBase64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: message || 'O que você identifica nessa foto?' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: message });
  }

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 600, temperature: 0.7 })
  });

  const data = await openaiRes.json();
  if (!openaiRes.ok) {
    console.error('[ZapFrio] Erro da OpenAI (chat):', data);
    throw new Error('A Shelby não conseguiu responder agora.');
  }

  const reply = data.choices?.[0]?.message?.content || 'Desculpa, não consegui pensar em uma resposta agora.';

  await supabaseAdmin.from('shelby_messages').insert([
    { company_id: company.id, role: 'user', content: message || '[foto enviada]' },
    { company_id: company.id, role: 'assistant', content: reply }
  ]);

  return reply;
}

// ── Chat por texto (e foto) ──
router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, imageBase64, history } = req.body;
    const reply = await getShelbyReply(req.company, message, imageBase64, history);
    res.json({ reply });
  } catch (err) {
    console.error('[ZapFrio] Erro no chat da Shelby:', err.message);
    res.status(500).json({ error: 'Não foi possível falar com a Shelby agora. Tente novamente.' });
  }
});

// ── Voz: recebe o áudio gravado, transcreve com o Whisper, e já devolve a resposta da Shelby ──
router.post('/voice', requireAuth, async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body;
    if (!audioBase64) return res.status(400).json({ error: 'Áudio não recebido.' });

    // Usa o formato real que o navegador gravou (varia entre navegadores — Safari não grava em webm, por exemplo)
    const tipo = mimeType || 'audio/webm';
    const extensao = tipo.includes('mp4') ? 'mp4' : tipo.includes('ogg') ? 'ogg' : tipo.includes('wav') ? 'wav' : 'webm';

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: tipo }), `audio.${extensao}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });
    const whisperData = await whisperRes.json();
    if (!whisperRes.ok) {
      console.error('[ZapFrio] Erro no Whisper:', whisperData);
      return res.status(500).json({ error: 'Não consegui entender o áudio agora. Tenta de novo.' });
    }

    const transcript = (whisperData.text || '').trim();
    if (!transcript) {
      return res.status(400).json({ error: 'Não consegui identificar nenhuma fala no áudio.' });
    }

    const reply = await getShelbyReply(req.company, transcript, null, []);
    res.json({ transcript, reply });
  } catch (err) {
    console.error('[ZapFrio] Erro no fluxo de voz da Shelby:', err.message);
    res.status(500).json({ error: 'Não foi possível processar o áudio agora. Tente novamente.' });
  }
});

module.exports = router;
