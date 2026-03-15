# ShieldPay — Confidential Onchain Payroll System

> Built on the Zama Protocol (FHEVM) using Fully Homomorphic Encryption (FHE) and ERC-7984 Confidential Tokens.

---

## Competitive Context

**Bron** (bron.org) executed the first confidential payroll on Ethereum mainnet in December 2025 using ERC-7984 + Zama Protocol. Their code is closed source and their implementation details are not publicly documented.

What is verifiable: Bron is a **wallet product** — employers upload a CSV and Bron sends confidential transfers. What ShieldPay offers differently:

- **Open source, self-deployable protocol** — no subscription ($16–$1,666/month), pay gas only
- **Per-employee encrypted salary state onchain** — stored handles, not one-off transfers
- **Employee self-service portal** — employees decrypt and verify their own salary history
- **Employer decrypts any salary** — full ACL control, verifiable access model
- **Payment history per cycle** — employees can prove what they received each month
- **batchAddEmployees** — onboard entire team in one transaction

We make no claims about what Bron can or cannot do technically, since their code is private.

---

## What We Are Building

ShieldPay is a confidential payroll dApp where companies pay employees onchain while keeping individual salaries and payment amounts completely private. No employee can see another employee's salary. No third-party observer can infer payment amounts from the blockchain. Only the employer and the respective employee can decrypt their own salary or payment record.

This is made possible by Zama's FHEVM — encrypted values are stored and computed directly on-chain as ciphertext, with decryption gated by the ACL (Access Control List) at the protocol level.

---

## Challenge Requirements Checklist

| Requirement | Status | Where |
|---|---|---|
| Employer can add employees and set encrypted salaries | Implemented | `ShieldPayroll.addEmployee()` |
| Salaries remain confidential (only employer + employee can view) | Implemented | FHE ACL with `FHE.allow()` |
| Employer can execute payroll with amounts confidential onchain | Implemented | `ShieldPayroll.executePayroll()` |
| Employees can verify and decrypt their own payment | Implemented | `getMyPaymentForCycle()` + `userDecryptEuint` |
| Uses Zama Protocol + ERC-7984 tokens | Implemented | `ConfidentialToken.sol` |
| Smart contract + frontend implementation | Implemented | Hardhat contracts + React frontend |
| Clear project documentation | This document | `SHIELDPAY.md` + `README.md` |
| Real-world viability | Addressed | See shortcomings section |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        Frontend                         │
│   React + Vite + wagmi v2 + @zama-fhe/relayer-sdk       │
│                                                         │
│  Employer Dashboard    │    Employee Dashboard           │
│  - Add employees       │    - View my salary (decrypt)  │
│  - Set salaries        │    - Payment history           │
│  - Fund treasury       │    - Verify payments           │
│  - Run payroll         │                               │
└────────────────────────┬────────────────────────────────┘
                         │ wagmi + viem (Sepolia RPC)
┌────────────────────────▼────────────────────────────────┐
│                   Smart Contracts                        │
│                   (Sepolia Testnet)                     │
│                                                         │
│  ┌─────────────────────┐   ┌────────────────────────┐  │
│  │   ShieldPayroll.sol  │──▶│  ConfidentialToken.sol │  │
│  │                     │   │                        │  │
│  │  - Employee registry│   │  ERC-7984 token        │  │
│  │  - Encrypted salaries│  │  Encrypted balances    │  │
│  │  - Payroll execution│   │  Treasury management   │  │
│  └─────────────────────┘   └────────────────────────┘  │
│                                                         │
│                    Zama FHEVM Layer                     │
│        ACL · Coprocessor · KMS Verifier                 │
└─────────────────────────────────────────────────────────┘
```

---

## Smart Contract Design

### ConfidentialToken.sol (ERC-7984)

An ERC-7984 compatible confidential token where all balances are stored as `euint64` ciphertext handles. The token uses 6 decimal places (USDC convention), giving a maximum value of ~$18.4 trillion — more than sufficient for any payroll use case.

**Key storage:**
```solidity
mapping(address => euint64) private _encryptedBalances;
```

**Key functions:**
```solidity
// Fund the treasury — called by employer with encrypted amount
function mint(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyOwner

// Read your own balance handle — ACL gated
function encryptedBalanceOf(address account) external view returns (euint64)

// Internal — called only by ShieldPayroll during payroll execution
function confidentialTransferFrom(address from, address to, euint64 amount) internal
```

**Safe encrypted transfer pattern:**
```solidity
euint64 fromBalance = _encryptedBalances[from];
ebool hasFunds = FHE.ge(fromBalance, amount);
euint64 deductAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

_encryptedBalances[from] = FHE.sub(fromBalance, deductAmount);
_encryptedBalances[to]   = FHE.add(_encryptedBalances[to], deductAmount);

FHE.allowThis(_encryptedBalances[from]);
FHE.allow(_encryptedBalances[from], from);
FHE.allowThis(_encryptedBalances[to]);
FHE.allow(_encryptedBalances[to], to);
```

The `FHE.select` guard is essential — FHE arithmetic has no branches, so we use an encrypted conditional to zero-out the deduction if insufficient funds exist. This prevents encrypted underflow.

---

### ShieldPayroll.sol

The core payroll contract. The deployer is permanently the employer. Holds the employee registry and orchestrates payroll execution.

**Employee data structure:**
```solidity
struct Employee {
    address wallet;
    euint64 encryptedSalary;  // ciphertext handle
    bool active;
    uint256 lastPaidCycle;    // plaintext — cycle counters reveal nothing sensitive
    string name;              // plaintext — employer already knows employee names
}
```

**Key functions:**

| Function | Caller | Description |
|---|---|---|
| `addEmployee(wallet, name, encSalary, proof)` | Employer | Onboard employee with encrypted salary |
| `updateSalary(wallet, newEncSalary, proof)` | Employer | Update salary (raise, adjustment) |
| `removeEmployee(wallet)` | Employer | Deactivate employee |
| `fundTreasury(encAmount, proof)` | Employer | Mint tokens into contract treasury |
| `executePayroll()` | Employer | Pay all active employees in one tx |
| `getMyEncryptedSalary()` | Employee | Returns ACL-gated salary handle |
| `getMyPaymentForCycle(cycle)` | Employee | Returns payment handle for a given cycle |
| `getPayrollInfo()` | Anyone | Current cycle, next pay timestamp |

**ACL permissions set on every salary handle:**
```solidity
FHE.allowThis(salary);         // ShieldPayroll can compute with it (transfer)
FHE.allow(salary, wallet);     // Employee can decrypt their own salary
FHE.allow(salary, employer);   // Employer can decrypt any salary (they set it)
```

**executePayroll — what happens onchain:**
```solidity
for each active employee:
    token.confidentialTransferFrom(address(this), employee.wallet, employee.encryptedSalary)
    _paymentHistory[wallet][cycle] = employee.encryptedSalary
    FHE.allow(_paymentHistory[wallet][cycle], wallet)  // employee can verify
    FHE.allowThis(_paymentHistory[wallet][cycle])
    employee.lastPaidCycle = currentPayCycle
    emit PaymentExecuted(wallet, currentPayCycle)  // no salary in event
```

No salary amounts appear anywhere in the transaction data, event logs, or state in plaintext.

---

## FHE Encryption Strategy

### What is encrypted vs plaintext

| Data | Storage | Rationale |
|---|---|---|
| Employee salary | `euint64` (encrypted) | Core privacy requirement |
| Token balance (per address) | `euint64` (encrypted) | ERC-7984 requirement |
| Payment record per cycle | `euint64` (encrypted) | Employee verification |
| Employee name | `string` (plaintext) | Employer sets it — no privacy gain |
| Employee wallet address | `address` (plaintext) | Required for ACL and transfers |
| Pay cycle number | `uint256` (plaintext) | Observable from block timestamps anyway |
| Active/inactive status | `bool` (plaintext) | Employer already knows |
| Treasury funded/not | deducible (plaintext observable) | See shortcomings |

### ACL Access Control Matrix

| Handle | `address(this)` (contract) | Employer | Employee | Other employees | Public |
|---|---|---|---|---|---|
| Employee salary | Read/compute | Decrypt | Decrypt | No access | No access |
| Employee balance | Read/compute | No access | Decrypt | No access | No access |
| Payment record | Read/compute | No access | Decrypt | No access | No access |
| Treasury balance | Read/compute | Decrypt | No access | No access | No access |

This is enforced entirely at the FHEVM ACL layer — not by the contract's `require` statements. Even if an unauthorized address calls `userDecryptEuint` with a handle they were not `allow()`'d on, the Zama KMS will reject the decryption request.

---

## ERC-7984 Integration

ERC-7984 (Confidential Tokens) is the draft standard for FHE-native fungible tokens where balances are `euint64` ciphertext handles rather than plaintext `uint256`. The key differences from ERC-20:

- `balanceOf(address)` → returns `euint64` (a ciphertext handle, not a number)
- `transfer` takes an encrypted input + ZKP proof
- No plaintext `allowance` mapping — authorization is handled by ACL
- `totalSupply` can be encrypted (we implement it as `euint64`)

Since there is no canonical ERC-7984 deployment on Sepolia yet, we implement a faithful ERC-7984-compatible `ConfidentialToken.sol` from scratch, following the interface specification.

The treasury model: `ShieldPayroll` contract address holds all payroll funds in `_encryptedBalances[shieldPayrollAddress]`. Employer mints tokens directly to this address. When payroll runs, funds flow from `shieldPayrollAddress` → each employee's address within the token's balance mapping.

---

## Frontend Architecture

### Tech Stack
- **React 18 + Vite + TypeScript**
- **wagmi v2 + viem** — type-safe contract reads/writes
- **@zama-fhe/relayer-sdk** — client-side encryption and decryption via Zama KMS
- **RainbowKit** — wallet connection
- **Tailwind CSS** — styling

### Pages and Role Gating

```
/                       → Landing + wallet connect
/employer               → Employer dashboard (gated: only deployer address)
/employer/employees     → Add/update/remove employees
/employer/payroll       → Fund treasury, execute payroll, view cycle status
/employee               → Employee dashboard (gated: must be in employeeList)
/employee/salary        → Decrypt and view my salary
/employee/history       → View + verify payments per cycle
```

Role detection is done client-side: if `connectedAddress === employerAddress` (read from contract), show employer UI. If `connectedAddress` is in `employeeList`, show employee UI.

### Key Encryption Flow (Frontend → Contract)

**Setting a salary (employer):**
```typescript
const salaryMicro = BigInt(salaryUSD) * 1_000_000n; // 6 decimals
const input = await fhevmInstance.createEncryptedInput(shieldPayrollAddress, employerAddress);
input.add64(salaryMicro);
const encrypted = await input.encrypt();
await shieldPayroll.addEmployee(wallet, name, encrypted.handles[0], encrypted.inputProof);
```

**Decrypting a salary (employee):**
```typescript
const handle = await shieldPayroll.getMyEncryptedSalary();
const clearSalary = await fhevmInstance.userDecryptEuint(
  FhevmType.euint64, handle, shieldPayrollAddress, signer
);
// clearSalary is a BigInt — divide by 1_000_000n for USD display
```

The relayer-sdk generates an ephemeral keypair, the Zama KMS re-encrypts the ciphertext under this ephemeral key (after verifying the requestor is ACL-authorized), and the client decrypts locally. No plaintext value ever leaves the client machine.

---

## Project File Structure

```
onchain-payroll-system/
├── contracts/
│   ├── FHECounter.sol                   # Template reference (unchanged)
│   ├── ConfidentialToken.sol            # ERC-7984 confidential token
│   ├── ShieldPayroll.sol                # Core payroll contract
│   └── interfaces/
│       └── IConfidentialToken.sol       # Interface used by ShieldPayroll
│
├── deploy/
│   ├── deploy.ts                        # FHECounter deploy (unchanged)
│   ├── 01_deploy_token.ts               # Deploy ConfidentialToken
│   └── 02_deploy_payroll.ts             # Deploy ShieldPayroll, transfer token ownership
│
├── test/
│   ├── FHECounter.ts                    # Template tests (unchanged)
│   ├── ConfidentialToken.ts             # Token unit tests (mock network)
│   ├── ShieldPayroll.ts                 # Payroll unit tests (mock network)
│   └── ShieldPayrollSepolia.ts          # E2E tests on Sepolia
│
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── config/
│       │   ├── wagmi.ts                 # Sepolia chain config
│       │   ├── contracts.ts             # ABIs + deployed addresses
│       │   └── fhevm.ts                 # relayer-sdk initialization
│       ├── hooks/
│       │   ├── useEncryptedInput.ts     # Wraps createEncryptedInput + add64
│       │   ├── useUserDecrypt.ts        # Wraps userDecryptEuint
│       │   ├── useShieldPayroll.ts      # All payroll contract interactions
│       │   └── useConfidentialToken.ts  # Token balance + mint interactions
│       ├── pages/
│       │   ├── Landing.tsx
│       │   ├── employer/
│       │   │   ├── EmployerDashboard.tsx
│       │   │   ├── EmployeeManagement.tsx
│       │   │   └── PayrollExecution.tsx
│       │   └── employee/
│       │       ├── EmployeeDashboard.tsx
│       │       ├── MySalary.tsx
│       │       └── PaymentHistory.tsx
│       └── components/
│           ├── WalletGate.tsx           # Role-based route protection
│           ├── EncryptedSalaryInput.tsx # Salary form with client-side encryption
│           ├── SalaryDecryptButton.tsx  # Decryption trigger + display
│           ├── PayrollStatusCard.tsx    # Cycle info + countdown
│           ├── EmployeeRow.tsx          # Employee table row
│           ├── PaymentHistoryTable.tsx  # Per-cycle payment records
│           └── TreasuryCard.tsx         # Treasury balance (employer only)
│
├── SHIELDPAY.md                         # This document
└── README.md                            # Setup and deployment instructions
```

---

## Implementation Order

1. `IConfidentialToken.sol` — interface first, prevents circular deps
2. `ConfidentialToken.sol` — mint, transfer, balance
3. `ShieldPayroll.sol` — full payroll logic
4. `01_deploy_token.ts` + `02_deploy_payroll.ts`
5. `ConfidentialToken.ts` tests (mock network)
6. `ShieldPayroll.ts` tests (mock network) — must all pass before Sepolia
7. Sepolia deploy + `ShieldPayrollSepolia.ts` E2E tests
8. Frontend: config → hooks → pages → components
9. Etherscan verification
10. README update + video demo

---

## Known Shortcomings and Mitigations

### 1. Payroll loop gas scales linearly with employee count

**Problem:** `executePayroll()` loops all active employees in one transaction. At ~50+ employees on a real network, this will hit gas limits or cost prohibitively.

**Mitigation for hackathon:** Acceptable at demo scale (5–20 employees). Documented.

**Real-world fix:** Split into `executeSinglePayment(address employee)` called per employee, or use off-chain batching with Merkle proofs for authorization. Alternatively, use Chainlink Automation to chunk payroll over multiple blocks.

---

### 2. Treasury balance is partially observable

**Problem:** While the treasury `euint64` balance is encrypted, the employer can observe that the balance changes after payroll (because `executePayroll` is a public function). An attacker counting employees (from the plaintext `employeeList`) and knowing the pay cycle could attempt to infer average salary from treasury depletion rate over time.

**Mitigation:** This is a metadata leakage problem, not a direct value leakage. Individual salaries remain fully encrypted. The only deducible quantity is the total payroll sum (not individual salaries).

**Real-world fix:** Add a dummy "noise" transfer per cycle to obscure total payroll size. Or use zero-knowledge proofs to attest payroll completion without revealing the number of employees.

---

### 3. Employee list is public

**Problem:** `employeeList` is a public array of plaintext wallet addresses. Anyone can enumerate employees.

**Mitigation for hackathon:** This is standard for most payroll systems — the set of employees is not typically confidential, only the salaries.

**Real-world fix:** Replace `employeeList` with a Merkle tree root of employee addresses, reveal only the count, and use zk-proofs for membership. However, this significantly increases complexity and is out of scope for the hackathon.

---

### 4. Employer role is the deployer address — no multisig

**Problem:** If the employer's private key is compromised, the attacker can read all salaries, fire all employees, or drain the treasury.

**Mitigation for hackathon:** Documented limitation.

**Real-world fix:** Replace the `employer` EOA with a Gnosis Safe multisig address. The `onlyEmployer` modifier works identically — just point it at the Safe address.

---

### 5. No salary history — only current salary handle

**Problem:** When `updateSalary` is called, the old salary handle is overwritten. There is no record of previous salaries onchain.

**Mitigation:** `_paymentHistory[wallet][cycle]` preserves the actual paid amount per cycle, which is effectively a salary audit trail (the amount paid each cycle is the salary at that time).

**Real-world fix:** Store `mapping(address => euint64[]) salaryHistory` with timestamps. Adds storage cost but gives full audit capability.

---

### 6. Pay period can be set to zero for demo purposes

**Problem:** Setting `payPeriod = 0` in the deploy script disables the time guard entirely, meaning `executePayroll` can be called any number of times in the same block.

**Mitigation:** This is intentional for demo flexibility so judges can run payroll immediately. In production deploy, set `payPeriod = 30 days`.

**Real-world fix:** Already designed — just pass the correct `payPeriod` to the constructor at production deploy time.

---

### 7. No on-chain payslip or receipt

**Problem:** After decrypting their payment, an employee has no tamper-proof record they can share (e.g., for a bank loan application) without revealing the raw value.

**Real-world fix:** Use Zama's `makePubliclyDecryptable` on a ZKP-attested receipt handle, or integrate with an attestation protocol. Out of scope for hackathon.

---

### 8. Frontend role detection is client-side only

**Problem:** Role detection (employer vs employee) happens client-side by comparing wallet address to `employerAddress` and `employeeList`. A user could manipulate the UI to see the employer view, but they cannot call restricted contract functions — those are enforced onchain with `onlyEmployer` and ACL checks.

**Mitigation:** Security is enforced at the contract and ACL layer, not the frontend. The frontend role detection is UX only.

---

## Security Properties Summary

| Property | Guaranteed by |
|---|---|
| Employee A cannot read Employee B's salary | Zama FHEVM ACL — `FHE.allow` not set for B on A's handle |
| No plaintext salary in transaction data | All salary inputs are `externalEuint64` + ZKP proof |
| No plaintext salary in event logs | `PaymentExecuted` emits only `(address, uint256)` — no amounts |
| Employer cannot impersonate employee for decryption | KMS verifies signer identity in `userDecryptEuint` |
| Treasury cannot be drained by non-employer | `onlyEmployer` modifier on `executePayroll` and `fundTreasury` |
| Salary handles cannot be forged | `FHE.fromExternal` verifies the ZKP on every salary input |

---

## Deployment

```bash
# 1. Set env vars
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY

# 2. Compile
npm run compile

# 3. Test on mock network
npm run test

# 4. Deploy to Sepolia
npx hardhat deploy --network sepolia

# 5. Run E2E tests on Sepolia
npx hardhat test --network sepolia

# 6. Verify on Etherscan
npx hardhat verify --network sepolia <CONFIDENTIAL_TOKEN_ADDRESS>
npx hardhat verify --network sepolia <SHIELD_PAYROLL_ADDRESS> <TOKEN_ADDRESS>
```

---

## Real-World Viability Assessment

ShieldPay solves a genuine problem: in most crypto payroll systems today (Request Finance, Superfluid, Sablier), salary amounts are fully visible onchain. Any employee, competitor, or journalist can read exactly what every person earns. ShieldPay makes salary confidentiality a first-class protocol guarantee, not just a UI convention.

**What works today:**
- Fully encrypted salary storage and payment on Sepolia
- Per-employee ACL-gated decryption via Zama KMS
- ERC-7984 compatible token with encrypted balances
- End-to-end flow from onboarding to payment verification

**What needs work before production:**
- Gas optimization for large employee counts (batching)
- Multisig employer role (Gnosis Safe integration)
- Stablecoin integration (bridge real USDC into confidential form)
- Regulatory compliance tooling (selective disclosure for auditors)
- Mobile wallet support (relayer-sdk needs browser environment)

ShieldPay demonstrates that confidential payroll is technically feasible today using FHEVM, with the primary remaining challenges being gas efficiency and regulatory tooling — both solvable engineering problems, not fundamental blockers.
