import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get, execute } = hre.deployments;

  const token = await get("ConfidentialToken");

  // payPeriod = 0 for demo (no time restriction between payroll runs)
  // In production: set to 30 * 24 * 60 * 60 (30 days)
  const payPeriod = 0;

  const deployed = await deploy("ShieldPayroll", {
    from: deployer,
    args: [token.address, payPeriod],
    log: true,
  });

  console.log(`ShieldPayroll deployed at: ${deployed.address}`);

  // Transfer token ownership to ShieldPayroll so it can mint/transfer
  await execute("ConfidentialToken", { from: deployer, log: true }, "transferOwnership", deployed.address);

  console.log(`ConfidentialToken ownership transferred to ShieldPayroll`);

  // Seed treasury with 10,000 spUSD (10_000 * 10^6 with 6 decimals)
  await execute("ShieldPayroll", { from: deployer, log: true }, "seedTreasury", 10_000_000_000n);

  console.log(`Treasury seeded with 10,000 spUSD`);
};

export default func;
func.id = "deploy_shield_payroll";
func.tags = ["ShieldPayroll"];
func.dependencies = ["ConfidentialToken"];
