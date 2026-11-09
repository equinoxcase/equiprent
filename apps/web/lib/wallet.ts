"use client";
import { useEffect, useState } from "react";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { API, RPC, CHAIN_ID, CONTRACT, abi, chain } from "./config";

export const pub = createPublicClient({ chain, transport: http(RPC) });

type S = { address: `0x${string}` | null; token: string | null };
let state: S = { address: null, token: null };
const subs = new Set<() => void>();
let inited = false;

const eth = () => (typeof window !== "undefined" ? (window as any).ethereum : undefined);
function set(p: Partial<S>) { state = { ...state, ...p }; subs.forEach((f) => f()); }

function loadToken(addr: string | null) {
  try {
    const t = addr ? sessionStorage.getItem("er_token") : null;
    return t && t.startsWith(addr!.toLowerCase() + ".") && Number(t.split(".")[1]) > Date.now() / 1000 ? t : null;
  } catch { return null; }
}
function setAccount(a?: string) {
  const address = (a as `0x${string}`) ?? null;
  set({ address, token: loadToken(address) });
}

function init() {
  if (inited || !eth()) return;
  inited = true;
  eth().request({ method: "eth_accounts" }).then((a: string[]) => setAccount(a[0])).catch(() => {});
  eth().on?.("accountsChanged", (a: string[]) => setAccount(a[0]));
}

async function connect() {
  if (!eth()) throw new Error("No wallet found. Open this site in your wallet app’s browser or install MetaMask.");
  const a: string[] = await eth().request({ method: "eth_requestAccounts" });
  setAccount(a[0]);
  return a[0] as `0x${string}`;
}

async function ensureChain() {
  const hex = "0x" + CHAIN_ID.toString(16);
  try {
    await eth().request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch (e: any) {
    if (e?.code === 4902 || e?.code === -32603) {
      await eth().request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hex, chainName: chain.name, nativeCurrency: chain.nativeCurrency,
          rpcUrls: [RPC], blockExplorerUrls: [chain.blockExplorers?.default.url],
        }],
      });
    } else throw e;
  }
}

async function signIn() {
  const address = state.address ?? (await connect());
  const m = await (await fetch(`${API}/auth/message?address=${address}`)).json();
  const wc = createWalletClient({ account: address, chain, transport: custom(eth()) });
  const signature = await wc.signMessage({ account: address, message: m.message });
  const r = await fetch(`${API}/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: m.message, signature }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Sign-in failed");
  const { token } = await r.json();
  try { sessionStorage.setItem("er_token", token); } catch {}
  set({ token });
  return token as string;
}

async function send(fn: string, args: any[], value?: bigint) {
  if (!eth()) throw new Error("No wallet found.");
  const address = state.address ?? (await connect());
  await ensureChain();
  const wc = createWalletClient({ account: address, chain, transport: custom(eth()) });
  const hash = await wc.writeContract({ address: CONTRACT, abi, functionName: fn as any, args: args as any, value } as any);
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export function useWallet() {
  const [, bump] = useState(0);
  useEffect(() => {
    init();
    const f = () => bump((n) => n + 1);
    subs.add(f);
    f();
    return () => { subs.delete(f); };
  }, []);
  return { address: state.address, token: state.token, connect, signIn, send };
}

export function errText(e: any): string {
  if (e?.code === 4001 || /user rejected|denied/i.test(e?.message ?? "")) return "Cancelled in your wallet.";
  return e?.shortMessage ?? e?.message ?? String(e);
}
