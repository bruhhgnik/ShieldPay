# ShieldPay — Confidential Onchain Payroll

A fully encrypted payroll protocol built on the [Zama Protocol](https://docs.zama.ai) (FHEVM). Employer sets encrypted salaries, executes payroll, and employees verify their own payments — all without any amount ever appearing in plaintext on-chain.

## How it works

- Salaries and balances are stored as `euint64` ciphertext handles on-chain
- Only the employer can decrypt any salary; each employee can only decrypt their own
- Payroll transfers happen entirely in ciphertext via FHE arithmetic
- Decryption happens off-chain through the Zama KMS using an EIP-712 signed request

## Contracts (Sepolia)

| Contract | Address |
|---|---|
| `ConfidentialToken` (spUSD) | `0x8447eE83A3c368e4a33a40908C0d807C9F74DB17` |
| `ShieldPayroll` | `0xd5053e15c093e888F5f84Aa9eFAA7a0B8aB2f83e` |

## Project Structure

```
contracts/
  ConfidentialToken.sol      # ERC-7984 compatible token with encrypted balances
  ShieldPayroll.sol          # Core payroll logic
  interfaces/
    IConfidentialToken.sol
deploy/
  01_deploy_token.ts
  02_deploy_payroll.ts
test/
  ShieldPayroll.ts           # 41 mock tests (full coverage)
  ShieldPayrollSepolia.ts    # 7-step E2E test on live Sepolia
frontend/                    # Vite + React + RainbowKit UI
  src/
    pages/
      Employer.tsx           # Fund, add employees, execute payroll, decrypt
      Employee.tsx           # View salary, balance, payment history
    lib/
      contracts.ts           # ABIs + deployed addresses
      fhevm.ts               # fhevmjs encrypt/decrypt helpers
SHIELDPAY.md                 # Full implementation doc + competitive analysis
```

## Quickstart

### Prerequisites

- Node.js 20+
- A Sepolia wallet with test ETH ([faucet](https://sepoliafaucet.com))
- Alchemy or Infura Sepolia RPC URL

### Smart contracts

```bash
npm install

# Run tests on local mock FHEVM (fast, no gas)
npx hardhat test

# Run E2E flow on Sepolia
HARDHAT_VAR_MNEMONIC="your mnemonic here" npx hardhat test test/ShieldPayrollSepolia.ts --network sepolia

# Deploy your own instance to Sepolia
HARDHAT_VAR_MNEMONIC="your mnemonic here" npx hardhat deploy --network sepolia
```

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Connect MetaMask on Sepolia. The employer wallet gets full write access; any other address gets the employee view.

## Employer flows

| Action | Description |
|---|---|
| Fund Treasury | Encrypts USDC amount client-side, mints to contract |
| Add Employee | Encrypts salary, sets ACL so only employer + employee can decrypt |
| Update Salary | Replaces salary handle; prior payment history unchanged |
| Remove Employee | Deactivates employee; excluded from future payroll |
| Execute Payroll | Transfers encrypted salary to each active employee |
| View Treasury Balance | KMS re-encrypts balance handle for employer to read |
| View Employee Salary | KMS re-encrypts salary handle for employer to read |

## Employee flows

| Action | Description |
|---|---|
| View My Salary | KMS re-encrypts salary handle — only readable by that employee |
| View My Balance | Decrypts spUSD token balance |
| Verify Payment | Decrypts payment history for any past cycle |

## Test results

```
41 passing  — local mock FHEVM
 7 passing  — live Sepolia (4 minutes end-to-end)
```

Sepolia E2E covers: treasury funding, employee onboarding, salary ACL, payroll cycle 1, payment history verification, salary raise + cycle 2, employee removal + cycle 3.

## Architecture

```
Employer
  │
  ├─ fundTreasury(encAmount, proof)
  │     └─ FHE.fromExternal → euint64 handle
  │     └─ FHE.allow(handle, token)
  │     └─ ConfidentialToken.mint(this, handle)
  │
  ├─ addEmployee(wallet, name, encSalary, proof)
  │     └─ FHE.fromExternal → euint64 handle
  │     └─ ACL: allowThis + allow(token) + allow(wallet) + allow(employer)
  │
  └─ executePayroll()
        └─ for each active employee:
              ConfidentialToken.confidentialTransfer(this, wallet, encSalary)
                └─ FHE.ge(balance, amount) → encrypted guard (no revert)
                └─ FHE.select(hasFunds, amount, 0)
                └─ FHE.sub / FHE.add → new handles, ACL re-set
```

## Known limitations

See [SHIELDPAY.md](./SHIELDPAY.md) for a full list of shortcomings and mitigations, including: unbounded employee array gas cost, salary handle reuse across cycles, no native multi-employer support, and Sepolia-only deployment.

## License

MIT
