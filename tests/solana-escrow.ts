import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SolanaEscrow } from "../target/types/solana_escrow";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";

describe("solana-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.solanaEscrow as Program<SolanaEscrow>;
  const initializer = provider.wallet;

  // ─── helpers ──────────────────────────────────────────────────────────────

  let seedCounter = 0;
  // Fresh seed per test so PDAs don't collide across the run.
  const nextSeed = () => new BN(++seedCounter);

  const deriveEscrow = (init: PublicKey, recipient: PublicKey, seed: BN) =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        init.toBuffer(),
        recipient.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    )[0];

  const airdrop = async (pubkey: PublicKey, sol = 5) => {
    const sig = await provider.connection.requestAirdrop(
      pubkey,
      sol * LAMPORTS_PER_SOL,
    );
    const latest = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({ signature: sig, ...latest });
  };

  const futureExpiry = (secondsFromNow = 3600) =>
    new BN(Math.floor(Date.now() / 1000) + secondsFromNow);

  const init = async (
    recipient: PublicKey,
    seed: BN,
    amount: BN,
    expiry: BN,
  ) => {
    const escrowPda = deriveEscrow(initializer.publicKey, recipient, seed);
    await program.methods
      .initialize(seed, amount, expiry)
      .accountsStrict({
        initializer: initializer.publicKey,
        recipient,
        escrow: escrowPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return escrowPda;
  };

  const fund = (escrowPda: PublicKey, recipient: PublicKey, seed: BN) =>
    program.methods
      .fund(seed)
      .accountsStrict({
        initializer: initializer.publicKey,
        recipient,
        escrow: escrowPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const release = (escrowPda: PublicKey, recipient: PublicKey, seed: BN) =>
    program.methods
      .release(seed)
      .accountsStrict({
        initializer: initializer.publicKey,
        recipient,
        escrow: escrowPda,
      })
      .rpc();

  const cancel = (escrowPda: PublicKey, recipient: PublicKey, seed: BN) =>
    program.methods
      .cancel(seed)
      .accountsStrict({
        initializer: initializer.publicKey,
        recipient,
        escrow: escrowPda,
      })
      .rpc();

  // Asserts that `promise` rejects. When `code` is supplied, also asserts that
  // the failure carries that Anchor error code; otherwise any rejection passes.
  const expectFailure = async (promise: Promise<unknown>, code?: string) => {
    let threw = false;
    try {
      await promise;
    } catch (err: any) {
      threw = true;
      if (code) {
        const actualCode = err?.error?.errorCode?.code;
        expect(
          actualCode,
          `expected error code "${code}", got: ${JSON.stringify(err, null, 2)}`,
        ).to.equal(code);
      }
    }
    if (!threw) throw new Error("expected the call to reject, but it resolved");
  };

  // ─── initialize ───────────────────────────────────────────────────────────

  describe("initialize", () => {
    it("creates an escrow with the expected fields", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const amount = new BN(LAMPORTS_PER_SOL);
      const expiry = futureExpiry();

      const escrowPda = await init(recipient.publicKey, seed, amount, expiry);

      const account = await program.account.escrow.fetch(escrowPda);
      expect(account.initializer.equals(initializer.publicKey)).to.be.true;
      expect(account.recipient.equals(recipient.publicKey)).to.be.true;
      expect(account.amount.eq(amount)).to.be.true;
      expect(account.expiry.eq(expiry)).to.be.true;
      expect(account.state).to.deep.equal({ created: {} });
      expect(account.bump).to.be.a("number");
    });

    it("rejects re-initializing the same PDA", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const amount = new BN(LAMPORTS_PER_SOL);
      const expiry = futureExpiry();

      await init(recipient.publicKey, seed, amount, expiry);
      // Second init at the same (initializer, recipient, seed): System Program
      // rejects with "account already in use", surfaces as a tx-level error.
      await expectFailure(init(recipient.publicKey, seed, amount, expiry));
    });

    it("rejects zero amount", async () => {
      const recipient = Keypair.generate();
      await expectFailure(
        init(recipient.publicKey, nextSeed(), new BN(0), futureExpiry()),
        "InvalidAmount",
      );
    });

    it("rejects expiry in the past", async () => {
      const recipient = Keypair.generate();
      const pastExpiry = new BN(Math.floor(Date.now() / 1000) - 60);
      await expectFailure(
        init(
          recipient.publicKey,
          nextSeed(),
          new BN(LAMPORTS_PER_SOL),
          pastExpiry,
        ),
        "ExpiryInPast",
      );
    });
  });

  // ─── fund ─────────────────────────────────────────────────────────────────

  describe("fund", () => {
    it("moves SOL from initializer to escrow and sets state to Funded", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const amount = new BN(2 * LAMPORTS_PER_SOL);
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        amount,
        futureExpiry(),
      );

      const escrowBefore = await provider.connection.getBalance(escrowPda);
      await fund(escrowPda, recipient.publicKey, seed);
      const escrowAfter = await provider.connection.getBalance(escrowPda);

      expect(escrowAfter - escrowBefore).to.equal(amount.toNumber());
      const account = await program.account.escrow.fetch(escrowPda);
      expect(account.state).to.deep.equal({ funded: {} });
    });

    it("rejects wrong signer", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      const attacker = Keypair.generate();
      await airdrop(attacker.publicKey);

      await expectFailure(
        program.methods
          .fund(seed)
          .accountsStrict({
            initializer: attacker.publicKey,
            recipient: recipient.publicKey,
            escrow: escrowPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc(),
      );
    });

    it("rejects double-fund", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      await fund(escrowPda, recipient.publicKey, seed);
      await expectFailure(
        fund(escrowPda, recipient.publicKey, seed),
        "InvalidEscrowState",
      );
    });

    it("rejects fund after cancel", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      await cancel(escrowPda, recipient.publicKey, seed);
      // Cancel closed the account, so fund's account-loading step rejects
      // before the state constraint can fire.
      await expectFailure(fund(escrowPda, recipient.publicKey, seed));
    });
  });

  // ─── release ──────────────────────────────────────────────────────────────

  describe("release", () => {
    it("pays the recipient, closes the escrow, refunds rent to initializer", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const amount = new BN(LAMPORTS_PER_SOL);
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        amount,
        futureExpiry(),
      );
      await fund(escrowPda, recipient.publicKey, seed);

      const recipBefore = await provider.connection.getBalance(
        recipient.publicKey,
      );
      const initBefore = await provider.connection.getBalance(
        initializer.publicKey,
      );

      await release(escrowPda, recipient.publicKey, seed);

      const recipAfter = await provider.connection.getBalance(
        recipient.publicKey,
      );
      const initAfter = await provider.connection.getBalance(
        initializer.publicKey,
      );

      expect(await provider.connection.getBalance(escrowPda)).to.equal(0);
      expect(recipAfter - recipBefore).to.equal(amount.toNumber());
      // Initializer paid the tx fee but recovered the (much larger) rent —
      // their net balance change should be positive.
      expect(initAfter).to.be.greaterThan(initBefore);
    });

    it("rejects unauthorized caller", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );
      await fund(escrowPda, recipient.publicKey, seed);

      const attacker = Keypair.generate();
      await airdrop(attacker.publicKey);

      await expectFailure(
        program.methods
          .release(seed)
          .accountsStrict({
            initializer: attacker.publicKey,
            recipient: recipient.publicKey,
            escrow: escrowPda,
          })
          .signers([attacker])
          .rpc(),
      );
    });

    it("rejects release before fund", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      await expectFailure(
        release(escrowPda, recipient.publicKey, seed),
        "InvalidEscrowState",
      );
    });

    it("rejects double-release", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );
      await fund(escrowPda, recipient.publicKey, seed);
      await release(escrowPda, recipient.publicKey, seed);

      // First release closed the account; the second fails at account loading.
      await expectFailure(release(escrowPda, recipient.publicKey, seed));
    });
  });

  // ─── cancel ───────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("closes a Created escrow and returns rent to initializer", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      const initBefore = await provider.connection.getBalance(
        initializer.publicKey,
      );
      await cancel(escrowPda, recipient.publicKey, seed);
      const initAfter = await provider.connection.getBalance(
        initializer.publicKey,
      );

      expect(await provider.connection.getBalance(escrowPda)).to.equal(0);
      expect(initAfter).to.be.greaterThan(initBefore);
    });

    it("rejects non-initializer caller", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      const attacker = Keypair.generate();
      await airdrop(attacker.publicKey);

      await expectFailure(
        program.methods
          .cancel(seed)
          .accountsStrict({
            initializer: attacker.publicKey,
            recipient: recipient.publicKey,
            escrow: escrowPda,
          })
          .signers([attacker])
          .rpc(),
      );
    });

    it("rejects cancel after fund", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );
      await fund(escrowPda, recipient.publicKey, seed);

      await expectFailure(
        cancel(escrowPda, recipient.publicKey, seed),
        "InvalidEscrowState",
      );
    });

    it("rejects cancel after release", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );
      await fund(escrowPda, recipient.publicKey, seed);
      await release(escrowPda, recipient.publicKey, seed);

      // Release closed the account; cancel fails at account loading.
      await expectFailure(cancel(escrowPda, recipient.publicKey, seed));
    });
  });

  // ─── end-of-phase lifecycle ───────────────────────────────────────────────

  describe("lifecycle", () => {
    it("happy path: create → fund → release", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const amount = new BN(2 * LAMPORTS_PER_SOL);
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        amount,
        futureExpiry(),
      );

      let acc = await program.account.escrow.fetch(escrowPda);
      expect(acc.state).to.deep.equal({ created: {} });

      await fund(escrowPda, recipient.publicKey, seed);
      acc = await program.account.escrow.fetch(escrowPda);
      expect(acc.state).to.deep.equal({ funded: {} });

      const recipBefore = await provider.connection.getBalance(
        recipient.publicKey,
      );
      await release(escrowPda, recipient.publicKey, seed);
      const recipAfter = await provider.connection.getBalance(
        recipient.publicKey,
      );

      expect(recipAfter - recipBefore).to.equal(amount.toNumber());
      expect(await provider.connection.getBalance(escrowPda)).to.equal(0);
    });

    it("alt path: create → cancel (pre-fund)", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );

      await cancel(escrowPda, recipient.publicKey, seed);

      expect(await provider.connection.getBalance(escrowPda)).to.equal(0);
    });

    it("rejects create → fund → cancel (post-fund cancel forbidden)", async () => {
      const recipient = Keypair.generate();
      const seed = nextSeed();
      const escrowPda = await init(
        recipient.publicKey,
        seed,
        new BN(LAMPORTS_PER_SOL),
        futureExpiry(),
      );
      await fund(escrowPda, recipient.publicKey, seed);

      await expectFailure(
        cancel(escrowPda, recipient.publicKey, seed),
        "InvalidEscrowState",
      );
    });
  });
});
