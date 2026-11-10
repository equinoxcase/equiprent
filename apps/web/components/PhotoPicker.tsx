"use client";
import { useRef, useState } from "react";
import { useWallet, errText } from "@/lib/wallet";
import { MAX_PHOTOS, preparePhoto, uploadPhoto } from "@/lib/photos";

export default function PhotoPicker({ value, onChange }: { value: string[]; onChange: (urls: string[]) => void }) {
  const { address, token, signIn } = useWallet();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function add(files: FileList | null) {
    if (!files?.length) return;
    if (!address) { setMsg("Connect your wallet first."); return; }
    setBusy(true); setMsg("");
    try {
      const t = token ?? (await signIn());
      let urls = [...value];
      const list = Array.from(files).slice(0, MAX_PHOTOS - urls.length);
      for (let i = 0; i < list.length; i++) {
        setMsg(`Uploading photo ${i + 1} of ${list.length}.`);
        urls = [...urls, await uploadPhoto(await preparePhoto(list[i]), t)];
        onChange(urls);
      }
      setMsg(files.length > list.length ? `Added ${list.length}. Listings can have up to ${MAX_PHOTOS} photos.` : "");
    } catch (x) { setMsg(errText(x)); }
    setBusy(false);
    if (input.current) input.current.value = "";
  }

  const remove = (i: number) => onChange(value.filter((_, k) => k !== i));
  const cover = (i: number) => onChange([value[i], ...value.filter((_, k) => k !== i)]);

  return (
    <div className="photos">
      <label>Photos <span className="meta">(up to {MAX_PHOTOS}, 50 MB each)</span></label>
      {value.length > 0 && (
        <ul className="thumbs">
          {value.map((u, i) => (
            <li key={u}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Photo ${i + 1}`} />
              {i === 0 ? <span className="cover-tag">Cover</span> : <button type="button" className="small ghost cover-btn" onClick={() => cover(i)}>Make cover</button>}
              <button type="button" className="rm" aria-label={`Remove photo ${i + 1}`} onClick={() => remove(i)}>×</button>
            </li>
          ))}
        </ul>
      )}
      {value.length < MAX_PHOTOS && (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple hidden onChange={(e) => add(e.target.files)} />
          <button type="button" className="ghost small" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading." : value.length ? "Add more photos" : "Add photos"}
          </button>
        </>
      )}
      <p className="msg" role="status">{msg}</p>
    </div>
  );
}
