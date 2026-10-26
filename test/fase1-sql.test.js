/**
 * Confere o SQL num Postgres de verdade (o Supabase falso não executa SQL).
 * Só roda com PG_TEST_URL definido, ex:
 *   PG_TEST_URL=postgres://postgres@127.0.0.1:54329/postgres npm test
 * Tudo acontece num schema temporário, apagado no fim.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const LEGACY_INIT = read("test/sql/legacy-init.sql");
const INIT = read("init.sql");
const MIGRATION = read("migrations/2026-10-26_multiusuario.sql");
const ROLLBACK = read("migrations/2026-10-26_multiusuario.rollback.sql");

const skip = process.env.PG_TEST_URL ? false : "PG_TEST_URL não definido";
const schema = `arcanjo_test_${process.pid}`;
let client;

before(async () => {
  if (skip) return;
  client = new pg.Client({ connectionString: process.env.PG_TEST_URL });
  await client.connect();
  await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};`);
});

after(async () => {
  if (skip) return;
  await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await client.end();
});

async function columns(table) {
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2",
    [schema, table]
  );
  return rows.map((r) => r.column_name);
}

async function rejects(sql, params, pattern) {
  await client.query("SAVEPOINT t");
  await assert.rejects(client.query(sql, params), pattern);
  await client.query("ROLLBACK TO SAVEPOINT t");
}

test("migração sobre um banco antigo, com dados, rodando init.sql duas vezes", { skip }, async () => {
  await client.query(LEGACY_INIT);
  await client.query(`
    INSERT INTO sessions (id, title, provider, phone) VALUES ('s1', 'WhatsApp', 'anthropic', '5511999999999');
    INSERT INTO messages (id, session_id, role, content) VALUES ('m1', 's1', 'user', 'oi'), ('m2', 's1', 'assistant', 'olá');
    INSERT INTO crm_cases (id, phone, client_name) VALUES ('c1', '5511999999999', 'Cliente');
  `);

  await client.query(INIT);
  await client.query(INIT); // idempotente
  await client.query(MIGRATION); // o arquivo avulso também

  const { rows: legacy } = await client.query("SELECT count(*)::int AS n FROM messages");
  assert.equal(legacy[0].n, 2, "nenhum dado existente foi apagado");
  const { rows: s } = await client.query("SELECT ai_paused FROM sessions WHERE id = 's1'");
  assert.equal(s[0].ai_paused, false, "conversas existentes começam com a IA ativa");

  assert.deepEqual(
    (await columns("users")).sort(),
    ["active", "created_at", "email", "id", "name", "password_hash", "role", "updated_at"]
  );
  for (const col of ["ai_paused", "ai_paused_at", "handler_user_id"]) assert.ok((await columns("sessions")).includes(col), col);
  for (const col of ["sender_user_id", "delivery_status", "delivery_error", "wa_message_id"]) {
    assert.ok((await columns("messages")).includes(col), col);
  }
  for (const col of ["assigned_to", "assigned_at", "status_changed_by", "status_changed_by_name", "status_changed_at"]) {
    assert.ok((await columns("crm_cases")).includes(col), col);
  }

  // Rodar duas vezes não duplica constraints (ADD COLUMN IF NOT EXISTS ... REFERENCES).
  // (uma duplicata ganharia outro nome, ex: "_fkey1" — por isso agrupa pela definição)
  const { rows: fks } = await client.query(
    `SELECT conrelid::regclass::text AS t, pg_get_constraintdef(oid) AS def, count(*)::int AS n FROM pg_constraint
     WHERE connamespace = $1::regnamespace AND contype IN ('f', 'c') GROUP BY 1, 2 HAVING count(*) > 1`,
    [schema]
  );
  assert.deepEqual(fks, []);
  const { rows: roleChecks } = await client.query(
    `SELECT count(*)::int AS n FROM pg_constraint
     WHERE conrelid = 'messages'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%(role%'`
  );
  assert.equal(roleChecks[0].n, 1, "só um CHECK de role em messages");
});

test("regras do schema novo", { skip }, async () => {
  await client.query("BEGIN");
  try {
    await client.query(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES ('u1', 'Ana', 'Ana@Escritorio.com', 'h', 'admin')"
    );
    await rejects(
      "INSERT INTO users (id, name, email, password_hash) VALUES ('u2', 'Ana 2', 'ana@escritorio.com', 'h')",
      [],
      /idx_users_email_lower/
    );
    await rejects("INSERT INTO users (id, name, email, password_hash, role) VALUES ('u3', 'X', 'x@x', 'h', 'dono')", [], /check/i);

    await client.query("INSERT INTO messages (id, session_id, role, content, sender_user_id, delivery_status) VALUES ('m3', 's1', 'human', 'oi, aqui é a Ana', 'u1', 'failed')");
    await rejects("INSERT INTO messages (id, session_id, role, content) VALUES ('m4', 's1', 'robo', 'x')", [], /messages_role_check/);
    await rejects(
      "INSERT INTO messages (id, session_id, role, content, delivery_status) VALUES ('m5', 's1', 'human', 'x', 'perdida')",
      [],
      /check/i
    );

    await rejects("INSERT INTO case_events (id, case_id, type) VALUES ('e0', 'c1', 'arquivado')", [], /check/i);
    await client.query("INSERT INTO case_events (id, case_id, user_id, actor_name, type, from_value, to_value) VALUES ('e1', 'c1', 'u1', 'Ana', 'moved', 'Novo caso', 'Em análise')");
    await client.query("INSERT INTO case_events (id, case_id, actor_name, type) VALUES ('e2', 'caso-que-nao-existe', 'Ana', 'deleted')");

    await client.query("UPDATE sessions SET ai_paused = true, handler_user_id = 'u1' WHERE id = 's1'");
    await client.query("UPDATE crm_cases SET assigned_to = 'u1', status_changed_by = 'u1' WHERE id = 'c1'");
    await client.query("INSERT INTO web_sessions (sid, sess, expire, user_id) VALUES ('sid1', '{}', now() + interval '1 day', 'u1')");

    // Excluir um usuário (só acontece se ele não tiver histórico, mas o banco aguenta):
    await client.query("DELETE FROM users WHERE id = 'u1'");
    const { rows } = await client.query(`
      SELECT (SELECT handler_user_id FROM sessions WHERE id = 's1') AS handler,
             (SELECT assigned_to FROM crm_cases WHERE id = 'c1') AS assigned,
             (SELECT sender_user_id FROM messages WHERE id = 'm3') AS sender,
             (SELECT user_id FROM case_events WHERE id = 'e1') AS event_user,
             (SELECT actor_name FROM case_events WHERE id = 'e1') AS event_name,
             (SELECT count(*)::int FROM web_sessions) AS web_sessions`);
    assert.deepEqual(rows[0], {
      handler: null, assigned: null, sender: null, event_user: null, event_name: "Ana", web_sessions: 0,
    });
  } finally {
    await client.query("ROLLBACK");
  }
});

test("rollback desfaz tudo sem perder mensagens humanas, e a migração pode rodar de novo", { skip }, async () => {
  await client.query("INSERT INTO messages (id, session_id, role, content) VALUES ('m9', 's1', 'human', 'mensagem da equipe')");
  await client.query(ROLLBACK);

  const { rows } = await client.query("SELECT role, content FROM messages WHERE id = 'm9'");
  assert.deepEqual(rows[0], { role: "assistant", content: "mensagem da equipe" });
  assert.deepEqual(await columns("users"), []);
  assert.deepEqual(await columns("case_events"), []);
  assert.ok(!(await columns("sessions")).includes("ai_paused"));
  assert.ok(!(await columns("messages")).includes("delivery_status"));
  await assert.rejects(
    client.query("INSERT INTO messages (id, session_id, role, content) VALUES ('m10', 's1', 'human', 'x')"),
    /messages_role_check/
  );

  await client.query(INIT);
  assert.ok((await columns("users")).includes("email"));
});
