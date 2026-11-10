"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatEther, parseEther } from "viem";
import { API, CATEGORIES } from "@/lib/config";
import { get } from "@/lib/api";
import { useWallet, errText } from "@/lib/wallet";
import PhotoPicker from "@/components/PhotoPicker";

export default function EditEquipment() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { address, token, signIn, send } = useWallet();
  const [e, setE] = useState<any>(null);
  const [f, setF] = useState({ category: CATEGORIES[0], title: "", location: "", description: "", rate: "", deposit: "", active: true });
  const [images, setImages] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (ev: any) => setF({ ...f, [k]: ev.target.value });

  useEffect(() => {
    get(`/equipment/${id}`).then((x) => {
      setE(x);
      const m = x.metadata ?? {};
      setImages(m.images ?? []);
      setF({ category: m.category ?? CATEGORIES[0], title: m.title ?? "", location: m.location ?? "", description: m.description ?? "",
        rate: formatEther(BigInt(x.daily_rate_wei)), deposit: formatEther(BigInt(x.deposit_wei)), active: x.active });
    }).catch(() => setMsg("Equipment not found."));
  }, [id]);

  if (!e) return <p className="meta">{msg || "Loading."}</p>;
  if (!address) return <p className="meta">Connect the owner wallet to edit this listing.</p>;
  if (e.owner !== address.toLowerCase()) return <p className="msg err">Only the owner of this listing can edit it.</p>;

  let rateWei = 0n, depWei = 0n, valid = !!f.title && !!f.location;
  try { rateWei = parseEther(f.rate || "0"); depWei = parseEther(f.deposit || "0"); valid = valid && rateWei > 0n; } catch { valid = false; }

  async function save() {
    setBusy(true);
    try {
      setMsg("Signing in.");
      const t = token ?? (await signIn());
      setMsg("Saving listing details.");
      const m = e.metadata ?? {};
      const r = await fetch(`${API}/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ category: f.category, title: f.title, location: f.location, description: f.description,
          images }),
      });
      if (!r.ok) throw new Error("Couldn’t save the listing details.");
      const { uri } = await r.json();
      setMsg("Confirm in your wallet.");
      await send("updateEquipment", [BigInt(id), uri, rateWei, depWei, f.active]);
      setMsg("Saved. The marketplace updates after a few confirmations.");
      setTimeout(() => router.push("/owner"), 1500);
    } catch (x) { setMsg(errText(x)); }
    setBusy(false);
  }

  return (
    <>
      <div className="page-title">Edit listing #{id}</div>
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
        <label htmlFor="a">
          <input id="a" type="checkbox" checked={f.active} onChange={(ev) => setF({ ...f, active: ev.target.checked })} /> Show in the marketplace
        </label>
        {e.verification && <p className="note">This listing is {["", "", "Verified", "Inspected"][e.verification.level]}. Changing the name, category, location, description or photos removes that until an admin reviews it again. Rate, deposit and visibility changes keep it.</p>}
        <p className="note">Rate and deposit changes apply to new requests only. Rentals already requested keep the terms they were booked with.</p>
        <button disabled={!valid || busy} onClick={save}>Save changes</button>
        <p className="msg" role="status">{msg}</p>
      </div>
    </>
  );
}
