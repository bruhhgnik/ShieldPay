import { Buffer } from "buffer";
import { createInstance, initSDK, SepoliaConfigV1 } from "@zama-fhe/relayer-sdk/web";
import { ZAMA_SEPOLIA } from "./contracts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FhevmInstance = Awaited<ReturnType<typeof createInstance>>;

let instance: FhevmInstance | null = null;
let sdkReady = false;

async function ensureSDK() {
  if (!sdkReady) {
    await initSDK();
    sdkReady = true;
  }
}

export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (instance) return instance;
  await ensureSDK();
  instance = await createInstance({
    ...SepoliaConfigV1,
    network: ZAMA_SEPOLIA.networkUrl,
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

  const handle = ("0x" + Buffer.from(result.handles[0]).toString("hex")) as `0x${string}`;
  const inputProof = ("0x" + Buffer.from(result.inputProof).toString("hex")) as `0x${string}`;
  return { handle, inputProof };
}

// Decrypt a handle using userDecrypt (replaces the old reencrypt flow)
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

  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 1;

  const eip712 = inst.createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

  const signature = await signTypedData({
    domain: eip712.domain as Record<string, unknown>,
    types: eip712.types as Record<string, unknown>,
    primaryType: eip712.primaryType as string,
    message: eip712.message as Record<string, unknown>,
  });

  const results = await inst.userDecrypt(
    [{ handle, contractAddress }],
    privateKey,
    publicKey,
    signature,
    [contractAddress],
    userAddress,
    startTimestamp,
    durationDays,
  );

  // results is { [handleHex]: bigint }
  const value = Object.values(results)[0] as bigint;
  return value;
}
