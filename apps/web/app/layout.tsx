import "./globals.css";
import { Barlow, Barlow_Condensed } from "next/font/google";
import Nav from "@/components/Nav";
import Shell from "@/components/Shell";
import Footer from "@/components/Footer";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-body", display: "swap" });
const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });

export const metadata = {
  title: "EquipRent: rent heavy equipment with on-chain escrow",
  description: "Rent generators, excavators and tractors. Your deposit is locked in escrow and returned when the machine is.",
};

export const viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable}`}>
      <body id="top">
        <Nav />
        <Shell>{children}</Shell>
        <Footer />
      </body>
    </html>
  );
}
