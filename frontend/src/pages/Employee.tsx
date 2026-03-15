import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useSignTypedData } from "wagmi";
import { PAYROLL_ADDRESS, TOKEN_ADDRESS, PAYROLL_ABI, TOKEN_ABI, formatUSDC } from "../lib/contracts";
import { decrypt64 } from "../lib/fhevm";

type Status = { type: "idle" | "busy" | "ok" | "err"; msg: string };

function useStatus() {
  const [status, setStatus] = useState<Status>({ type: "idle", msg: "" });
  const set = (type: Status["type"], msg: string) => setStatus({ type, msg });
  return { status, set };
}

// ─── My Salary ───────────────────────────────────────────────────────────────

function MySalary() {
  const { address } = useAccount();
  const [salary, setSalary]    = useState<string | null>(null);
  const { status, set }        = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: handle } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getMyEncryptedSalary",
    account:      address,
  });

  async function decrypt() {
    if (!address || !handle) { set("err", "No salary handle found."); return; }
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
    <Card title="My Salary">
      {salary && <p className="decrypted-value">{salary}<span className="unit">/mo</span></p>}
      <Btn onClick={decrypt} busy={status.type === "busy"}>Decrypt My Salary</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── My Token Balance ─────────────────────────────────────────────────────────

function MyBalance() {
  const { address } = useAccount();
  const [balance, setBalance]  = useState<string | null>(null);
  const { status, set }        = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: handle } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getMyEncryptedBalance",
    account:      address,
  });

  async function decrypt() {
    if (!address || !handle) { set("err", "No balance handle found."); return; }
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
    <Card title="My spUSD Balance">
      {balance && <p className="decrypted-value">{balance}</p>}
      <Btn onClick={decrypt} busy={status.type === "busy"}>Decrypt Balance</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Payment History ──────────────────────────────────────────────────────────

function PaymentHistory() {
  const { address } = useAccount();
  const [cycle, setCycle]      = useState("");
  const [amount, setAmount]    = useState<string | null>(null);
  const { status, set }        = useStatus();
  const { signTypedDataAsync } = useSignTypedData();

  const { data: handle, refetch } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getMyPaymentForCycle",
    args:         cycle ? [BigInt(cycle)] : undefined,
    account:      address,
    query:        { enabled: false },
  });

  async function decrypt() {
    if (!address || !cycle) return;
    try {
      set("busy", "Fetching handle…");
      const { data: h } = await refetch();
      if (!h || h === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        set("err", `No payment record for cycle ${cycle}.`);
        return;
      }
      set("busy", "Sign to decrypt…");
      const raw = await decrypt64(h as string, PAYROLL_ADDRESS, address, signTypedDataAsync);
      setAmount(formatUSDC(raw));
      set("ok", `Cycle ${cycle} payment verified.`);
    } catch (e: unknown) {
      set("err", (e as Error).message ?? "Failed");
    }
  }

  return (
    <Card title="Payment History">
      <label>Pay Cycle #</label>
      <input
        type="number"
        placeholder="1"
        value={cycle}
        onChange={e => { setCycle(e.target.value); setAmount(null); }}
      />
      {amount && (
        <p className="decrypted-value">
          Cycle {cycle}: {amount}
        </p>
      )}
      <Btn onClick={decrypt} busy={status.type === "busy"}>Verify Payment</Btn>
      <Msg status={status} />
    </Card>
  );
}

// ─── Employee Status ──────────────────────────────────────────────────────────

function EmployeeStatus() {
  const { address } = useAccount();

  const { data: isActive } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "isEmployee",
    args:         address ? [address] : undefined,
  });

  const { data: name } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getEmployeeName",
    args:         address ? [address] : undefined,
  });

  const { data: cycle } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "currentPayCycle",
  });

  return (
    <Card title="My Status">
      <div className="info-row">
        <span>Name</span>
        <strong>{name || "—"}</strong>
      </div>
      <div className="info-row">
        <span>Active</span>
        <strong className={isActive ? "text-green" : "text-red"}>
          {isActive === undefined ? "—" : isActive ? "Yes" : "No"}
        </strong>
      </div>
      <div className="info-row">
        <span>Current Cycle</span>
        <strong>#{cycle !== undefined ? String(cycle) : "—"}</strong>
      </div>
    </Card>
  );
}

// ─── Employee Page ────────────────────────────────────────────────────────────

export default function Employee() {
  return (
    <div className="page">
      <div className="grid">
        <EmployeeStatus />
        <MySalary />
        <MyBalance />
        <PaymentHistory />
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

function Btn({ onClick, busy, children }: {
  onClick: () => void;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button className="btn" onClick={onClick} disabled={busy}>
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
