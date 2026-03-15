import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useBlockNumber, useReadContract, useReadContracts } from "wagmi";
import { PAYROLL_ADDRESS, PAYROLL_ABI } from "./lib/contracts";
import Employer from "./pages/Employer";
import Employee from "./pages/Employee";

type View = "employer" | "employee";

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

async function switchAccount() {
  const eth = window.ethereum as any;
  await eth?.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  await eth?.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
}

export default function App() {
  const { address, isConnected } = useAccount();
  const [view, setView] = useState<View>("employer");

  const { data: blockNumber } = useBlockNumber({ watch: true });

  const { data: employerAddress } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "employer",
    query: { refetchInterval: false },
    scopeKey: String(blockNumber),
  });

  const { data: payrollInfo } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getPayrollInfo",
    scopeKey: String(blockNumber),
  });

  const { data: employeeCount } = useReadContract({
    address: PAYROLL_ADDRESS,
    abi: PAYROLL_ABI,
    functionName: "getEmployeeCount",
    scopeKey: String(blockNumber),
  });

  const count = Number(employeeCount ?? 0n);

  const { data: employeeAddresses } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: PAYROLL_ADDRESS,
      abi: PAYROLL_ABI,
      functionName: "employeeList" as const,
      args: [BigInt(i)] as const,
    })),
    query: { enabled: count > 0 },
    scopeKey: String(blockNumber),
  });

  const { data: employeeNames } = useReadContracts({
    contracts: (employeeAddresses ?? [])
      .filter((r) => r.status === "success")
      .map((r) => ({
        address: PAYROLL_ADDRESS,
        abi: PAYROLL_ABI,
        functionName: "getEmployeeName" as const,
        args: [r.result as `0x${string}`] as const,
      })),
    query: { enabled: (employeeAddresses ?? []).some((r) => r.status === "success") },
    scopeKey: String(blockNumber),
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
        <div className="header-right">
          <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
              const connected = mounted && account && chain;
              return (
                <div className="wallet-area">
                  {connected ? (
                    <>
                      <button className="btn-switch" onClick={switchAccount}>
                        Switch Account
                      </button>
                      <button className="wallet-btn" onClick={openAccountModal}>
                        <span className="wallet-addr">{shortAddr(account.address)}</span>
                        <span className="wallet-caret">▼</span>
                      </button>
                    </>
                  ) : (
                    <button className="wallet-btn-connect" onClick={openConnectModal}>
                      Connect Wallet
                    </button>
                  )}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </div>
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
          <span className="stat-value role">{!isConnected ? "—" : isEmployer ? "Employer" : "Employee"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Contract</span>
          <span className="stat-value mono">{PAYROLL_ADDRESS.slice(0, 10)}…</span>
        </div>
      </div>

      {/* ── Roster ── */}
      <div className="roster">
        <div className="roster-row">
          <span className="roster-badge employer-badge">Employer</span>
          <span className="roster-addr mono">{employerAddress ? employerAddress : "—"}</span>
        </div>
        {(employeeAddresses ?? []).map((r, i) => {
          if (r.status !== "success") return null;
          const addr = r.result as string;
          if (addr.toLowerCase() === employerAddress?.toLowerCase()) return null;
          const name = employeeNames?.[i]?.result as string | undefined;
          return (
            <div key={addr} className="roster-row">
              <span className="roster-badge employee-badge">Employee{name ? ` · ${name}` : ""}</span>
              <span className="roster-addr mono">{addr}</span>
            </div>
          );
        })}
      </div>

      {/* ── Nav Tabs ── */}
      <nav className="tabs">
        <button className={view === "employer" ? "tab active" : "tab"} onClick={() => setView("employer")}>
          Employer
        </button>
        <button className={view === "employee" ? "tab active" : "tab"} onClick={() => setView("employee")}>
          Employee
        </button>
      </nav>

      {/* ── Page Content ── */}
      <main>
        {!isConnected ? (
          <div className="empty-state">
            <p>Connect your wallet to interact with ShieldPay.</p>
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
