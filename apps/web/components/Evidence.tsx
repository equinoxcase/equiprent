"use client";
import { useCallback, useEffect, useState } from "react";
import { API } from "@/lib/config";
import { get } from "@/lib/api";
import { useWallet, errText } from "@/lib/wallet";

const toB64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(new Error("Couldn’t read the file"));
  r.readAsDataURL(f);
});

export default function Evidence({ rentalId, canAdd }: { rentalId: number; canAdd: boolean }) {
  const { token, signIn, send } = useWallet();
  const [rows, setRows] = useState<any[] | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    get(`/rentals/${rentalId}/evidence`, token).then(setRows).catch((e) => setMsg(errText(e)));
  }, [token, rentalId]);
  useEffect(load, [load]);

  async function upload() {
    if (!file) return;
    setBusy(true); setMsg("Uploading.");
    try {
      const t = token ?? (await signIn());
      const r = await fetch(`${API}/rentals/${rentalId}/evidence`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ note, filename: file.name, content_type: file.type, data_b64: await toB64(file) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? "Upload failed");
      const ev = await r.json();
      setMsg("Uploaded. Confirm in your wallet to record its hash on-chain.");
      await send("submitEvidence", [BigInt(rentalId), `0x${ev.sha256}`]);
      setMsg("Recorded on-chain. The status updates in a few seconds.");
      setFile(null); setNote(""); load();
    } catch (e) { setMsg(errText(e)); }
    setBusy(false);
  }

  async function open(id: number, name: string) {
    try {
      const r = await fetch(`${API}/evidence/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error("Couldn’t download the file");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setMsg(errText(e)); }
  }

  if (!token) return <div><button className="small" onClick={() => signIn().catch((e) => setMsg(errText(e)))}>Sign in to view evidence</button><p className="msg err">{msg}</p></div>;
  return (
    <div style={{ marginTop: 12 }}>
      {rows && !rows.length && <p className="meta">No evidence yet.</p>}
      {rows?.map((e) => (
        <div className="row" key={e.id}>
          <span>{e.filename}{e.note ? `, ${e.note}` : ""} · {e.anchored ? "Recorded on-chain" : "Not yet on-chain"}</span>
          <button className="small ghost" onClick={() => open(e.id, e.filename)}>Download</button>
        </div>
      ))}
      {canAdd && (
        <>
          <label htmlFor={`f${rentalId}`}>Add a photo or PDF (max 5 MB)</label>
          <input id={`f${rentalId}`} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <input placeholder="Short note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="small" disabled={!file || busy} onClick={upload}>Upload and record</button>
        </>
      )}
      <p className="msg" role="status">{msg}</p>
    </div>
  );
}
