import Link from "next/link";
import { CONTRACT, CHAIN_ID } from "@/lib/config";

const scan = CHAIN_ID === 677 ? "https://scan.botchain.ai" : "https://scan.bohr.life";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-in">
        <div className="footer-top">
          <div className="footer-about">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="footer-logo" src="/logo-full.png" alt="EquipRent, on-chain equipment rental" width="380" height="135" />
            <p>
              EquipRent is a marketplace for renting generators, excavators, tractors and event gear. Deposits and rental fees are held in an on-chain escrow
              contract, so neither side has to trust the other.
            </p>
          </div>
          <div className="footer-cols">
            <div>
              <h3>Renters</h3>
              <Link href="/browse">Browse equipment</Link>
              <Link href="/renter">My rentals</Link>
              <a href="#how">How it works</a>
            </div>
            <div>
              <h3>Owners</h3>
              <Link href="/owner">Dashboard</Link>
              <Link href="/owner/new">List equipment</Link>
              <a href="#protection">Protections</a>
            </div>
            <div>
              <h3>On-chain</h3>
              <a href={`${scan}/address/${CONTRACT}`} target="_blank" rel="noreferrer">Escrow contract</a>
              <a href={scan} target="_blank" rel="noreferrer">Block explorer</a>
              <Link href="/admin">Verification</Link>
            </div>
          </div>
        </div>
        <div className="footer-chain">
          <a className="powered" href="https://botchain.ai" target="_blank" rel="noreferrer">
            <span className="bot-mark" role="img" aria-label="BOT Chain" />
            Powered by BOT Chain
          </a>
          <a href="https://botchain.ai" target="_blank" rel="noreferrer">botchain.ai</a>
          <a href="https://scan.botchain.ai" target="_blank" rel="noreferrer">scan.botchain.ai</a>
          <a href="https://x.com/botchain_ai" target="_blank" rel="noreferrer">X @botchain_ai</a>
        </div>
        <div className="footer-legal">
          <span>© 2026 EquipRent</span>
          <a href="#top">Back to top ↑</a>
        </div>
      </div>
    </footer>
  );
}
