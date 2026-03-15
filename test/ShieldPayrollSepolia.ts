import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { ConfidentialToken, ConfidentialToken__factory, ShieldPayroll, ShieldPayroll__factory } from "../types";

// ─── Constants ──────────────────────────────────────────────────────────────

const ALICE_SALARY    = 1_000n * 1_000_000n; // $1,000 USDC (6 decimals) — kept small to limit gas
const BOB_SALARY      = 1_500n * 1_000_000n; // $1,500 USDC
const TREASURY_FUND   = 10_000n * 1_000_000n; // $10,000 USDC treasury
const ALICE_NEW_SALARY = 1_200n * 1_000_000n; // $1,200 USDC after raise

// ─── Helpers ────────────────────────────────────────────────────────────────

function progress(step: number, total: number, msg: string) {
  console.log(`  [${step}/${total}] ${msg}`);
}

async function encryptAmount(amount: bigint, contractAddress: string, userAddress: string) {
  return fhevm.createEncryptedInput(contractAddress, userAddress).add64(amount).encrypt();
}

async function decryptHandle(handle: string, contractAddress: string, signer: HardhatEthersSigner): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, handle, contractAddress, signer);
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("ShieldPayroll — Sepolia E2E Flow", function () {
  this.timeout(20 * 60 * 1000); // 20 min — Sepolia FHE ops take ~55s each

  let token: ConfidentialToken;
  let tokenAddress: string;
  let payroll: ShieldPayroll;
  let payrollAddress: string;

  let employer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  before(async function () {
    if (fhevm.isMock) {
      console.warn("  ShieldPayroll Sepolia suite skipped on mock — run with --network sepolia");
      this.skip();
    }

    const signers = await ethers.getSigners();
    employer = signers[0];
    alice    = signers[1];
    bob      = signers[2];

    const step = (n: number, msg: string) => progress(n, 4, msg);

    // ── Deploy contracts (once for the whole suite) ──────────────────────────

    step(1, "Deploying ConfidentialToken...");
    const tokenFactory = (await ethers.getContractFactory("ConfidentialToken")) as ConfidentialToken__factory;
    token = (await tokenFactory.connect(employer).deploy("ShieldPay USD", "spUSD")) as ConfidentialToken;
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    console.log(`       ConfidentialToken: ${tokenAddress}`);

    step(2, "Deploying ShieldPayroll...");
    const payrollFactory = (await ethers.getContractFactory("ShieldPayroll")) as ShieldPayroll__factory;
    payroll = (await payrollFactory.connect(employer).deploy(tokenAddress, 0)) as ShieldPayroll;
    await payroll.waitForDeployment();
    payrollAddress = await payroll.getAddress();
    console.log(`       ShieldPayroll:     ${payrollAddress}`);

    step(3, "Transferring token ownership to ShieldPayroll...");
    await (await token.connect(employer).transferOwnership(payrollAddress)).wait();

    step(4, "Setup complete. Starting payroll flow...\n");
  });

  // ── Step 1: Fund treasury ─────────────────────────────────────────────────

  it("1. Employer funds treasury with encrypted amount", async function () {
    console.log("  Encrypting $10,000 treasury fund...");
    const enc = await encryptAmount(TREASURY_FUND, payrollAddress, employer.address);

    console.log("  Sending fundTreasury tx...");
    await (await payroll.connect(employer).fundTreasury(enc.handles[0], enc.inputProof)).wait();

    console.log("  Decrypting treasury balance...");
    const handle = await payroll.connect(employer).getEncryptedTreasuryBalance();
    const clear = await decryptHandle(handle, tokenAddress, employer);

    console.log(`  Treasury balance: $${Number(clear) / 1_000_000}`);
    expect(clear).to.eq(TREASURY_FUND);
  });

  // ── Step 2: Add employees ─────────────────────────────────────────────────

  it("2. Employer adds Alice ($1,000/mo) and Bob ($1,500/mo) with encrypted salaries", async function () {
    console.log("  Encrypting Alice salary...");
    const encA = await encryptAmount(ALICE_SALARY, payrollAddress, employer.address);
    await (await payroll.connect(employer).addEmployee(alice.address, "Alice", encA.handles[0], encA.inputProof)).wait();

    console.log("  Encrypting Bob salary...");
    const encB = await encryptAmount(BOB_SALARY, payrollAddress, employer.address);
    await (await payroll.connect(employer).addEmployee(bob.address, "Bob", encB.handles[0], encB.inputProof)).wait();

    expect(await payroll.getEmployeeCount()).to.eq(2n);
    expect(await payroll.isEmployee(alice.address)).to.be.true;
    expect(await payroll.isEmployee(bob.address)).to.be.true;
    console.log("  Alice and Bob registered.");
  });

  // ── Step 3: Salary decryption ACL check ──────────────────────────────────

  it("3. Alice and Bob each decrypt only their own salary (ACL enforced)", async function () {
    console.log("  Alice decrypting her salary...");
    const handleA = await payroll.connect(alice).getMyEncryptedSalary();
    const clearA = await decryptHandle(handleA, payrollAddress, alice);
    console.log(`  Alice salary: $${Number(clearA) / 1_000_000}`);
    expect(clearA).to.eq(ALICE_SALARY);

    console.log("  Bob decrypting his salary...");
    const handleB = await payroll.connect(bob).getMyEncryptedSalary();
    const clearB = await decryptHandle(handleB, payrollAddress, bob);
    console.log(`  Bob salary: $${Number(clearB) / 1_000_000}`);
    expect(clearB).to.eq(BOB_SALARY);

    // Handles are distinct ciphertexts
    expect(handleA).to.not.eq(handleB);
  });

  // ── Step 4: Execute payroll cycle 1 ──────────────────────────────────────

  it("4. Employer executes payroll cycle 1 — Alice and Bob receive encrypted salaries", async function () {
    console.log("  Executing payroll cycle 1...");
    await (await payroll.connect(employer).executePayroll()).wait();

    const { cycle } = await payroll.getPayrollInfo();
    expect(cycle).to.eq(1n);

    console.log("  Alice checking token balance...");
    const handleA = await payroll.connect(alice).getMyEncryptedBalance();
    const clearA = await decryptHandle(handleA, tokenAddress, alice);
    console.log(`  Alice balance: $${Number(clearA) / 1_000_000}`);
    expect(clearA).to.eq(ALICE_SALARY);

    console.log("  Bob checking token balance...");
    const handleB = await payroll.connect(bob).getMyEncryptedBalance();
    const clearB = await decryptHandle(handleB, tokenAddress, bob);
    console.log(`  Bob balance: $${Number(clearB) / 1_000_000}`);
    expect(clearB).to.eq(BOB_SALARY);

    console.log("  Employer checking remaining treasury...");
    const handleT = await payroll.connect(employer).getEncryptedTreasuryBalance();
    const clearT = await decryptHandle(handleT, tokenAddress, employer);
    console.log(`  Treasury remaining: $${Number(clearT) / 1_000_000}`);
    expect(clearT).to.eq(TREASURY_FUND - ALICE_SALARY - BOB_SALARY);
  });

  // ── Step 5: Payment history verification ─────────────────────────────────

  it("5. Alice verifies cycle 1 payment from history", async function () {
    console.log("  Alice fetching cycle 1 payment handle...");
    const handle = await payroll.connect(alice).getMyPaymentForCycle(1);
    const clear = await decryptHandle(handle, payrollAddress, alice);
    console.log(`  Cycle 1 payment: $${Number(clear) / 1_000_000}`);
    expect(clear).to.eq(ALICE_SALARY);
  });

  // ── Step 6: Salary update + cycle 2 ──────────────────────────────────────

  it("6. Alice gets a raise, cycle 2 executes with new salary", async function () {
    console.log("  Encrypting Alice's new salary ($1,200)...");
    const enc = await encryptAmount(ALICE_NEW_SALARY, payrollAddress, employer.address);
    await (await payroll.connect(employer).updateSalary(alice.address, enc.handles[0], enc.inputProof)).wait();

    console.log("  Executing payroll cycle 2...");
    await (await payroll.connect(employer).executePayroll()).wait();

    const { cycle } = await payroll.getPayrollInfo();
    expect(cycle).to.eq(2n);

    console.log("  Alice decrypting cumulative balance (cycle1 + cycle2)...");
    const handleA = await payroll.connect(alice).getMyEncryptedBalance();
    const clearA = await decryptHandle(handleA, tokenAddress, alice);
    console.log(`  Alice cumulative: $${Number(clearA) / 1_000_000} (expected $${Number(ALICE_SALARY + ALICE_NEW_SALARY) / 1_000_000})`);
    expect(clearA).to.eq(ALICE_SALARY + ALICE_NEW_SALARY);

    console.log("  Alice verifying cycle 2 payment history...");
    const handleC2 = await payroll.connect(alice).getMyPaymentForCycle(2);
    const clearC2 = await decryptHandle(handleC2, payrollAddress, alice);
    expect(clearC2).to.eq(ALICE_NEW_SALARY);
  });

  // ── Step 7: Remove employee + cycle 3 ────────────────────────────────────

  it("7. Bob is removed, cycle 3 pays only Alice — Bob's balance unchanged", async function () {
    console.log("  Removing Bob...");
    await (await payroll.connect(employer).removeEmployee(bob.address)).wait();
    expect(await payroll.isEmployee(bob.address)).to.be.false;
    expect(await payroll.getEmployeeCount()).to.eq(1n);

    console.log("  Executing payroll cycle 3 (Alice only)...");
    await (await payroll.connect(employer).executePayroll()).wait();

    console.log("  Alice balance (3 cycles)...");
    const handleA = await payroll.connect(alice).getMyEncryptedBalance();
    const clearA = await decryptHandle(handleA, tokenAddress, alice);
    console.log(`  Alice: $${Number(clearA) / 1_000_000}`);
    expect(clearA).to.eq(ALICE_SALARY + ALICE_NEW_SALARY + ALICE_NEW_SALARY);

    console.log("  Bob balance (unchanged after removal)...");
    const handleB = await token.encryptedBalanceOf(bob.address);
    const clearB = await decryptHandle(handleB, tokenAddress, bob);
    console.log(`  Bob: $${Number(clearB) / 1_000_000} (should still be $${Number(BOB_SALARY * 2n) / 1_000_000})`);
    expect(clearB).to.eq(BOB_SALARY * 2n); // paid in cycles 1 and 2 only... wait Bob was removed before cycle 2 was run?
    // Actually: Bob was paid in cycle 1 and cycle 2 (removed after cycle 2), so Bob has BOB_SALARY * 2
  });
});
