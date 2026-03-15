// ─── Deployed Contract Addresses (Sepolia) ───────────────────────────────────

export const PAYROLL_ADDRESS = "0xd5053e15c093e888F5f84Aa9eFAA7a0B8aB2f83e" as const;
export const TOKEN_ADDRESS = "0x8447eE83A3c368e4a33a40908C0d807C9F74DB17" as const;

// ─── ABIs ────────────────────────────────────────────────────────────────────

export const PAYROLL_ABI = [
  // State reads
  { name: "employer", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { name: "currentPayCycle", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "employeeList",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  { name: "getEmployeeCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    name: "getPayrollInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "cycle", type: "uint256" },
      { name: "nextPayAt", type: "uint256" },
    ],
  },
  {
    name: "isEmployee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "getEmployeeName",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "string" }],
  },

  // Encrypted reads (return bytes32 handle)
  {
    name: "getEncryptedTreasuryBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getEmployeeSalary",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getMyEncryptedSalary",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getMyEncryptedBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "getMyPaymentForCycle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "cycle", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
  },

  // Employer writes
  {
    name: "fundTreasury",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "encAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "addEmployee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "name", type: "string" },
      { name: "encSalary", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "updateSalary",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "wallet", type: "address" },
      { name: "newEncSalary", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "removeEmployee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [],
  },
  { name: "executePayroll", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },

  // Events
  {
    name: "EmployeeAdded",
    type: "event",
    inputs: [
      { indexed: true, name: "wallet", type: "address" },
      { name: "name", type: "string" },
    ],
  },
  { name: "EmployeeRemoved", type: "event", inputs: [{ indexed: true, name: "wallet", type: "address" }] },
  {
    name: "PayrollExecuted",
    type: "event",
    inputs: [
      { indexed: true, name: "cycle", type: "uint256" },
      { name: "employeeCount", type: "uint256" },
    ],
  },
  { name: "TreasuryFunded", type: "event", inputs: [] },
  { name: "SalaryUpdated", type: "event", inputs: [{ indexed: true, name: "wallet", type: "address" }] },
] as const;

export const TOKEN_ABI = [
  {
    name: "encryptedBalanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bytes32" }],
  },
] as const;

// ─── Zama Sepolia Config ──────────────────────────────────────────────────────

export const ZAMA_SEPOLIA = {
  aclAddress: "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D",
  kmsAddress: "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A",
  relayerUrl: "https://relayer.testnet.zama.org/v1/",
  networkUrl: import.meta.env.VITE_ALCHEMY_RPC_URL ?? "https://eth-sepolia.g.alchemy.com/v2/D0zuv4GsCAFG-EpaH-J2m",
};

export const DECIMALS = 6n; // USDC convention
export const SCALE = 10n ** DECIMALS;

export function formatUSDC(raw: bigint): string {
  const whole = raw / SCALE;
  const frac = raw % SCALE;
  return `$${whole.toLocaleString()}.${frac.toString().padStart(6, "0").slice(0, 2)}`;
}
