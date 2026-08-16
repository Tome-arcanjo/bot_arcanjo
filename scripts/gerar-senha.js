// Gera o hash bcrypt de uma senha para usar em ADMIN_PASSWORD_HASH no .env.
// Uso: node scripts/gerar-senha.js "sua_senha_aqui"
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error("Uso: node scripts/gerar-senha.js \"sua_senha_aqui\"");
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

console.log("\nAdicione (ou substitua) esta linha no seu .env:\n");
console.log(`ADMIN_PASSWORD_HASH=${hash}\n`);
