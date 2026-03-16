import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
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
        address: PAYROLL_ADDRESS,
        abi: PAYROLL_ABI,
        functionName: "fundTreasury",
        args: [handle, inputProof],
      });
      set("ok", `Treasury funded with $${amount} spUSD.`);
      setAmount("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="💰" iconColor="card-icon-purple" title="Fund Treasury">
      <div className="field">
        <label>Amount (USDC)</label>
        <input type="number" placeholder="10000" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Btn onClick={submit} busy={status.type === "busy"}>
        Encrypt & Fund
      </Btn>
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

  const { data: handle, isPending: handleLoading } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getEncryptedTreasuryBalance",
  });

  const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const hasBalance = handle && handle !== ZERO_HANDLE;

  async function decrypt() {
    if (!address) return set("err", "Connect wallet first.");
    if (handleLoading) return set("err", "Loading…");
    if (!hasBalance) return set("err", "No treasury balance. Fund first.");
    try {
      set("busy", "Requesting signature…");
      const raw = await decrypt64(handle, TOKEN_ADDRESS, address, signTypedDataAsync);
      setBalance(formatUSDC(raw));
      set("ok", "Decrypted.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="🔒" iconColor="card-icon-green" title="Treasury Balance">
      {balance ? (
        <div className="balance-display">
          <span className="balance-label">Decrypted Balance</span>
          <p className="decrypted-value">{balance}</p>
        </div>
      ) : (
        !handleLoading && !hasBalance && (
          <p className="hint text-muted">No balance — fund the treasury first.</p>
        )
      )}
      <Btn onClick={decrypt} busy={status.type === "busy"} disabled={handleLoading || !hasBalance} variant="ghost">
        {balance ? "Re-decrypt" : "Decrypt Balance"}
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Add Employee ─────────────────────────────────────────────────────────────

function AddEmployee() {
  const { address } = useAccount();
  const [wallet, setWallet] = useState("");
  const [name, setName] = useState("");
  const [salary, setSalary] = useState("");
  const { status, set } = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!address || !wallet || !name || !salary) return;
    try {
      set("busy", "Encrypting salary…");
      const usdc = BigInt(Math.round(parseFloat(salary) * Number(SCALE)));
      const { handle, inputProof } = await encrypt64(usdc, PAYROLL_ADDRESS, address);
      set("busy", "Sending transaction…");
      await writeContractAsync({
        address: PAYROLL_ADDRESS,
        abi: PAYROLL_ABI,
        functionName: "addEmployee",
        args: [wallet as `0x${string}`, name, handle, inputProof],
      });
      set("ok", `${name} added.`);
      setWallet("");
      setName("");
      setSalary("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="➕" iconColor="card-icon-green" title="Add Employee">
      <div className="field">
        <label>Wallet Address</label>
        <input placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
      </div>
      <div className="field">
        <label>Name</label>
        <input placeholder="Alice" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label>Monthly Salary (USDC)</label>
        <input type="number" placeholder="5000" value={salary} onChange={(e) => setSalary(e.target.value)} />
      </div>
      <Btn onClick={submit} busy={status.type === "busy"}>
        Encrypt & Add
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Update Salary ────────────────────────────────────────────────────────────

function UpdateSalary() {
  const { address } = useAccount();
  const [wallet, setWallet] = useState("");
  const [salary, setSalary] = useState("");
  const { status, set } = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!address || !wallet || !salary) return;
    try {
      set("busy", "Encrypting salary…");
      const usdc = BigInt(Math.round(parseFloat(salary) * Number(SCALE)));
      const { handle, inputProof } = await encrypt64(usdc, PAYROLL_ADDRESS, address);
      set("busy", "Sending transaction…");
      await writeContractAsync({
        address: PAYROLL_ADDRESS,
        abi: PAYROLL_ABI,
        functionName: "updateSalary",
        args: [wallet as `0x${string}`, handle, inputProof],
      });
      set("ok", "Salary updated.");
      setWallet("");
      setSalary("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="✏️" iconColor="card-icon-blue" title="Update Salary">
      <div className="field">
        <label>Employee Wallet</label>
        <input placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
      </div>
      <div className="field">
        <label>New Monthly Salary (USDC)</label>
        <input type="number" placeholder="6500" value={salary} onChange={(e) => setSalary(e.target.value)} />
      </div>
      <Btn onClick={submit} busy={status.type === "busy"}>
        Encrypt & Update
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Remove Employee ──────────────────────────────────────────────────────────

function RemoveEmployee() {
  const [wallet, setWallet] = useState("");
  const { status, set } = useStatus();
  const { writeContractAsync } = useWriteContract();

  async function submit() {
    if (!wallet) return;
    try {
      set("busy", "Sending transaction…");
      await writeContractAsync({
        address: PAYROLL_ADDRESS,
        abi: PAYROLL_ABI,
        functionName: "removeEmployee",
        args: [wallet as `0x${string}`],
      });
      set("ok", "Employee removed.");
      setWallet("");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="🗑️" iconColor="card-icon-red" title="Remove Employee">
      <div className="field">
        <label>Employee Wallet</label>
        <input placeholder="0x…" value={wallet} onChange={(e) => setWallet(e.target.value)} />
      </div>
      <Btn onClick={submit} busy={status.type === "busy"} variant="danger">
        Remove Employee
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Execute Payroll ──────────────────────────────────────────────────────────

function ExecutePayroll() {
  const { status, set } = useStatus();
  const { writeContractAsync } = useWriteContract();

  const { data: info } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getPayrollInfo",
  });

  async function submit() {
    try {
      set("busy", "Executing payroll…");
      await writeContractAsync({
        address: PAYROLL_ADDRESS,
        abi: PAYROLL_ABI,
        functionName: "executePayroll",
      });
      set("ok", "Payroll executed. All active employees paid.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="🚀" iconColor="card-icon-amber" title="Execute Payroll">
      {info && (
        <div className="info-row">
          <span>Current cycle</span>
          <strong>#{String(info[0])}</strong>
        </div>
      )}
      <p className="hint">
        Transfers encrypted salary to every active employee in a single transaction.
      </p>
      <Btn onClick={submit} busy={status.type === "busy"} variant="green">
        Run Payroll
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── View Employee Salary ─────────────────────────────────────────────────────

function ViewEmployeeSalary() {
  const { address } = useAccount();
  const [wallet, setWallet] = useState("");
  const [salary, setSalary] = useState<string | null>(null);
  const { status, set } = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { refetch } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getEmployeeSalary",
    args: wallet ? [wallet as `0x${string}`] : undefined,
    query: { enabled: false },
  });

  async function decrypt() {
    if (!address || !wallet) return;
    try {
      set("busy", "Fetching handle…");
      const { data: h } = await refetch();
      if (!h) return set("err", "Employee not found.");
      set("busy", "Requesting signature…");
      const raw = await decrypt64(h as string, PAYROLL_ADDRESS, address, signTypedDataAsync);
      setSalary(formatUSDC(raw));
      set("ok", "Decrypted.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="👁️" iconColor="card-icon-purple" title="View Employee Salary">
      <div className="field">
        <label>Employee Wallet</label>
        <input
          placeholder="0x…"
          value={wallet}
          onChange={(e) => { setWallet(e.target.value); setSalary(null); }}
        />
      </div>
      {salary && (
        <div className="balance-display">
          <span className="balance-label">Monthly Salary</span>
          <p className="decrypted-value">{salary}<span className="unit">/mo</span></p>
        </div>
      )}
      <Btn onClick={decrypt} busy={status.type === "busy"} variant="ghost">
        Decrypt Salary
      </Btn>
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
          ⚠️ Connected wallet is not the employer — write actions will revert.
        </div>
      )}

      <div className="section">
        <div className="section-header">
          <span className="section-icon">🏦</span>
          <span className="section-title">Treasury</span>
          <span className="section-tag section-tag-treasury">spUSD</span>
        </div>
        <div className="grid">
          <FundTreasury />
          <TreasuryBalance />
          <ExecutePayroll />
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-icon">👥</span>
          <span className="section-title">Team Management</span>
          <span className="section-tag section-tag-team">Employees</span>
        </div>
        <div className="grid">
          <AddEmployee />
          <UpdateSalary />
          <RemoveEmployee />
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-icon">🔍</span>
          <span className="section-title">Inspect</span>
          <span className="section-tag section-tag-payroll">Employer Only</span>
        </div>
        <div className="grid">
          <ViewEmployeeSalary />
        </div>
      </div>
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────

function Card({
  title,
  icon,
  iconColor,
  children,
  faucet,
}: {
  title: string;
  icon?: string;
  iconColor?: string;
  children: React.ReactNode;
  faucet?: boolean;
}) {
  return (
    <div className={`card${faucet ? " card-faucet" : ""}`}>
      <div className="card-header">
        {icon && <div className={`card-icon ${iconColor ?? ""}`}>{icon}</div>}
        <h3>{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Btn({
  onClick,
  busy,
  variant,
  disabled,
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  variant?: "danger" | "ghost" | "green";
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const cls = variant === "danger" ? "btn btn-danger"
    : variant === "ghost" ? "btn btn-ghost"
    : variant === "green" ? "btn btn-green"
    : "btn";
  return (
    <button className={cls} onClick={onClick} disabled={busy || disabled}>
      {busy ? <><span className="spinner" /> Working…</> : children}
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
