import { formatEther } from "viem";
import { API } from "./config";

export async function get(path: string, token?: string | null) {
  const r = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `Request failed (${r.status})`);
  return r.json();
}

export function bot(v: bigint | number | string | null | undefined): string {
  const s = formatEther(BigInt(v ?? 0));
  const [i, d = ""] = s.split(".");
  const dd = d.slice(0, 4).replace(/0+$/, "");
  return dd ? `${i}.${dd}` : i;
}
