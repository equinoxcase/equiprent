/* eslint-disable @next/next/no-img-element */
export default function Cover({ images, title }: { images?: string[]; title: string }) {
  const src = images?.[0];
  return src
    ? <img className="cover" src={src} alt={title} loading="lazy" />
    : <div className="cover ph" aria-hidden="true"><img src="/logo-mark.png" alt="" /></div>;
}
