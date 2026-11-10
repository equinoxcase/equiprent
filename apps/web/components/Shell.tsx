"use client";
import { usePathname } from "next/navigation";

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <main className={path === "/" ? "landing" : "app"}>{children}</main>;
}
