This illustrates how one party can pay another in SOL once an off-chain requirement is met.

Non-custodial, with PDAs keyed on `(initializer, recipient, seed)` so one wallet can run many at once.

- **Initialize** — open an escrow
- **Fund** — deposit the SOL
- **Release** — pay the recipient
- **Cancel** — refund an unfunded escrow

The state machine keeps transitions correct.

```text
Created ──fund──▶ Funded ──release──▶ Released
   └──cancel──▶ Cancelled
```

- `anchor test` — run the tests
- `solana-test-validator` — start the local validator
- `yarn bench` — view compute units (validator must be running)

CU can be reduced by combining `initialize` and `fund` into a single instruction but this makes `cancel` an unguarded refund, so will leave separate for now.

The anchor framework is the main overhead so if CU optimisation is a priority, a raw `solana-program` or `pinocchio` rewrite may be worthwhile.