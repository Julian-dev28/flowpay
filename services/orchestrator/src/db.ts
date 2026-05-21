import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type IntentStatus =
  | "queued"
  | "submitting"
  | "submitted"
  | "settled"
  | "failed";

export type PaymentIntentRow = {
  id: string;
  idempotency_key: string | null;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  deadline: string;
  signature: string;
  status: IntentStatus;
  job_id: string | null;
  tx_hash: string | null;
  failure_reason: string | null;
  created_at: number;
  updated_at: number;
};

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_intents (
      id              TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      payer           TEXT NOT NULL,
      merchant        TEXT NOT NULL,
      token           TEXT NOT NULL,
      amount          TEXT NOT NULL,
      nonce           TEXT NOT NULL,
      deadline        TEXT NOT NULL,
      signature       TEXT NOT NULL,
      status          TEXT NOT NULL,
      job_id          TEXT,
      tx_hash         TEXT,
      failure_reason  TEXT,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_intents_payer ON payment_intents (payer, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_intents_nonce ON payment_intents (payer, nonce);
    CREATE INDEX IF NOT EXISTS idx_intents_status ON payment_intents (status);
  `);

  const stmts = {
    findByIdempotency: db.prepare(
      `SELECT * FROM payment_intents WHERE idempotency_key = ?`
    ),
    findById: db.prepare(`SELECT * FROM payment_intents WHERE id = ?`),
    listByPayer: db.prepare(
      `SELECT * FROM payment_intents
       WHERE lower(payer) = lower(?)
       ORDER BY created_at DESC
       LIMIT ?`
    ),
    insert: db.prepare(`
      INSERT INTO payment_intents
        (id, idempotency_key, payer, merchant, token, amount, nonce, deadline, signature,
         status, job_id, tx_hash, failure_reason, created_at, updated_at)
      VALUES
        (@id, @idempotency_key, @payer, @merchant, @token, @amount, @nonce, @deadline, @signature,
         @status, @job_id, @tx_hash, @failure_reason, @created_at, @updated_at)
    `),
    updateStatus: db.prepare(`
      UPDATE payment_intents
      SET status = @status,
          tx_hash = COALESCE(@tx_hash, tx_hash),
          failure_reason = COALESCE(@failure_reason, failure_reason),
          updated_at = @updated_at
      WHERE id = @id
    `),
  };

  return {
    db,
    findByIdempotency(key: string): PaymentIntentRow | undefined {
      return stmts.findByIdempotency.get(key) as PaymentIntentRow | undefined;
    },
    findById(id: string): PaymentIntentRow | undefined {
      return stmts.findById.get(id) as PaymentIntentRow | undefined;
    },
    listByPayer(payer: string, limit: number): PaymentIntentRow[] {
      return stmts.listByPayer.all(payer, limit) as PaymentIntentRow[];
    },
    insert(row: PaymentIntentRow) {
      stmts.insert.run(row);
    },
    updateStatus(input: {
      id: string;
      status: IntentStatus;
      txHash?: string | null;
      failureReason?: string | null;
    }) {
      stmts.updateStatus.run({
        id: input.id,
        status: input.status,
        tx_hash: input.txHash ?? null,
        failure_reason: input.failureReason ?? null,
        updated_at: Date.now(),
      });
    },
    close() {
      db.close();
    },
  };
}

export type OrchestratorDb = ReturnType<typeof openDb>;
