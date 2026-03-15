import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployed = await deploy("ConfidentialToken", {
    from: deployer,
    args: ["ShieldPay USD", "spUSD"],
    log: true,
  });

  console.log(`ConfidentialToken deployed at: ${deployed.address}`);
};

export default func;
func.id = "deploy_confidential_token";
func.tags = ["ConfidentialToken"];
