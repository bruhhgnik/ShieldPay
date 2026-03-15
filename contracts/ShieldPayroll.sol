// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IConfidentialToken} from "./interfaces/IConfidentialToken.sol";

/// @title ShieldPayroll — Confidential onchain payroll protocol
/// @notice Employer sets encrypted salaries per employee. Payroll execution
///         transfers encrypted amounts via ERC-7984 ConfidentialToken.
///         Only the employer and each respective employee can decrypt salaries.
///         All amounts remain encrypted on-chain at all times.
contract ShieldPayroll is ZamaEthereumConfig {
    // ─── Types ───────────────────────────────────────────────────────────────

    struct Employee {
        address wallet;
        euint64 encryptedSalary; // encrypted monthly salary handle
        bool active;
        uint256 lastPaidCycle;   // plaintext — reveals nothing sensitive
        string name;             // plaintext — employer knows employee names
    }

    // ─── State ───────────────────────────────────────────────────────────────

    address public immutable employer;
    IConfidentialToken public immutable token;

    uint256 public currentPayCycle;
    uint256 public payPeriod;       // seconds between cycles (0 = no restriction for demo)
    uint256 public lastPayTimestamp;

    mapping(address => Employee) private _employees;
    address[] public employeeList;

    // Per-employee payment record per cycle (handle = salary at time of payment)
    mapping(address => mapping(uint256 => euint64)) private _paymentHistory;

    // ─── Events ──────────────────────────────────────────────────────────────

    event EmployeeAdded(address indexed wallet, string name);
    event EmployeeRemoved(address indexed wallet);
    event SalaryUpdated(address indexed wallet);
    event PayrollExecuted(uint256 indexed cycle, uint256 employeeCount);
    event PaymentExecuted(address indexed wallet, uint256 indexed cycle);
    event TreasuryFunded();

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotEmployer();
    error NotEmployee();
    error AlreadyEmployee();
    error NotAnEmployee();
    error TooEarlyForPayroll();
    error ArrayLengthMismatch();
    error ZeroAddress();

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyEmployer() {
        if (msg.sender != employer) revert NotEmployer();
        _;
    }

    modifier onlyEmployee() {
        if (!_employees[msg.sender].active) revert NotEmployee();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address tokenAddress, uint256 _payPeriod) {
        if (tokenAddress == address(0)) revert ZeroAddress();
        employer = msg.sender;
        token = IConfidentialToken(tokenAddress);
        payPeriod = _payPeriod;
        lastPayTimestamp = block.timestamp;
    }

    // ─── Employer: Employee Management ───────────────────────────────────────

    /// @notice Add a single employee with an encrypted salary.
    /// @param wallet       Employee wallet address
    /// @param name         Employee display name (plaintext)
    /// @param encSalary    Encrypted salary handle from client-side encryption
    /// @param inputProof   ZKP proof for the encrypted input
    function addEmployee(
        address wallet,
        string calldata name,
        externalEuint64 encSalary,
        bytes calldata inputProof
    ) external onlyEmployer {
        if (wallet == address(0)) revert ZeroAddress();
        if (_employees[wallet].active) revert AlreadyEmployee();

        euint64 salary = FHE.fromExternal(encSalary, inputProof);

        _employees[wallet] = Employee({
            wallet: wallet,
            encryptedSalary: salary,
            active: true,
            lastPaidCycle: 0,
            name: name
        });

        employeeList.push(wallet);

        _setSalaryACL(wallet, salary);

        emit EmployeeAdded(wallet, name);
    }

    /// @notice Add multiple employees in a single transaction.
    function batchAddEmployees(
        address[] calldata wallets,
        string[] calldata names,
        externalEuint64[] calldata encSalaries,
        bytes[] calldata inputProofs
    ) external onlyEmployer {
        if (
            wallets.length != names.length ||
            wallets.length != encSalaries.length ||
            wallets.length != inputProofs.length
        ) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < wallets.length; i++) {
            address wallet = wallets[i];
            if (wallet == address(0)) revert ZeroAddress();
            if (_employees[wallet].active) revert AlreadyEmployee();

            euint64 salary = FHE.fromExternal(encSalaries[i], inputProofs[i]);

            _employees[wallet] = Employee({
                wallet: wallet,
                encryptedSalary: salary,
                active: true,
                lastPaidCycle: 0,
                name: names[i]
            });

            employeeList.push(wallet);
            _setSalaryACL(wallet, salary);

            emit EmployeeAdded(wallet, names[i]);
        }
    }

    /// @notice Update an employee's salary. Old salary handle is replaced;
    ///         payment history entries from prior cycles remain unchanged.
    function updateSalary(
        address wallet,
        externalEuint64 newEncSalary,
        bytes calldata inputProof
    ) external onlyEmployer {
        if (!_employees[wallet].active) revert NotAnEmployee();

        euint64 newSalary = FHE.fromExternal(newEncSalary, inputProof);
        _employees[wallet].encryptedSalary = newSalary;

        _setSalaryACL(wallet, newSalary);

        emit SalaryUpdated(wallet);
    }

    /// @notice Deactivate an employee. They will not receive future payroll.
    function removeEmployee(address wallet) external onlyEmployer {
        if (!_employees[wallet].active) revert NotAnEmployee();
        _employees[wallet].active = false;
        emit EmployeeRemoved(wallet);
    }

    // ─── Employer: Treasury & Payroll ────────────────────────────────────────

    /// @notice Fund the payroll treasury with encrypted tokens.
    ///         Proof is verified here (ShieldPayroll context), then internal
    ///         handle is passed to ConfidentialToken.mint.
    ///         Employer also gets ACL access to verify treasury balance.
    function fundTreasury(externalEuint64 encAmount, bytes calldata inputProof) external onlyEmployer {
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        FHE.allow(amount, address(token)); // token needs ACL to use handle in FHE.add
        token.mint(address(this), amount);
        token.grantBalanceAccess(address(this), employer);
        emit TreasuryFunded();
    }

    /// @notice Execute payroll for all active, unpaid employees in this cycle.
    ///         Each employee receives their encrypted salary from the treasury.
    ///         No salary amount is ever exposed in plaintext.
    function executePayroll() external onlyEmployer {
        if (payPeriod > 0 && block.timestamp < lastPayTimestamp + payPeriod) {
            revert TooEarlyForPayroll();
        }

        currentPayCycle++;
        lastPayTimestamp = block.timestamp;

        uint256 paid = 0;
        for (uint256 i = 0; i < employeeList.length; i++) {
            address wallet = employeeList[i];
            Employee storage emp = _employees[wallet];

            if (!emp.active || emp.lastPaidCycle >= currentPayCycle) continue;

            // Transfer encrypted salary from treasury to employee
            token.confidentialTransfer(address(this), wallet, emp.encryptedSalary);

            // Record payment handle for employee to verify later
            _paymentHistory[wallet][currentPayCycle] = emp.encryptedSalary;
            // Employee already has ACL on this handle from _setSalaryACL

            emp.lastPaidCycle = currentPayCycle;
            paid++;

            emit PaymentExecuted(wallet, currentPayCycle);
        }

        // Re-grant employer ACL on updated treasury balance
        // (confidentialTransfer creates a new handle via FHE.sub; ACL must be re-set)
        token.grantBalanceAccess(address(this), employer);

        emit PayrollExecuted(currentPayCycle, paid);
    }

    // ─── Employer: Read ───────────────────────────────────────────────────────

    /// @notice Employer reads the treasury's encrypted balance handle.
    function getEncryptedTreasuryBalance() external view onlyEmployer returns (euint64) {
        return token.encryptedBalanceOf(address(this));
    }

    /// @notice Employer reads any employee's encrypted salary handle.
    function getEmployeeSalary(address wallet) external view onlyEmployer returns (euint64) {
        return _employees[wallet].encryptedSalary;
    }

    // ─── Employee: Read ───────────────────────────────────────────────────────

    /// @notice Employee reads their own encrypted salary handle.
    ///         ACL on this handle is set to the calling employee only.
    function getMyEncryptedSalary() external view onlyEmployee returns (euint64) {
        return _employees[msg.sender].encryptedSalary;
    }

    /// @notice Employee reads their encrypted payment handle for a given cycle.
    function getMyPaymentForCycle(uint256 cycle) external view onlyEmployee returns (euint64) {
        return _paymentHistory[msg.sender][cycle];
    }

    /// @notice Employee reads their encrypted token balance handle.
    function getMyEncryptedBalance() external view onlyEmployee returns (euint64) {
        return token.encryptedBalanceOf(msg.sender);
    }

    // ─── Public Views ─────────────────────────────────────────────────────────

    function isEmployee(address wallet) external view returns (bool) {
        return _employees[wallet].active;
    }

    function getEmployeeCount() external view returns (uint256) {
        uint256 count = 0;
        for (uint256 i = 0; i < employeeList.length; i++) {
            if (_employees[employeeList[i]].active) count++;
        }
        return count;
    }

    function getPayrollInfo() external view returns (uint256 cycle, uint256 nextPayAt) {
        cycle = currentPayCycle;
        nextPayAt = payPeriod > 0 ? lastPayTimestamp + payPeriod : block.timestamp;
    }

    function getEmployeeName(address wallet) external view returns (string memory) {
        return _employees[wallet].name;
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    /// @dev Set ACL permissions on a salary handle:
    ///      - ShieldPayroll (this) can compute with it (for transfer)
    ///      - ConfidentialToken can compute with it (for FHE arithmetic in transfer)
    ///      - Employee can decrypt their own salary
    ///      - Employer can decrypt any salary
    function _setSalaryACL(address wallet, euint64 salary) internal {
        FHE.allowThis(salary);                        // this contract computes with it
        FHE.allow(salary, address(token));            // token computes with it in confidentialTransfer
        FHE.allow(salary, wallet);                    // employee decrypts their own
        FHE.allow(salary, employer);                  // employer decrypts any
    }
}
