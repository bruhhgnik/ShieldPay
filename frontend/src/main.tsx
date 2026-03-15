import React from "react";
import ReactDOM from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectorsForWallets, RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { metaMaskWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import "@rainbow-me/rainbowkit/styles.css";
import "./index.css";
import App from "./App";

const connectors = connectorsForWallets([{ groupName: "Recommended", wallets: [metaMaskWallet] }], {
  appName: "ShieldPay",
  projectId: "shieldpay",
});

const config = createConfig({
  connectors,
  chains: [sepolia],
  transports: { [sepolia.id]: http(import.meta.env.VITE_ALCHEMY_RPC_URL) },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darkTheme({ accentColor: "#6366f1" })}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
);
