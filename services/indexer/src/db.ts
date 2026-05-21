import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type SettledEventRow = {
  order_hash: string;
  payer: string;
  merchant: string;
  token: string;
  amount: string;
  nonce: string;
  tx_hash: string;
  block_number: string;
  log_index: number;
  chain_id: number;
  indexed_at: number;
};

export type CursorRow = { chain_id: number; last_block: string };

export function openDb(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settled_events (
      order_hash    TEXT NOT NULL,
      payer         TEXT NOT NULL,
      merchant      TEXT NOT NULL,
      token         TEXT NOT NULL,
      amount        TEXT NOT NULL,
      nonce         TEXT NOT NULL,
      tx_hash       TEXT NOT NULL,
      block_number  TEXT NOT NULL,
      log_index     INTEGER NOT NULL,
      chain_id      INTEGER NOT NULL,
      indexed_at    INTEGER NOT NULL,
      PRIMARY KEY (chain_id, tx_hash, log_index)
    );

    CREATE INDEX IF NOT EXISTS idx_events_payer ON settled_events (chain_id, payer);
    CREATE INDEX IF NOT EXISTS idx_events_merchant ON settled_events (chain_id, merchant);
    CREATE INDEX IF NOT EXISTS idx_events_nonce ON settled_events (chain_id, payer, nonce);
    CREATE INDEX IF NOT EXISTS idx_events_block ON settled_events (chain_id, block_number);

    CREATE TABLE IF NOT EXISTS sync_cursor (
      chain_id    INTEGER PRIMARY KEY,
      last_block  TEXT NOT NULL
    );
  `);

  const stmts = {
    insertEvent: db.prepare(`
      INSERT OR IGNORE INTO settled_events
        (order_hash, payer, merchant, token, amount, nonce, tx_hash, block_number, log_index, chain_id, indexed_at)
      VALUES
        (@order_hash, @payer, @merchant, @token, @amount, @nonce, @tx_hash, @block_number, @log_index, @chain_id, @indexed_at)
    `),
    listEvents: db.prepare(`
      SELECT * FROM settled_events
      WHERE chain_id = @chain_id
        AND (@payer IS NULL OR lower(payer) = lower(@payer))
        AND (@merchant IS NULL OR lower(merchant) = lower(@merchant))
      ORDER BY CAST(block_number AS INTEGER) DESC, log_index DESC
      LIMIT @limit
    `),
    countEvents: db.prepare(`
      SELECT COUNT(*) AS n FROM settled_events WHERE chain_id = @chain_id
    `),
    findByNonce: db.prepare(`
      SELECT * FROM settled_events
      WHERE chain_id = @chain_id AND lower(payer) = lower(@payer) AND nonce = @nonce
      LIMIT 1
    `),
    getCursor: db.prepare(`SELECT last_block FROM sync_cursor WHERE chain_id = ?`),
    setCursor: db.prepare(`
      INSERT INTO sync_cursor (chain_id, last_block) VALUES (?, ?)
      ON CONFLICT (chain_id) DO UPDATE SET last_block = excluded.last_block
    `),
  };

  return {
    db,
    insertEvent(row: SettledEventRow) {
      stmts.insertEvent.run(row);
    },
    listEvents(opts: {
      chainId: number;
      payer?: string;
      merchant?: string;
      limit: number;
    }): SettledEventRow[] {
      return stmts.listEvents.all({
        chain_id: opts.chainId,
        payer: opts.payer ?? null,
        merchant: opts.merchant ?? null,
        limit: opts.limit,
      }) as SettledEventRow[];
    },
    countEvents(chainId: number): number {
      const r = stmts.countEvents.get({ chain_id: chainId }) as { n: number };
      return r.n;
    },
    findByNonce(chainId: number, payer: string, nonce: string): SettledEventRow | undefined {
      return stmts.findByNonce.get({ chain_id: chainId, payer, nonce }) as
        | SettledEventRow
        | undefined;
    },
    getCursor(chainId: number): bigint | null {
      const r = stmts.getCursor.get(chainId) as { last_block: string } | undefined;
      return r ? BigInt(r.last_block) : null;
    },
    setCursor(chainId: number, blockNumber: bigint) {
      stmts.setCursor.run(chainId, blockNumber.toString());
    },
    close() {
      db.close();
    },
  };
}

export type IndexerDb = ReturnType<typeof openDb>;
