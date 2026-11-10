"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseEther } from "viem";
import { API, CATEGORIES } from "@/lib/config";
import { useWallet, errText } from "@/lib/wallet";
import PhotoPicker from "@/components/PhotoPicker";

export default function NewEquipment() {
  const router = useRouter();
  const { token, signIn, send } = useWallet();
  const [f, setF] = useState({ category: CATEGORIES[0], title: "", location: "", description: "", rate: "", deposit: "" });
  const [images, setImages] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (ev: any) => setF({ ...f, [k]: ev.target.value });

  let rateWei = 0n, depWei = 0n, valid = !!f.title && !!f.location;
  try { rateWei = parseEther(f.rate || "0"); depWei = parseEther(f.deposit || "0"); valid = valid && rateWei > 0n; } catch { valid = false; }

  async function save() {
    setBusy(true);
    try {
      setMsg("Signing in.");
      const t = token ?? (await signIn());
      setMsg("Saving listing details.");
      const r = await fetch(`${API}/metadata`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ category: f.category, title: f.title, location: f.location, description: f.description, images }),
      });
      if (!r.ok) throw new Error("Couldn’t save the listing details.");
      const { uri } = await r.json();
      setMsg("Confirm in your wallet.");
      await send("registerEquipment", [uri, rateWei, depWei]);
      setMsg("Listed. It appears in the marketplace after a few confirmations.");
      setTimeout(() => router.push("/owner"), 1500);
    } catch (x) { setMsg(errText(x)); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-title">List equipment</div>
      <div className="panel">
        <label htmlFor="c">Category</label>
        <select id="c" value={f.category} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <label htmlFor="t">Name</label><input id="t" value={f.title} onChange={set("title")} />
        <label htmlFor="l">Location</label><input id="l" value={f.location} onChange={set("location")} />
        <label htmlFor="d">Description</label><textarea id="d" rows={3} value={f.description} onChange={set("description")} />
        <PhotoPicker value={images} onChange={setImages} />
        <div className="two">
          <div><label htmlFor="r">Daily rate (BOT)</label><input id="r" inputMode="decimal" value={f.rate} onChange={set("rate")} /></div>
          <div><label htmlFor="p">Deposit (BOT)</label><input id="p" inputMode="decimal" value={f.deposit} onChange={set("deposit")} /></div>
        </div>
        <button disabled={!valid || busy} onClick={save}>List equipment</button>
        <p className="msg" role="status">{msg}</p>
      </div>
    </>
  );
}
