/**
 * Compute-unit (CU) benchmark for the escrow program.
 *
 * For a Solana program the meaningful, deterministic cost metric is compute
 * units — the runtime's per-instruction meter (200k CU/ix budget by default).
 * CU drives priority fees, so lower CU = cheaper transactions for users. This
 * script exercises each instruction over a few fresh escrow lifecycles and
 * reads the per-invocation CU straight out of the transaction logs
 * ("Program <id> consumed N of 200000 compute units"), cross-checked against
 * the runtime's `meta.computeUnitsConsumed` (whole-tx) and the lamport fee.
 *
 * Prereqs (same as the CLI / tests): a running `solana-test-validator` with the
 * program deployed (`anchor deploy`) and a funded default wallet. Uses Anchor's
 * env provider, so it honours ANCHOR_PROVIDER_URL / ANCHOR_WALLET.
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=http://localhost:8899 \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/benchmark.ts [iterations=5]
 *
 * Or via the npm script (defaults wired in):  yarn bench
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SolanaEscrow } from "../target/types/solana_escrow";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.solanaEscrow as Program<SolanaEscrow>;
const connection = provider.connection;
const initializer = provider.wallet;

const ITERATIONS = Math.max(1, Number(process.argv[2] ?? 5));

// ─── helpers ────────────────────────────────────────────────────────────────

let seedCounter = Math.floor(Date.now() / 1000) * 1000; // avoid PDA collisions across runs
const nextSeed = () => new BN(++seedCounter);

const deriveEscrow = (recipient: PublicKey, seed: BN) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      initializer.publicKey.toBuffer(),
      recipient.toBuffer(),
      seed.toArrayLike(Buffer, "le", 8),
    ],
    program.programId,
  )[0];

const futureExpiry = (secondsFromNow = 3600) =>
  new BN(Math.floor(Date.now() / 1000) + secondsFromNow);

type Sample = { programCU: number; totalCU: number; feeLamports: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Pull the program's own CU consumption out of the confirmed tx logs. Falls
// back to the whole-tx figure if the per-program line isn't present.
// `.rpc()` resolves at the provider's commitment, but getTransaction can lag a
// beat behind it, so retry the fetch before giving up.
const measure = async (sig: string): Promise<Sample> => {
  let tx = null;
  for (let attempt = 0; attempt < 10 && (!tx || !tx.meta); attempt++) {
    if (attempt > 0) await sleep(300);
    tx = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  }
  if (!tx || !tx.meta) throw new Error(`could not fetch tx ${sig}`);

  const totalCU = tx.meta.computeUnitsConsumed ?? 0;
  const feeLamports = tx.meta.fee ?? 0;

  let programCU = totalCU;
  const pid = program.programId.toBase58();
  for (const line of tx.meta.logMessages ?? []) {
    const m = line.match(
      new RegExp(`Program ${pid} consumed (\\d+) of \\d+ compute units`),
    );
    if (m) programCU = Number(m[1]);
  }
  return { programCU, totalCU, feeLamports };
};

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const min = (xs: number[]) => Math.min(...xs);
const max = (xs: number[]) => Math.max(...xs);

// ─── per-instruction drivers (each returns the tx signature) ──────────────────

const init = (recipient: PublicKey, seed: BN, amount: BN, expiry: BN) =>
  program.methods
    .initialize(seed, amount, expiry)
    .accountsStrict({
      initializer: initializer.publicKey,
      recipient,
      escrow: deriveEscrow(recipient, seed),
      systemProgram: SystemProgram.programId,
    })
    .rpc();

const fund = (recipient: PublicKey, seed: BN) =>
  program.methods
    .fund(seed)
    .accountsStrict({
      initializer: initializer.publicKey,
      recipient,
      escrow: deriveEscrow(recipient, seed),
      systemProgram: SystemProgram.programId,
    })
    .rpc();

const release = (recipient: PublicKey, seed: BN) =>
  program.methods
    .release(seed)
    .accountsStrict({
      initializer: initializer.publicKey,
      recipient,
      escrow: deriveEscrow(recipient, seed),
    })
    .rpc();

const cancel = (recipient: PublicKey, seed: BN) =>
  program.methods
    .cancel(seed)
    .accountsStrict({
      initializer: initializer.publicKey,
      recipient,
      escrow: deriveEscrow(recipient, seed),
    })
    .rpc();

// ─── benchmark ────────────────────────────────────────────────────────────────

async function main() {
  const samples: Record<string, Sample[]> = {
    initialize: [],
    fund: [],
    release: [],
    cancel: [],
  };
  let accountBytes = 0;

  console.log(
    `Benchmarking ${program.programId.toBase58()} over ${ITERATIONS} iteration(s)...\n`,
  );

  for (let i = 0; i < ITERATIONS; i++) {
    const amount = new BN(LAMPORTS_PER_SOL);

    // Path A: initialize → fund → release
    {
      const recipient = Keypair.generate().publicKey;
      const seed = nextSeed();
      const escrow = deriveEscrow(recipient, seed);

      samples.initialize.push(
        await measure(await init(recipient, seed, amount, futureExpiry())),
      );

      // Capture on-chain account size once, while the account still exists.
      if (accountBytes === 0) {
        const info = await connection.getAccountInfo(escrow);
        accountBytes = info?.data.length ?? 0;
      }

      samples.fund.push(await measure(await fund(recipient, seed)));
      samples.release.push(await measure(await release(recipient, seed)));
    }

    // Path B: initialize → cancel (pre-fund abort, while state is Created)
    {
      const recipient = Keypair.generate().publicKey;
      const seed = nextSeed();
      await init(recipient, seed, amount, futureExpiry());
      samples.cancel.push(await measure(await cancel(recipient, seed)));
    }

    process.stdout.write(`  iteration ${i + 1}/${ITERATIONS} done\r`);
  }

  // ─── report ─────────────────────────────────────────────────────────────────

  const order = ["initialize", "fund", "release", "cancel"] as const;
  const BUDGET = 200_000;

  console.log("\n\nCompute units (program-attributed, from tx logs):\n");
  console.log(
    "  instruction    avg CU     min     max    % of 200k budget   avg fee (lamports)",
  );
  console.log(
    "  ───────────  ────────  ──────  ──────  ──────────────────  ──────────────────",
  );
  for (const name of order) {
    const cu = samples[name].map((s) => s.programCU);
    const fees = samples[name].map((s) => s.feeLamports);
    const a = Math.round(avg(cu));
    console.log(
      `  ${name.padEnd(11)}  ${String(a).padStart(8)}  ${String(min(cu)).padStart(6)}  ${String(
        max(cu),
      ).padStart(6)}  ${((a / BUDGET) * 100).toFixed(2).padStart(17)}%  ${String(
        Math.round(avg(fees)),
      ).padStart(18)}`,
    );
  }

  console.log(`\nEscrow account size: ${accountBytes} bytes (Escrow::LEN)`);
  console.log(
    `Whole-tx CU (incl. system program) — initialize avg: ${Math.round(
      avg(samples.initialize.map((s) => s.totalCU)),
    )}`,
  );
  console.log(
    "\nNote: CU is deterministic for a given code path; variation across runs is ~0.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
