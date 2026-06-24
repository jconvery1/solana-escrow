/**
 * Manual escrow driver for the command line.
 *
 * Prereqs (see README / chat): a running `solana-test-validator`, `anchor deploy`,
 * and a funded default wallet. Uses Anchor's env provider, so it respects
 * ANCHOR_PROVIDER_URL / ANCHOR_WALLET (both default sensibly for localnet).
 *
 * Usage:
 *   yarn cli new-recipient
 *   yarn cli init    <recipient> <seed> <amountSol> [expirySecsFromNow=3600]
 *   yarn cli fund    <recipient> <seed>
 *   yarn cli release <recipient> <seed>
 *   yarn cli cancel  <recipient> <seed>
 *   yarn cli show    <recipient> <seed>
 *
 * Run with: ANCHOR_PROVIDER_URL=http://localhost:8899 \
 *           ANCHOR_WALLET=~/.config/solana/id.json \
 *           npx ts-node scripts/escrow-cli.ts <command> ...
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
const me = provider.wallet.publicKey;

const deriveEscrow = (recipient: PublicKey, seed: BN) =>
  PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      me.toBuffer(),
      recipient.toBuffer(),
      seed.toArrayLike(Buffer, "le", 8),
    ],
    program.programId,
  )[0];

const sol = (lamports: number | bigint) => Number(lamports) / LAMPORTS_PER_SOL;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "new-recipient") {
    // Recipient never signs in this program, so the pubkey alone is enough.
    console.log("recipient:", Keypair.generate().publicKey.toBase58());
    return;
  }

  const recipient = new PublicKey(rest[0]);
  const seed = new BN(rest[1]);
  const escrow = deriveEscrow(recipient, seed);

  const accountsCore = { initializer: me, recipient, escrow };
  const accountsSys = { ...accountsCore, systemProgram: SystemProgram.programId };

  switch (cmd) {
    case "init": {
      const amount = new BN(Number(rest[2]) * LAMPORTS_PER_SOL);
      const secs = rest[3] ? Number(rest[3]) : 3600;
      const expiry = new BN(Math.floor(Date.now() / 1000) + secs);
      const sig = await program.methods
        .initialize(seed, amount, expiry)
        .accountsStrict(accountsSys)
        .rpc();
      console.log("initialized:", escrow.toBase58(), "\ntx:", sig);
      break;
    }
    case "fund": {
      const sig = await program.methods.fund(seed).accountsStrict(accountsSys).rpc();
      console.log("funded\ntx:", sig);
      break;
    }
    case "release": {
      const sig = await program.methods.release(seed).accountsStrict(accountsCore).rpc();
      console.log("released to recipient\ntx:", sig);
      break;
    }
    case "cancel": {
      const sig = await program.methods.cancel(seed).accountsStrict(accountsCore).rpc();
      console.log("cancelled\ntx:", sig);
      break;
    }
    case "show": {
      const acc = await program.account.escrow.fetch(escrow);
      const bal = await provider.connection.getBalance(escrow);
      console.log({
        pda: escrow.toBase58(),
        initializer: acc.initializer.toBase58(),
        recipient: acc.recipient.toBase58(),
        amount: sol(acc.amount.toNumber()),
        state: acc.state,
        expiry: new Date(acc.expiry.toNumber() * 1000).toISOString(),
        lamportsOnPda: sol(bal),
      });
      break;
    }
    default:
      console.error("unknown command:", cmd);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
