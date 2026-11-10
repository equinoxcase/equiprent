"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

export default function Gallery({ images, title }: { images?: string[]; title: string }) {
  const [i, setI] = useState(0);
  if (!images?.length) return null;
  return (
    <div className="gallery">
      <img className="gallery-main" src={images[i]} alt={`${title}, photo ${i + 1} of ${images.length}`} />
      {images.length > 1 && (
        <ul className="gallery-thumbs">
          {images.map((u, k) => (
            <li key={u}>
              <button type="button" aria-label={`Show photo ${k + 1}`} aria-current={k === i} onClick={() => setI(k)}>
                <img src={u} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
