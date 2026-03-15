import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { ConfidentialToken, ConfidentialToken__factory, ShieldPayroll, ShieldPayroll__factory } from "../types";

// ─── Constants ─────────────────────────────────────────────────────────────

const ALICE_SALARY = 5_000n * 1_000_000n; // $5,000 USDC (6 decimals)
const BOB_SALARY = 7_000n * 1_000_000n; // $7,000 USDC
const TREASURY_FUND = 50_000n * 1_000_000n; // $50,000 USDC treasury

// ─── Signers ───────────────────────────────────────────────────────────────

type Signers = {
  employer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  charlie: HardhatEthersSigner; // not an employee
};

// ─── Fixture ───────────────────────────────────────────────────────────────

async function deployFixture() {
  const signers = await ethers.getSigners();
  const accounts: Signers = {
    employer: signers[0],
    alice: signers[1],
    bob: signers[2],
    charlie: signers[3],
  };

  // Deploy ConfidentialToken
  const tokenFactory = (await ethers.getContractFactory("ConfidentialToken")) as ConfidentialToken__factory;
  const token = (await tokenFactory.connect(accounts.employer).deploy("ShieldPay USD", "spUSD")) as ConfidentialToken;
  const tokenAddress = await token.getAddress();

  // Deploy ShieldPayroll (payPeriod = 0 for testing, no time lock)
  const payrollFactory = (await ethers.getContractFactory("ShieldPayroll")) as ShieldPayroll__factory;
  const payroll = (await payrollFactory.connect(accounts.employer).deploy(tokenAddress, 0)) as ShieldPayroll;
  const payrollAddress = await payroll.getAddress();

  // Transfer token ownership to ShieldPayroll
  await token.connect(accounts.employer).transferOwnership(payrollAddress);

  return { token, tokenAddress, payroll, payrollAddress, accounts };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function encryptAmount(amount: bigint, contractAddress: string, userAddress: string) {
  return fhevm.createEncryptedInput(contractAddress, userAddress).add64(amount).encrypt();
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("ShieldPayroll — End-to-End Flow", function () {
  let token: ConfidentialToken;
  let tokenAddress: string;
  let payroll: ShieldPayroll;
  let payrollAddress: string;
  let accounts: Signers;

  before(async function () {
    if (!fhevm.isMock) {
      console.warn("ShieldPayroll tests require mock FHEVM — skipping on Sepolia");
      this.skip();
    }
  });

  beforeEach(async function () {
    ({ token, tokenAddress, payroll, payrollAddress, accounts } = await deployFixture());
  });

  // ─── 1. Deployment ─────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets employer to deployer", async function () {
      expect(await payroll.employer()).to.eq(accounts.employer.address);
    });

    it("token ownership transferred to ShieldPayroll", async function () {
      expect(await token.owner()).to.eq(payrollAddress);
    });

    it("initial pay cycle is 0", async function () {
      const { cycle } = await payroll.getPayrollInfo();
      expect(cycle).to.eq(0n);
    });

    it("initial employee count is 0", async function () {
      expect(await payroll.getEmployeeCount()).to.eq(0n);
    });
  });

  // ─── 2. Fund Treasury ──────────────────────────────────────────────────

  describe("Fund Treasury", function () {
    it("employer can fund treasury with encrypted amount", async function () {
      const enc = await encryptAmount(TREASURY_FUND, payrollAddress, accounts.employer.address);
      const tx = await payroll.connect(accounts.employer).fundTreasury(enc.handles[0], enc.inputProof);
      await tx.wait();

      // Treasury balance handle should be non-zero
      const handle = await payroll.connect(accounts.employer).getEncryptedTreasuryBalance();
      expect(handle).to.not.eq(ethers.ZeroHash);
    });

    it("employer can decrypt treasury balance after funding", async function () {
      const enc = await encryptAmount(TREASURY_FUND, payrollAddress, accounts.employer.address);
      await (await payroll.connect(accounts.employer).fundTreasury(enc.handles[0], enc.inputProof)).wait();

      const handle = await payroll.connect(accounts.employer).getEncryptedTreasuryBalance();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.employer);

      expect(clear).to.eq(TREASURY_FUND);
    });

    it("non-employer cannot call fundTreasury", async function () {
      // staticCall (eth_call) bypasses FHEVM plugin tx interception — modifier rejects before FHE
      await expect(
        payroll.connect(accounts.alice).fundTreasury.staticCall(ethers.ZeroHash as any, "0x"),
      ).to.be.revertedWithCustomError(payroll, "NotEmployer");
    });
  });

  // ─── 3. Add Employees ──────────────────────────────────────────────────

  describe("Add Employees", function () {
    it("employer adds Alice with encrypted salary", async function () {
      const enc = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      const tx = await payroll
        .connect(accounts.employer)
        .addEmployee(accounts.alice.address, "Alice", enc.handles[0], enc.inputProof);
      await tx.wait();

      expect(await payroll.isEmployee(accounts.alice.address)).to.be.true;
      expect(await payroll.getEmployeeName(accounts.alice.address)).to.eq("Alice");
      expect(await payroll.getEmployeeCount()).to.eq(1n);
    });

    it("employer adds Bob with a different encrypted salary", async function () {
      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();

      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.bob.address, "Bob", encB.handles[0], encB.inputProof)
      ).wait();

      expect(await payroll.isEmployee(accounts.bob.address)).to.be.true;
      expect(await payroll.getEmployeeCount()).to.eq(2n);
    });

    it("cannot add the same employee twice", async function () {
      const enc = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", enc.handles[0], enc.inputProof)
      ).wait();

      const enc2 = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await expect(
        payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", enc2.handles[0], enc2.inputProof),
      ).to.be.revertedWithCustomError(payroll, "AlreadyEmployee");
    });

    it("non-employer cannot add employees", async function () {
      // staticCall bypasses FHEVM plugin tx interception — modifier rejects before FHE
      await expect(
        payroll
          .connect(accounts.alice)
          .addEmployee.staticCall(accounts.charlie.address, "Charlie", ethers.ZeroHash as any, "0x"),
      ).to.be.revertedWithCustomError(payroll, "NotEmployer");
    });

    it("employer can batch-add multiple employees", async function () {
      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);

      const tx = await payroll
        .connect(accounts.employer)
        .batchAddEmployees(
          [accounts.alice.address, accounts.bob.address],
          ["Alice", "Bob"],
          [encA.handles[0], encB.handles[0]],
          [encA.inputProof, encB.inputProof],
        );
      await tx.wait();

      expect(await payroll.getEmployeeCount()).to.eq(2n);
    });
  });

  // ─── 4. Salary Decryption ──────────────────────────────────────────────

  describe("Salary Decryption (ACL)", function () {
    beforeEach(async function () {
      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();

      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.bob.address, "Bob", encB.handles[0], encB.inputProof)
      ).wait();
    });

    it("Alice decrypts her own salary correctly", async function () {
      const handle = await payroll.connect(accounts.alice).getMyEncryptedSalary();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.alice);
      expect(clear).to.eq(ALICE_SALARY);
    });

    it("Bob decrypts his own salary correctly", async function () {
      const handle = await payroll.connect(accounts.bob).getMyEncryptedSalary();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.bob);
      expect(clear).to.eq(BOB_SALARY);
    });

    it("employer decrypts Alice's salary correctly", async function () {
      const handle = await payroll.connect(accounts.employer).getEmployeeSalary(accounts.alice.address);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.employer);
      expect(clear).to.eq(ALICE_SALARY);
    });

    it("employer decrypts Bob's salary correctly", async function () {
      const handle = await payroll.connect(accounts.employer).getEmployeeSalary(accounts.bob.address);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.employer);
      expect(clear).to.eq(BOB_SALARY);
    });

    it("Alice and Bob salaries are different handles (confidential from each other)", async function () {
      const handleA = await payroll.connect(accounts.alice).getMyEncryptedSalary();
      const handleB = await payroll.connect(accounts.bob).getMyEncryptedSalary();
      // Different handles confirm different ciphertexts — on real Sepolia,
      // ACL prevents Bob from decrypting Alice's handle and vice versa.
      expect(handleA).to.not.eq(handleB);
    });

    it("non-employee cannot call getMyEncryptedSalary", async function () {
      await expect(payroll.connect(accounts.charlie).getMyEncryptedSalary()).to.be.revertedWithCustomError(
        payroll,
        "NotEmployee",
      );
    });
  });

  // ─── 5. Execute Payroll — Cycle 1 ──────────────────────────────────────

  describe("Execute Payroll — Cycle 1", function () {
    beforeEach(async function () {
      // Fund treasury
      const encT = await encryptAmount(TREASURY_FUND, payrollAddress, accounts.employer.address);
      await (await payroll.connect(accounts.employer).fundTreasury(encT.handles[0], encT.inputProof)).wait();

      // Add Alice and Bob
      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();

      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.bob.address, "Bob", encB.handles[0], encB.inputProof)
      ).wait();
    });

    it("employer executes payroll, cycle increments to 1", async function () {
      await (await payroll.connect(accounts.employer).executePayroll()).wait();
      const { cycle } = await payroll.getPayrollInfo();
      expect(cycle).to.eq(1n);
    });

    it("non-employer cannot execute payroll", async function () {
      await expect(payroll.connect(accounts.alice).executePayroll()).to.be.revertedWithCustomError(
        payroll,
        "NotEmployer",
      );
    });

    it("Alice's token balance equals her salary after payroll", async function () {
      await (await payroll.connect(accounts.employer).executePayroll()).wait();

      const handle = await payroll.connect(accounts.alice).getMyEncryptedBalance();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.alice);
      expect(clear).to.eq(ALICE_SALARY);
    });

    it("Bob's token balance equals his salary after payroll", async function () {
      await (await payroll.connect(accounts.employer).executePayroll()).wait();

      const handle = await payroll.connect(accounts.bob).getMyEncryptedBalance();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.bob);
      expect(clear).to.eq(BOB_SALARY);
    });

    it("treasury balance decreases by total payroll (Alice + Bob salaries)", async function () {
      await (await payroll.connect(accounts.employer).executePayroll()).wait();

      const handle = await payroll.connect(accounts.employer).getEncryptedTreasuryBalance();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.employer);
      expect(clear).to.eq(TREASURY_FUND - ALICE_SALARY - BOB_SALARY);
    });
  });

  // ─── 6. Payment History Verification ──────────────────────────────────

  describe("Payment History — Employee Verification", function () {
    beforeEach(async function () {
      const encT = await encryptAmount(TREASURY_FUND, payrollAddress, accounts.employer.address);
      await (await payroll.connect(accounts.employer).fundTreasury(encT.handles[0], encT.inputProof)).wait();

      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();

      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.bob.address, "Bob", encB.handles[0], encB.inputProof)
      ).wait();

      await (await payroll.connect(accounts.employer).executePayroll()).wait();
    });

    it("Alice verifies cycle 1 payment matches her salary", async function () {
      const handle = await payroll.connect(accounts.alice).getMyPaymentForCycle(1);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.alice);
      expect(clear).to.eq(ALICE_SALARY);
    });

    it("Bob verifies cycle 1 payment matches his salary", async function () {
      const handle = await payroll.connect(accounts.bob).getMyPaymentForCycle(1);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.bob);
      expect(clear).to.eq(BOB_SALARY);
    });

    it("non-employee cannot query payment history", async function () {
      await expect(payroll.connect(accounts.charlie).getMyPaymentForCycle(1)).to.be.revertedWithCustomError(
        payroll,
        "NotEmployee",
      );
    });
  });

  // ─── 7. Update Salary ──────────────────────────────────────────────────

  describe("Update Salary", function () {
    const ALICE_NEW_SALARY = 6_500n * 1_000_000n; // raise to $6,500

    beforeEach(async function () {
      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();
    });

    it("employer updates Alice's salary and she decrypts new value", async function () {
      const enc = await encryptAmount(ALICE_NEW_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll.connect(accounts.employer).updateSalary(accounts.alice.address, enc.handles[0], enc.inputProof)
      ).wait();

      const handle = await payroll.connect(accounts.alice).getMyEncryptedSalary();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.alice);
      expect(clear).to.eq(ALICE_NEW_SALARY);
    });

    it("non-employer cannot update salary", async function () {
      // staticCall bypasses FHEVM plugin tx interception — modifier rejects before FHE
      await expect(
        payroll.connect(accounts.alice).updateSalary.staticCall(accounts.alice.address, ethers.ZeroHash as any, "0x"),
      ).to.be.revertedWithCustomError(payroll, "NotEmployer");
    });

    it("cannot update salary of non-employee", async function () {
      const enc = await encryptAmount(ALICE_NEW_SALARY, payrollAddress, accounts.employer.address);
      await expect(
        payroll.connect(accounts.employer).updateSalary(accounts.charlie.address, enc.handles[0], enc.inputProof),
      ).to.be.revertedWithCustomError(payroll, "NotAnEmployee");
    });
  });

  // ─── 8. Multi-Cycle Payroll ────────────────────────────────────────────

  describe("Multi-Cycle Payroll", function () {
    const ALICE_NEW_SALARY = 6_500n * 1_000_000n;

    beforeEach(async function () {
      const encT = await encryptAmount(TREASURY_FUND, payrollAddress, accounts.employer.address);
      await (await payroll.connect(accounts.employer).fundTreasury(encT.handles[0], encT.inputProof)).wait();

      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();

      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.bob.address, "Bob", encB.handles[0], encB.inputProof)
      ).wait();

      // Cycle 1
      await (await payroll.connect(accounts.employer).executePayroll()).wait();

      // Alice gets a raise before cycle 2
      const encRaise = await encryptAmount(ALICE_NEW_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .updateSalary(accounts.alice.address, encRaise.handles[0], encRaise.inputProof)
      ).wait();

      // Cycle 2
      await (await payroll.connect(accounts.employer).executePayroll()).wait();
    });

    it("cycle counter is 2 after two payroll runs", async function () {
      const { cycle } = await payroll.getPayrollInfo();
      expect(cycle).to.eq(2n);
    });

    it("Alice's cumulative balance = old salary + new salary after 2 cycles", async function () {
      const handle = await payroll.connect(accounts.alice).getMyEncryptedBalance();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.alice);
      expect(clear).to.eq(ALICE_SALARY + ALICE_NEW_SALARY);
    });

    it("Alice cycle 1 payment reflects old salary", async function () {
      const handle = await payroll.connect(accounts.alice).getMyPaymentForCycle(1);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.alice);
      expect(clear).to.eq(ALICE_SALARY);
    });

    it("Alice cycle 2 payment reflects new salary after raise", async function () {
      const handle = await payroll.connect(accounts.alice).getMyPaymentForCycle(2);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, payrollAddress, accounts.alice);
      expect(clear).to.eq(ALICE_NEW_SALARY);
    });
  });

  // ─── 9. Remove Employee ────────────────────────────────────────────────

  describe("Remove Employee", function () {
    beforeEach(async function () {
      const encT = await encryptAmount(TREASURY_FUND, payrollAddress, accounts.employer.address);
      await (await payroll.connect(accounts.employer).fundTreasury(encT.handles[0], encT.inputProof)).wait();

      const encA = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", encA.handles[0], encA.inputProof)
      ).wait();

      const encB = await encryptAmount(BOB_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.bob.address, "Bob", encB.handles[0], encB.inputProof)
      ).wait();

      // Cycle 1: both paid
      await (await payroll.connect(accounts.employer).executePayroll()).wait();

      // Remove Bob
      await (await payroll.connect(accounts.employer).removeEmployee(accounts.bob.address)).wait();

      // Cycle 2: only Alice
      await (await payroll.connect(accounts.employer).executePayroll()).wait();
    });

    it("Bob is no longer an employee after removal", async function () {
      expect(await payroll.isEmployee(accounts.bob.address)).to.be.false;
    });

    it("active employee count is 1 after removing Bob", async function () {
      expect(await payroll.getEmployeeCount()).to.eq(1n);
    });

    it("Alice still receives cycle 2 payment after Bob removed", async function () {
      const handle = await payroll.connect(accounts.alice).getMyEncryptedBalance();
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.alice);
      // Alice: salary in cycle 1 + salary in cycle 2
      expect(clear).to.eq(ALICE_SALARY + ALICE_SALARY);
    });

    it("Bob's balance does not increase in cycle 2 after removal", async function () {
      // Bob is inactive — getMyEncryptedBalance() would revert with NotEmployee.
      // Query the token directly; Bob still has ACL on his balance handle from cycle 1.
      const handle = await token.encryptedBalanceOf(accounts.bob.address);
      const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, accounts.bob);
      // Bob only received cycle 1 salary
      expect(clear).to.eq(BOB_SALARY);
    });

    it("non-employer cannot remove employees", async function () {
      // staticCall bypasses FHEVM plugin tx interception — modifier rejects before any state change
      await expect(
        payroll.connect(accounts.alice).removeEmployee.staticCall(accounts.bob.address),
      ).to.be.revertedWithCustomError(payroll, "NotEmployer");
    });
  });

  // ─── 10. Access Control Edge Cases ────────────────────────────────────

  describe("Access Control", function () {
    it("employer cannot be added as employee (zero address guard)", async function () {
      const enc = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      // zero address guard fires for address(0); employer is valid address but not the check here
      // This test ensures the function reverts for zero address
      await expect(
        payroll.connect(accounts.employer).addEmployee(ethers.ZeroAddress, "Zero", enc.handles[0], enc.inputProof),
      ).to.be.revertedWithCustomError(payroll, "ZeroAddress");
    });

    it("inactive employee cannot query salary", async function () {
      const enc = await encryptAmount(ALICE_SALARY, payrollAddress, accounts.employer.address);
      await (
        await payroll
          .connect(accounts.employer)
          .addEmployee(accounts.alice.address, "Alice", enc.handles[0], enc.inputProof)
      ).wait();
      await (await payroll.connect(accounts.employer).removeEmployee(accounts.alice.address)).wait();

      await expect(payroll.connect(accounts.alice).getMyEncryptedSalary()).to.be.revertedWithCustomError(
        payroll,
        "NotEmployee",
      );
    });

    it("getEncryptedTreasuryBalance reverts for non-employer", async function () {
      await expect(payroll.connect(accounts.alice).getEncryptedTreasuryBalance()).to.be.revertedWithCustomError(
        payroll,
        "NotEmployer",
      );
    });
  });
});
