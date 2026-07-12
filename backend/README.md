# ZapFrio Backend

Esse é o servidor que cuida das duas únicas coisas que precisam ficar escondidas
do navegador: **pagamentos (Asaas)** e **a IA da Shelby (OpenAI)**. Tudo o mais
do painel do cliente (login, OS, financeiro, etc.) fala direto com o Supabase,
sem passar por aqui.

## 1. Instalar as dependências

Com o Node.js instalado no computador, abra o terminal dentro dessa pasta e rode:

```
npm install
```

## 2. Configurar as chaves

1. Copie o arquivo `.env.example` e renomeie a cópia pra `.env`
2. Abra o `.env` e preencha com seus dados reais:
   - `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Configurações → API — pegue a **service_role**, não a anon!)
   - `ASAAS_API_URL` e `ASAAS_API_KEY` (comece com a URL de sandbox pra testar)
   - `ASAAS_WEBHOOK_TOKEN` (o token que você gera ao criar o webhook no painel do Asaas)
   - `OPENAI_API_KEY` (sua chave da OpenAI)

⚠️ O arquivo `.env` **nunca** deve ser enviado pro GitHub — o `.gitignore` já está configurado pra ignorá-lo automaticamente.

## 3. Rodar localmente pra testar

```
npm start
```

Se aparecer `🧊 ZapFrio backend rodando na porta 3333`, deu certo. Abra
`http://localhost:3333` no navegador — deve aparecer "ZapFrio backend está no ar. ✅"

## 4. Testar o webhook localmente (opcional, com ngrok)

Enquanto ainda não publicou no Render, se quiser testar o webhook do Asaas
de verdade, instale o [ngrok](https://ngrok.com) e rode:

```
ngrok http 3333
```

Ele te dá uma URL pública temporária (tipo `https://abc123.ngrok.io`) que aponta
pro seu servidor local — cole essa URL + `/api/webhooks/asaas` no painel do Asaas.

## 5. Publicar no Render

1. Suba essa pasta `backend/` (dentro do repositório `zapfrio-app`) pro GitHub
2. No Render, crie um **Web Service** apontando pra esse repositório
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Em **Environment**, cole as mesmas variáveis do seu `.env` (o Render tem um
   campo próprio pra isso — nunca suba o `.env` em texto pro GitHub)
4. Quando publicar, você vai ganhar uma URL fixa tipo `https://zapfrio-backend.onrender.com`
   — é essa URL + `/api/webhooks/asaas` que você cola no painel do Asaas (Integrações → Webhooks)
   e é essa URL que o `zapfrio.html` (o frontend do cliente) vai chamar pra criar assinatura e falar com a Shelby.

## Rotas disponíveis

| Rota | O que faz |
|---|---|
| `POST /api/asaas/create-trial` | Ativa o teste grátis de 7 dias (com cartão salvo) |
| `POST /api/asaas/create-subscription` | Assina direto (mensal ou anual, cartão ou Pix) |
| `POST /api/webhooks/asaas` | Recebe os avisos do Asaas (pagamento confirmado/atrasado) |
| `POST /api/shelby/chat` | Conversa com a Shelby (IA), só com os dados da empresa logada |

Todas as rotas de `/api/asaas` e `/api/shelby` exigem que o frontend mande o
token de login do Supabase no cabeçalho `Authorization: Bearer <token>`.
