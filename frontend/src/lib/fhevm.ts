import { createInstance } from "fhevmjs";
import type { FhevmInstance } from "fhevmjs";
import { ZAMA_SEPOLIA } from "./contracts";

let instance: FhevmInstance | null = null;

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instance) return instance;
  instance = await createInstance({
    kmsContractAddress: ZAMA_SEPOLIA.kmsAddress,
    aclContractAddress: ZAMA_SEPOLIA.aclAddress,
    networkUrl: ZAMA_SEPOLIA.networkUrl,
    gatewayUrl: ZAMA_SEPOLIA.relayerUrl,
  });
  return instance;
}

// Encrypt a uint64 amount for a given contract + user
export async function encrypt64(
  amount: bigint,
  contractAddress: string,
  userAddress: string,
): Promise<{ handle: `0x${string}`; inputProof: `0x${string}` }> {
  const inst = await getFhevmInstance();
  const input = inst.createEncryptedInput(contractAddress, userAddress);
  input.add64(amount);
  const result = await input.encrypt();

  const handle = result.handles[0] as unknown as `0x${string}`;
  const inputProof = ("0x" + Buffer.from(result.inputProof as Uint8Array).toString("hex")) as `0x${string}`;
  return { handle, inputProof };
}

// Re-encrypt a handle so the user can read the plaintext
export async function decrypt64(
  handle: string,
  contractAddress: string,
  userAddress: string,
  signTypedData: (args: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>,
): Promise<bigint> {
  const inst = await getFhevmInstance();
  const { publicKey, privateKey } = inst.generateKeypair();
  const eip712 = inst.createEIP712(publicKey, contractAddress);

  const signature = await signTypedData({
    domain: eip712.domain as Record<string, unknown>,
    types: eip712.types as Record<string, unknown>,
    primaryType: "Reencrypt",
    message: eip712.message as Record<string, unknown>,
  });

  // reencrypt expects handle as bigint (hex → bigint)
  const handleBigInt = BigInt(handle);

  const decrypted = await inst.reencrypt(handleBigInt, privateKey, publicKey, signature, contractAddress, userAddress);

  return decrypted;
}
