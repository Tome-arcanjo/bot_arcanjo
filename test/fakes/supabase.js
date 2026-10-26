/**
 * Supabase falso para os testes — substitui "@supabase/supabase-js" via o
 * loader em test/support/loader.mjs (o código de produção não sabe que existe).
 *
 * Implementa só o subconjunto do query builder que o app usa. O "banco" é um
 * arquivo JSON (FAKE_DB_FILE) relido/regravado a cada operação, para que o
 * processo de teste consiga semear e inspecionar o estado do servidor, que
 * roda em outro processo.
 *
 * Diferenças conhecidas em relação ao PostgREST real: não valida colunas nem
 * CHECKs, ignora a projeção do select (sempre devolve a linha inteira) e não
 * resolve recursos embutidos (ex: "sessions ( id )").
 */
import fs from "fs";

const PRIMARY_KEYS = { clients: "phone", web_sessions: "sid", bot_settings: "id" };
const UNIQUE_COLUMNS = { users: ["email"] };

function load() {
  try {
    return JSON.parse(fs.readFileSync(process.env.FAKE_DB_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(db) {
  fs.writeFileSync(process.env.FAKE_DB_FILE, JSON.stringify(db, null, 2));
}

function pkOf(table) {
  return PRIMARY_KEYS[table] || "id";
}

function likeToRegex(pattern) {
  const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1; // nulls por último
  if (b === null || b === undefined) return -1;
  return a < b ? -1 : 1;
}

function makeFilter(column, op, value) {
  switch (op) {
    case "eq": return (r) => r[column] === value;
    case "neq": return (r) => r[column] !== value;
    case "lt": return (r) => r[column] != null && r[column] < value;
    case "lte": return (r) => r[column] != null && r[column] <= value;
    case "gt": return (r) => r[column] != null && r[column] > value;
    case "gte": return (r) => r[column] != null && r[column] >= value;
    case "in": return (r) => value.includes(r[column]);
    case "is": return (r) => (value === null ? r[column] == null : r[column] === value);
    case "ilike": return (r) => r[column] != null && likeToRegex(value).test(r[column]);
    default: throw new Error(`[FakeSupabase] operador não suportado: ${op}`);
  }
}

class Query {
  constructor(table) {
    this.table = table;
    this.action = "select";
    this.filters = [];
    this.orders = [];
    this.returning = false;
    this.count = null;
    this.head = false;
    this.limitN = null;
    this.rangeFrom = null;
    this.singleMode = null;
  }

  select(_columns = "*", opts = {}) {
    if (this.action === "select") {
      this.count = opts.count || null;
      this.head = Boolean(opts.head);
    } else {
      this.returning = true;
    }
    return this;
  }

  insert(rows) { this.action = "insert"; this.payload = [].concat(rows); return this; }
  update(values) { this.action = "update"; this.payload = values; return this; }
  delete() { this.action = "delete"; return this; }
  upsert(rows, opts = {}) {
    this.action = "upsert";
    this.payload = [].concat(rows);
    this.onConflict = opts.onConflict || pkOf(this.table);
    return this;
  }

  eq(c, v) { this.filters.push(makeFilter(c, "eq", v)); return this; }
  neq(c, v) { this.filters.push(makeFilter(c, "neq", v)); return this; }
  lt(c, v) { this.filters.push(makeFilter(c, "lt", v)); return this; }
  lte(c, v) { this.filters.push(makeFilter(c, "lte", v)); return this; }
  gt(c, v) { this.filters.push(makeFilter(c, "gt", v)); return this; }
  gte(c, v) { this.filters.push(makeFilter(c, "gte", v)); return this; }
  in(c, v) { this.filters.push(makeFilter(c, "in", v)); return this; }
  is(c, v) { this.filters.push(makeFilter(c, "is", v)); return this; }
  ilike(c, v) { this.filters.push(makeFilter(c, "ilike", v)); return this; }
  not(c, op, v) {
    const f = makeFilter(c, op, v);
    this.filters.push((r) => !f(r));
    return this;
  }
  // Só o formato usado no app: "col.op.valor,col.op.valor"
  or(expr) {
    const parts = expr.split(",").map((p) => {
      const [col, op, ...rest] = p.split(".");
      return makeFilter(col, op, rest.join("."));
    });
    this.filters.push((r) => parts.some((f) => f(r)));
    return this;
  }

  order(column, opts = {}) {
    this.orders.push({ column, ascending: opts.ascending !== false });
    return this;
  }
  limit(n) { this.limitN = n; return this; }
  range(from, to) { this.rangeFrom = from; this.limitN = to - from + 1; return this; }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }

  then(resolve, reject) {
    let result;
    try {
      result = this.execute();
    } catch (error) {
      result = { data: null, error: { message: error.message } };
    }
    return Promise.resolve(result).then(resolve, reject);
  }

  matches(row) {
    return this.filters.every((f) => f(row));
  }

  execute() {
    const db = load();
    const rows = db[this.table] || (db[this.table] = []);
    let affected;

    if (this.action === "select") {
      affected = rows.filter((r) => this.matches(r));
    } else if (this.action === "insert" || this.action === "upsert") {
      affected = [];
      const now = new Date().toISOString();
      for (const input of this.payload) {
        const row = { created_at: now, updated_at: now, ...input };
        const pk = this.action === "upsert" ? this.onConflict : pkOf(this.table);
        const existing = row[pk] !== undefined ? rows.find((r) => r[pk] === row[pk]) : null;
        if (existing && this.action === "upsert") {
          Object.assign(existing, input);
          affected.push(existing);
          continue;
        }
        if (existing) return duplicate(this.table, pk);
        for (const col of UNIQUE_COLUMNS[this.table] || []) {
          if (row[col] != null && rows.some((r) => r[col] === row[col])) return duplicate(this.table, col);
        }
        rows.push(row);
        affected.push(row);
      }
      save(db);
    } else if (this.action === "update") {
      affected = rows.filter((r) => this.matches(r));
      for (const col of UNIQUE_COLUMNS[this.table] || []) {
        if (this.payload[col] == null) continue;
        if (rows.some((r) => r[col] === this.payload[col] && !affected.includes(r))) return duplicate(this.table, col);
      }
      for (const r of affected) Object.assign(r, this.payload);
      save(db);
    } else if (this.action === "delete") {
      affected = rows.filter((r) => this.matches(r));
      db[this.table] = rows.filter((r) => !affected.includes(r));
      save(db);
    }

    affected = JSON.parse(JSON.stringify(affected)); // nunca vaza referência interna
    const total = affected.length;

    if (this.orders.length) {
      affected.sort((a, b) => {
        for (const { column, ascending } of this.orders) {
          const c = compare(a[column], b[column]);
          if (c !== 0) return ascending ? c : -c;
        }
        return 0;
      });
    }
    if (this.rangeFrom !== null) affected = affected.slice(this.rangeFrom);
    if (this.limitN !== null) affected = affected.slice(0, this.limitN);

    const count = this.count ? total : null;
    if (this.action !== "select" && !this.returning) return { data: null, error: null, count };
    if (this.head) return { data: null, error: null, count };

    if (this.singleMode) {
      if (affected.length > 1) {
        return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple rows returned" } };
      }
      if (affected.length === 0) {
        return this.singleMode === "maybe"
          ? { data: null, error: null, count }
          : { data: null, error: { code: "PGRST116", message: "JSON object requested, 0 rows returned" } };
      }
      return { data: affected[0], error: null, count };
    }
    return { data: affected, error: null, count };
  }
}

function duplicate(table, column) {
  return {
    data: null,
    error: { code: "23505", message: `duplicate key value violates unique constraint "${table}_${column}_key"` },
  };
}

export function createClient() {
  return { from: (table) => new Query(table) };
}
