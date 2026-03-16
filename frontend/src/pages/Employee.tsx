import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useSignTypedData } from "wagmi";
import { PAYROLL_ADDRESS, TOKEN_ADDRESS, PAYROLL_ABI, formatUSDC } from "../lib/contracts";
import { decrypt64 } from "../lib/fhevm";

type Status = { type: "idle" | "busy" | "ok" | "err"; msg: string };

function useStatus() {
  const [status, setStatus] = useState<Status>({ type: "idle", msg: "" });
  const set = (type: Status["type"], msg: string) => setStatus({ type, msg });
  return { status, set };
}

// ─── Employee Status ──────────────────────────────────────────────────────────

function EmployeeStatus() {
  const { address } = useAccount();

  const { data: isActive } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "isEmployee",
    args: address ? [address] : undefined,
  });

  const { data: name } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getEmployeeName",
    args: address ? [address] : undefined,
  });

  const { data: cycle } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "currentPayCycle",
  });

  return (
    <Card icon="👤" iconColor="card-icon-purple" title="My Status">
      <div className="info-row">
        <span>Name</span>
        <strong>{name || "—"}</strong>
      </div>
      <div className="info-row">
        <span>Status</span>
        <span className={`badge ${isActive ? "badge-green" : "badge-red"}`}>
          {isActive === undefined ? "—" : isActive ? "● Active" : "● Inactive"}
        </span>
      </div>
      <div className="info-row">
        <span>Current Cycle</span>
        <strong>#{cycle !== undefined ? String(cycle) : "—"}</strong>
      </div>
    </Card>
  );
}

// ─── My Salary ───────────────────────────────────────────────────────────────

function MySalary() {
  const { address } = useAccount();
  const [salary, setSalary] = useState<string | null>(null);
  const { status, set } = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: handle } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getMyEncryptedSalary",
    account: address,
  });

  async function decrypt() {
    if (!address || !handle) return set("err", "No salary handle found.");
    try {
      set("busy", "Sign to decrypt…");
      const raw = await decrypt64(handle as string, PAYROLL_ADDRESS, address, signTypedDataAsync);
      setSalary(formatUSDC(raw));
      set("ok", "Decrypted.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="💸" iconColor="card-icon-green" title="My Salary">
      {salary && (
        <div className="balance-display">
          <span className="balance-label">Monthly Salary</span>
          <p className="decrypted-value">{salary}<span className="unit">/mo</span></p>
        </div>
      )}
      <Btn onClick={decrypt} busy={status.type === "busy"} variant="ghost">
        {salary ? "Re-decrypt" : "Decrypt My Salary"}
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── My Token Balance ─────────────────────────────────────────────────────────

function MyBalance() {
  const { address } = useAccount();
  const [balance, setBalance] = useState<string | null>(null);
  const { status, set } = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: handle } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getMyEncryptedBalance",
    account: address,
  });

  async function decrypt() {
    if (!address || !handle) return set("err", "No balance handle found.");
    try {
      set("busy", "Sign to decrypt…");
      const raw = await decrypt64(handle as string, TOKEN_ADDRESS, address, signTypedDataAsync);
      setBalance(formatUSDC(raw));
      set("ok", "Decrypted.");
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="🏧" iconColor="card-icon-blue" title="My spUSD Balance">
      {balance && (
        <div className="balance-display">
          <span className="balance-label">Total Received</span>
          <p className="decrypted-value">{balance}</p>
        </div>
      )}
      <Btn onClick={decrypt} busy={status.type === "busy"} variant="ghost">
        {balance ? "Re-decrypt" : "Decrypt Balance"}
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Payment History ──────────────────────────────────────────────────────────

function PaymentHistory() {
  const { address } = useAccount();
  const [cycle, setCycle] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const { status, set } = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { refetch } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getMyPaymentForCycle",
    args: cycle ? [BigInt(cycle)] : undefined,
    account: address,
    query: { enabled: false },
  });

  async function decrypt() {
    if (!address || !cycle) return;
    try {
      set("busy", "Fetching handle…");
      const { data: h } = await refetch();
      if (!h || h === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return set("err", `No payment record for cycle #${cycle}.`);
      }
      set("busy", "Sign to decrypt…");
      const raw = await decrypt64(h as string, PAYROLL_ADDRESS, address, signTypedDataAsync);
      setAmount(formatUSDC(raw));
      set("ok", `Cycle #${cycle} verified.`);
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card icon="📜" iconColor="card-icon-amber" title="Payment History">
      <div className="field">
        <label>Pay Cycle #</label>
        <input
          type="number"
          placeholder="1"
          value={cycle}
          onChange={(e) => { setCycle(e.target.value); setAmount(null); }}
        />
      </div>
      {amount && (
        <div className="balance-display">
          <span className="balance-label">Cycle #{cycle} Payment</span>
          <p className="decrypted-value">{amount}</p>
        </div>
      )}
      <Btn onClick={decrypt} busy={status.type === "busy"} variant="ghost">
        Verify Payment
      </Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Employee Page ────────────────────────────────────────────────────────────

export default function Employee() {
  const { address } = useAccount();

  const { data: isActive } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "isEmployee",
    args: address ? [address] : undefined,
  });

  return (
    <div className="page">
      {isActive === false && (
        <div className="warning">
          ⚠️ Your wallet is not registered as an employee on this contract.
        </div>
      )}

      <div className="section">
        <div className="section-header">
          <span className="section-icon">👤</span>
          <span className="section-title">My Account</span>
          <span className="section-tag section-tag-treasury">Encrypted</span>
        </div>
        <div className="grid">
          <EmployeeStatus />
          <MySalary />
          <MyBalance />
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-icon">📋</span>
          <span className="section-title">Payment Records</span>
          <span className="section-tag section-tag-team">Verifiable</span>
        </div>
        <div className="grid">
          <PaymentHistory />
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
}: {
  title: string;
  icon?: string;
  iconColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
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
  children,
}: {
  onClick: () => void;
  busy?: boolean;
  variant?: "ghost" | "green";
  children: React.ReactNode;
}) {
  const cls = variant === "ghost" ? "btn btn-ghost"
    : variant === "green" ? "btn btn-green"
    : "btn";
  return (
    <button className={cls} onClick={onClick} disabled={busy}>
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
