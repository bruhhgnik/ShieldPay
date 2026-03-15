// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

interface IConfidentialToken {
    function mint(address to, euint64 amount) external;
    function confidentialTransfer(address from, address to, euint64 amount) external;
    function grantBalanceAccess(address account, address viewer) external;
    function encryptedBalanceOf(address account) external view returns (euint64);
}
