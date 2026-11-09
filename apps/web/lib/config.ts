import { defineChain, parseAbi } from "viem";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 968);
export const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.bohr.life";
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const CONTRACT = (process.env.NEXT_PUBLIC_CONTRACT ?? "0x02f4E40bcEdAEFF73cBCc28c3494cb4687f44A02") as `0x${string}`;

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 677 ? "BOT Chain" : "Bohr Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Scan", url: CHAIN_ID === 677 ? "https://scan.botchain.ai" : "https://scan.bohr.life" } },
});

export const abi = parseAbi([
  "function registerEquipment(string uri, uint128 dailyRate, uint128 deposit) returns (uint256)",
  "function requestRental(uint256 equipmentId, uint64 start, uint64 end) payable returns (uint256)",
  "function acceptRental(uint256 id)",
  "function cancelRequest(uint256 id)",
  "function confirmHandover(uint256 id)",
  "function cancelUnstarted(uint256 id)",
  "function reportReturn(uint256 id)",
  "function confirmReturn(uint256 id)",
  "function settleAfterSilence(uint256 id)",
  "function openDispute(uint256 id)",
  "function withdraw()",
  "function submitEvidence(uint256 id, bytes32 hash)",
  "function resolveDispute(uint256 id, uint256 ownerAmount)",
  "function resolveStale(uint256 id)",
  "function updateEquipment(uint256 id, string uri, uint128 dailyRate, uint128 deposit, bool active)",
  "function requestExtension(uint256 id, uint64 newEnd) payable",
  "function approveExtension(uint256 id)",
  "function cancelExtension(uint256 id)",
  "function getRental(uint256 id) view returns ((uint256 equipmentId, address owner, address renter, uint64 start, uint64 end, uint64 returnedAt, uint64 disputedAt, uint128 fee, uint128 deposit, uint16 feeBps, bool ownerHandover, bool renterHandover, uint8 status, uint64 extEnd, uint128 extFee, uint128 rate))",
  "function arbiter() view returns (address)",
  "function balances(address) view returns (uint256)",
  "function platformFeeBps() view returns (uint16)",
]);

// Keep these in sync with the contract constants.
export const HANDOVER_GRACE = 2 * 24 * 3600;
export const RETURN_WINDOW = 3 * 24 * 3600;
export const ARBITER_WINDOW = 14 * 24 * 3600;
export const LATE_GRACE = 6 * 3600;

export const LEVELS = ["", "Registered", "Verified", "Inspected"];
export const CATEGORIES = ["Generators", "Excavators", "Tractors", "Industrial", "Event", "Vehicles"];
