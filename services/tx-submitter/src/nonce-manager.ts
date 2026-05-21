import type { PublicClient, Address } from "viem";
import { logger } from "./logger";

/**
 * Local nonce manager for a single EOA.
 *
 * Why: viem's default `writeContract` fetches the pending nonce from the RPC
 * on every send. Under any concurrency that races — two sends grab the same
 * "next" nonce, the second one gets replaced or rejected with "nonce too low".
 * The standard production fix is a local counter plus a mutex so sends are
 * serialized through this module, and a reconcile path that rebases on the
 * chain's actual count whenever a send fails (e.g., we restarted, a manual
 * tx went out, or the chain reorg'd past our cursor).
 *
 * This is intentionally tiny — no retries, no fee bumping. Those belong in
 * the worker on top of the primitive this module gives you:
 *   `await manager.withNonce(async (n) => walletClient.writeContract({ ..., nonce: n }))`
 */
export class NonceManager {
  private next: bigint;
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly client: PublicClient,
    private readonly account: Address,
    initial: bigint
  ) {
    this.next = initial;
  }

  static async init(client: PublicClient, account: Address): Promise<NonceManager> {
    const pending = await client.getTransactionCount({
      address: account,
      blockTag: "pending",
    });
    logger.info({ account, nonce: pending }, "nonce-manager initialized");
    return new NonceManager(client, account, BigInt(pending));
  }

  /**
   * Serialize `fn` against every other in-flight send and pass it the nonce
   * it should use. On success the counter advances; on failure the counter
   * is reconciled with the chain and the error is re-thrown so the caller
   * (BullMQ) can retry.
   */
  async withNonce<T>(fn: (nonce: bigint) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      const n = this.next;
      try {
        const out = await fn(n);
        this.next = n + 1n;
        return out;
      } catch (err) {
        // Re-anchor against the chain so the next send doesn't compound the error.
        try {
          const live = await this.client.getTransactionCount({
            address: this.account,
            blockTag: "pending",
          });
          const previous = this.next;
          this.next = BigInt(live);
          logger.warn(
            { previous: previous.toString(), reconciled: this.next.toString(), err: (err as Error)?.message },
            "nonce-manager reconciled after send error"
          );
        } catch (reconcileErr) {
          logger.error({ reconcileErr }, "nonce-manager reconcile RPC call failed");
        }
        throw err;
      }
    };
    // Chain onto the previous task so withNonce calls run in submission order.
    const tail = this.queue.then(run, run);
    // Replace the queue tail with a never-rejecting promise so a single
    // failed send doesn't poison every subsequent caller.
    this.queue = tail.catch(() => undefined);
    return tail;
  }

  /** For diagnostics — the next nonce that will be used. */
  peek(): bigint {
    return this.next;
  }
}
