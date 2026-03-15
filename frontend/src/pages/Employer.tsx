import { useState } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useSignTypedData } from "wagmi";
import { PAYROLL_ADDRESS, TOKEN_ADDRESS, PAYROLL_ABI, formatUSDC, SCALE } from "../lib/contracts";
import { encrypt64, decrypt64 } from "../lib/fhevm";

type Status = { type: "idle" | "busy" | "ok" | "err"; msg: string };

function useStatus() {
  const [status, setStatus] = useState<Status>({ type: "idle", msg: "" });
  const set = (type: Status["type"], msg: string) => setStatus({ type, msg });
  return { status, set };
}

// ─── Fund Treasury ────────────────────────────────────────────────────────────

function FundTreasury() {
  const { address } = useAccount();
  const [amount, setAmount] = useState("");
  const { status, set } = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!address || !amount) return;
    try {
      set("busy", "Encrypting amount…");
      const usdc = BigInt(Math.round(parseFloat(amount) * Number(SCALE)));
      const { handle, inputProof } = await encrypt64(usdc, PAYROLL_ADDRESS, address);

      set("busy", "Sending transaction…");
      await writeContractAsync({
        address:      PAYROLL_ADDRESS,
        abi:          PAYROLL_ABI,
        functionName: "fundTreasury",
        args:         [handle, inputProof],
      });
      set("ok", `Treasury funded with $${amount} USDC (encrypted).`);
      setAmount("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Fund Treasury">
      <label>Amount (USDC)</label>
      <input type="number" placeholder="10000" value={amount} onChange={e => setAmount(e.target.value)} />
      <Btn onClick={submit} busy={status.type === "busy"}>Encrypt & Fund</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Treasury Balance ─────────────────────────────────────────────────────────

function TreasuryBalance() {
  const { address } = useAccount();
  const [balance, setBalance] = useState<string | null>(null);
  const { status, set } = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: handle } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getEncryptedTreasuryBalance",
  });

  async function decrypt() {
    if (!address || !handle || handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      set("err", "No treasury balance found. Fund the treasury first.");
      return;
    }
    try {
      set("busy", "Requesting decryption signature…");
      const raw = await decrypt64(handle, TOKEN_ADDRESS, address, signTypedDataAsync);
      setBalance(formatUSDC(raw));
      set("ok", "Decrypted.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Treasury Balance">
      {balance && <p className="decrypted-value">{balance}</p>}
      <Btn onClick={decrypt} busy={status.type === "busy"}>Decrypt Balance</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Add Employee ─────────────────────────────────────────────────────────────

function AddEmployee() {
  const { address } = useAccount();
  const [wallet, setWallet]  = useState("");
  const [name, setName]      = useState("");
  const [salary, setSalary]  = useState("");
  const { status, set }      = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!address || !wallet || !name || !salary) return;
    try {
      set("busy", "Encrypting salary…");
      const usdc = BigInt(Math.round(parseFloat(salary) * Number(SCALE)));
      const { handle, inputProof } = await encrypt64(usdc, PAYROLL_ADDRESS, address);

      set("busy", "Sending transaction…");
      await writeContractAsync({
        address:      PAYROLL_ADDRESS,
        abi:          PAYROLL_ABI,
        functionName: "addEmployee",
        args:         [wallet as `0x${string}`, name, handle, inputProof],
      });
      set("ok", `${name} added with encrypted salary $${salary}.`);
      setWallet(""); setName(""); setSalary("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Add Employee">
      <label>Wallet Address</label>
      <input placeholder="0x..." value={wallet} onChange={e => setWallet(e.target.value)} />
      <label>Name</label>
      <input placeholder="Alice" value={name} onChange={e => setName(e.target.value)} />
      <label>Monthly Salary (USDC)</label>
      <input type="number" placeholder="5000" value={salary} onChange={e => setSalary(e.target.value)} />
      <Btn onClick={submit} busy={status.type === "busy"}>Encrypt & Add</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Update Salary ────────────────────────────────────────────────────────────

function UpdateSalary() {
  const { address } = useAccount();
  const [wallet, setWallet]  = useState("");
  const [salary, setSalary]  = useState("");
  const { status, set }      = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!address || !wallet || !salary) return;
    try {
      set("busy", "Encrypting new salary…");
      const usdc = BigInt(Math.round(parseFloat(salary) * Number(SCALE)));
      const { handle, inputProof } = await encrypt64(usdc, PAYROLL_ADDRESS, address);

      set("busy", "Sending transaction…");
      await writeContractAsync({
        address:      PAYROLL_ADDRESS,
        abi:          PAYROLL_ABI,
        functionName: "updateSalary",
        args:         [wallet as `0x${string}`, handle, inputProof],
      });
      set("ok", "Salary updated.");
      setWallet(""); setSalary("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Update Salary">
      <label>Employee Wallet</label>
      <input placeholder="0x..." value={wallet} onChange={e => setWallet(e.target.value)} />
      <label>New Monthly Salary (USDC)</label>
      <input type="number" placeholder="6500" value={salary} onChange={e => setSalary(e.target.value)} />
      <Btn onClick={submit} busy={status.type === "busy"}>Encrypt & Update</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Remove Employee ──────────────────────────────────────────────────────────

function RemoveEmployee() {
  const [wallet, setWallet]    = useState("");
  const { status, set }        = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!wallet) return;
    try {
      set("busy", "Sending transaction…");
      await writeContractAsync({
        address:      PAYROLL_ADDRESS,
        abi:          PAYROLL_ABI,
        functionName: "removeEmployee",
        args:         [wallet as `0x${string}`],
      });
      set("ok", "Employee removed.");
      setWallet("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Remove Employee">
      <label>Employee Wallet</label>
      <input placeholder="0x..." value={wallet} onChange={e => setWallet(e.target.value)} />
      <Btn onClick={submit} busy={status.type === "busy"} danger>Remove</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Execute Payroll ──────────────────────────────────────────────────────────

function ExecutePayroll() {
  const { status, set }        = useStatus();
  const { writeContractAsync } = useWriteContract();

  const { data: info } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getPayrollInfo",
  });

  async function submit() {
    try {
      set("busy", "Executing payroll…");
      await writeContractAsync({
        address:      PAYROLL_ADDRESS,
        abi:          PAYROLL_ABI,
        functionName: "executePayroll",
      });
      set("ok", "Payroll executed. All active employees paid.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Execute Payroll">
      {info && (
        <p className="hint">
          Current cycle: <strong>#{String(info[0])}</strong>
        </p>
      )}
      <Btn onClick={submit} busy={status.type === "busy"}>Run Payroll</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── View Employee Salary (employer side) ─────────────────────────────────────

function ViewEmployeeSalary() {
  const { address } = useAccount();
  const [wallet, setWallet] = useState("");
  const [salary, setSalary] = useState<string | null>(null);
  const { status, set }     = useStatus();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const { data: handle, refetch } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getEmployeeSalary",
    args:         wallet ? [wallet as `0x${string}`] : undefined,
    query:        { enabled: false },
  });

  async function decrypt() {
    if (!address || !wallet) return;
    try {
      set("busy", "Fetching handle…");
      const { data: h } = await refetch();
      if (!h) { set("err", "Not found"); return; }

      set("busy", "Requesting decryption…");
      const raw = await decrypt64(h as string, PAYROLL_ADDRESS, address, signTypedDataAsync);
      setSalary(formatUSDC(raw));
      set("ok", "Decrypted.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="View Employee Salary">
      <label>Employee Wallet</label>
      <input placeholder="0x..." value={wallet} onChange={e => { setWallet(e.target.value); setSalary(null); }} />
      {salary && <p className="decrypted-value">{salary}/mo</p>}
      <Btn onClick={decrypt} busy={status.type === "busy"}>Decrypt Salary</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Employer Page ────────────────────────────────────────────────────────────

export default function Employer({ isEmployer }: { isEmployer: boolean }) {
  return (
    <div className="page">
      {!isEmployer && (
        <div className="warning">
          ⚠️ Connected wallet is not the employer. Write actions will fail.
        </div>
      )}
      <div className="grid">
        <FundTreasury />
        <TreasuryBalance />
        <AddEmployee />
        <UpdateSalary />
        <RemoveEmployee />
        <ExecutePayroll />
        <ViewEmployeeSalary />
      </div>
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function Btn({ onClick, busy, danger, children }: {
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`btn ${danger ? "btn-danger" : ""}`}
      onClick={onClick}
      disabled={busy}
    >
      {busy ? "…" : children}
    </button>
  );
}

function Msg({ status }: { status: Status }) {
  if (status.type === "idle") return null;
  return (
    <p className={`status status-${status.type}`}>
      {status.type === "busy" && <span className="spinner" />}
      {status.msg}
    </p>
  );
}
