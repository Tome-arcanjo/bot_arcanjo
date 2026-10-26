// Simula um cliente mandando uma mensagem de WhatsApp: monta o mesmo payload
// que a Meta envia, assina com WHATSAPP_APP_SECRET do .env e faz o POST no
// webhook. Serve para testar o fluxo completo (IA, CRM, atendimento humano)
// antes de existir o número de produção.
//
// Uso: node scripts/simular-mensagem.js 5511999999999 "Olá, fui demitido" [--nome "Maria"] [--url http://localhost:3000]
import "dotenv/config";
import crypto from "crypto";

const args = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const [, value] = args.splice(i, 2);
  return value;
}

const url = option("url", `http://localhost:${process.env.PORT || 3000}`);
const name = option("nome", "Cliente de teste");
const [phone, text] = args;
const secret = process.env.WHATSAPP_APP_SECRET;

if (!phone || !text) {
  console.error('Uso: node scripts/simular-mensagem.js 5511999999999 "texto da mensagem" [--nome "Maria"] [--url http://localhost:3000]');
  process.exit(1);
}
if (!secret) {
  console.error("WHATSAPP_APP_SECRET não está no .env — o webhook recusa mensagens sem assinatura.");
  process.exit(1);
}

const from = phone.replace(/\D/g, "");
const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{
    id: "SIMULADO",
    changes: [{
      field: "messages",
      value: {
        messaging_product: "whatsapp",
        contacts: [{ wa_id: from, profile: { name } }],
        messages: [{ from, id: `wamid.simulado.${Date.now()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
      },
    }],
  }],
});
const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(`${url}/webhook/whatsapp`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": signature },
  body,
});
console.log(res.status === 200 ? `Mensagem de ${from} entregue ao webhook (${url}).` : `O webhook respondeu ${res.status}.`);
process.exit(res.status === 200 ? 0 : 1);
