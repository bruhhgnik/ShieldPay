// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialToken — ERC-7984 compatible confidential token
/// @notice Balances are stored as encrypted euint64 handles. Only authorized
///         parties can decrypt their own balance via the Zama KMS ACL.
/// @dev    Owner is ShieldPayroll. All mutations go through ShieldPayroll.
contract ConfidentialToken is ZamaEthereumConfig {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6; // USDC convention: 1 token = 1_000_000 units

    address public owner;

    mapping(address => euint64) private _balances;

    event Mint(address indexed to);
    event ConfidentialTransfer(address indexed from, address indexed to);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(string memory _name, string memory _symbol) {
        if (bytes(_name).length == 0) revert ZeroAddress();
        name = _name;
        symbol = _symbol;
        owner = msg.sender;
    }

    /// @notice Transfer ownership (called after ShieldPayroll deployment)
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /// @notice Mint encrypted tokens to an address. Only owner (ShieldPayroll) can call.
    /// @param to     Recipient address
    /// @param amount Internal euint64 handle — proof already verified by ShieldPayroll
    function mint(address to, euint64 amount) external onlyOwner {
        _balances[to] = FHE.add(_balances[to], amount);

        FHE.allowThis(_balances[to]); // token can compute with it
        FHE.allow(_balances[to], to); // recipient can decrypt

        emit Mint(to);
    }

    /// @notice Transfer encrypted amount between two addresses.
    ///         Uses FHE.select to guard against underflow: if insufficient
    ///         funds, zero is transferred (no revert, preserves privacy).
    /// @dev    `amount` handle must have been FHE.allow()'d for this contract
    ///         by ShieldPayroll before calling.
    function confidentialTransfer(address from, address to, euint64 amount) external onlyOwner {
        euint64 fromBalance = _balances[from];

        // Encrypted guard: transfer only if from has enough
        ebool hasFunds = FHE.ge(fromBalance, amount);
        euint64 transferAmount = FHE.select(hasFunds, amount, FHE.asEuint64(0));

        _balances[from] = FHE.sub(fromBalance, transferAmount);
        _balances[to] = FHE.add(_balances[to], transferAmount);

        FHE.allowThis(_balances[from]);
        FHE.allow(_balances[from], from);

        FHE.allowThis(_balances[to]);
        FHE.allow(_balances[to], to);

        emit ConfidentialTransfer(from, to);
    }

    /// @notice Grant a viewer address ACL access to an account's balance handle.
    ///         Used by ShieldPayroll to let employer decrypt treasury balance.
    function grantBalanceAccess(address account, address viewer) external onlyOwner {
        FHE.allow(_balances[account], viewer);
    }

    /// @notice Returns the encrypted balance handle for an account.
    ///         The handle is only useful if the caller has ACL permission.
    function encryptedBalanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }
}
