"use client";
import Rentals from "@/components/Rentals";

export default function RenterPage() {
  return (
    <>
      <div className="page-title">My rentals</div>
      <Rentals role="renter" />
    </>
  );
}
