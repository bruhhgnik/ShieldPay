import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useReadContract } from "wagmi";
import { PAYROLL_ADDRESS, PAYROLL_ABI } from "./lib/contracts";
import Employer from "./pages/Employer";
import Employee from "./pages/Employee";

type View = "employer" | "employee";

export default function App() {
  const { address, isConnected } = useAccount();
  const [view, setView] = useState<View>("employer");

  const { data: employerAddress } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "employer",
  });

  const { data: payrollInfo } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getPayrollInfo",
  });

  const { data: employeeCount } = useReadContract({
    address:      PAYROLL_ADDRESS,
    abi:          PAYROLL_ABI,
    functionName: "getEmployeeCount",
  });

  const isEmployer = isConnected && employerAddress?.toLowerCase() === address?.toLowerCase();

  return (
    <div className="app">
      {/* ── Header ── */}
      <header>
        <div className="header-left">
          <span className="logo">🛡️ ShieldPay</span>
          <span className="tagline">Confidential Onchain Payroll · Sepolia</span>
        </div>
        <ConnectButton />
      </header>

      {/* ── Stats Bar ── */}
      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Pay Cycle</span>
          <span className="stat-value">#{payrollInfo ? String(payrollInfo[0]) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Employees</span>
          <span className="stat-value">{employeeCount !== undefined ? String(employeeCount) : "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Your Role</span>
          <span className="stat-value role">
            {!isConnected ? "—" : isEmployer ? "Employer" : "Employee"}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Contract</span>
          <span className="stat-value mono">{PAYROLL_ADDRESS.slice(0, 10)}…</span>
        </div>
      </div>

      {/* ── Nav Tabs ── */}
      <nav className="tabs">
        <button
          className={view === "employer" ? "tab active" : "tab"}
          onClick={() => setView("employer")}
        >
          Employer
        </button>
        <button
          className={view === "employee" ? "tab active" : "tab"}
          onClick={() => setView("employee")}
        >
          Employee
        </button>
      </nav>

      {/* ── Page Content ── */}
      <main>
        {!isConnected ? (
          <div className="empty-state">
            <p>Connect your wallet to interact with ShieldPay.</p>
            <p className="hint">
              Employer: <code>{employerAddress ?? "..."}</code>
            </p>
          </div>
        ) : view === "employer" ? (
          <Employer isEmployer={isEmployer} />
        ) : (
          <Employee />
        )}
      </main>
    </div>
  );
}
