# EquipRent

## 1. Contracts (Bohr Testnet, chain 968)
    cd contracts
    forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std
    forge test
    ARBITER=0xYourArbiter forge script script/Deploy.s.sol --rpc-url bohr_testnet --private-key $KEY --broadcast
Copy the deployed address and the deploy block number into `.env` (CONTRACT_ADDRESS, START_BLOCK).

## 2. Run the backend locally
    cp .env.example .env   # fill in values
    docker compose up --build
API docs at http://localhost:8000/docs

## 3. Deploy on Railway
Create one project with four services: Postgres (add the plugin), `api` (root dir apps/api), and `indexer`
(same root dir, start command `python indexer.py`). Share the same variables from `.env.example` on both,
and reference the Postgres plugin's DATABASE_URL. Set PUBLIC_API_URL to the api service's public URL.
Run exactly one indexer instance.

## Notes
- The indexer falls back to block scanning when eth_getLogs is disabled. For production, use a dedicated RPC or indexing provider.
- Listing flow: owner signs in, POSTs /metadata, uses the returned uri in registerEquipment(). The indexer joins on-chain listings with that metadata.
- Not yet built: Next.js app, dispute evidence upload, verification attestations, reputation registry, gas sponsorship.

## 4. Web app (Next.js)
    cd apps/web
    cp .env.example .env.local   # set NEXT_PUBLIC_CONTRACT and NEXT_PUBLIC_API_URL
    npm install && npm run dev
On Railway add a fifth service with root dir apps/web, build `npm run build`, start `npm start`, and set the four NEXT_PUBLIC_* variables.
Add the web app's URL to CORS_ORIGINS on the api service.
Pages: marketplace, equipment booking, my rentals, owner dashboard, list equipment, edit listing.

## 5. Disputes and evidence
- Set `ARBITER_ADDRESS` on the API and pass the same address as ARBITER when deploying the contract.
- Either party uploads a JPEG, PNG, WebP or PDF (5 MB max) from the Evidence button on a rental. The API stores it and returns its SHA-256, then the uploader records that hash on-chain with `submitEvidence`, which gives it a block timestamp. The indexer marks the file "Recorded on-chain".
- Only the two parties and the arbiter can read evidence. The arbiter page lives at /arbiter and appears in the menu only for the arbiter wallet.
- The arbiter can’t decide a rental they are a party to. Files are stored in an S3-compatible bucket. Create a bucket on Railway, then set `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` on the api service from the bucket's credentials. The API checks each file against its recorded SHA-256 on every download. Without `S3_BUCKET` it falls back to the database, which is for local development only. To move files already in the database, run `python migrate_evidence.py` once from `apps/api`.

## 6. Rules for late returns and extensions
- Late return: if the machine is reported back more than 6 hours after the end date, one day's rent per late day (rounded up) is taken from the deposit and paid to the owner, never more than the deposit. The platform fee is charged on the rental fee only.
- Extension: during a rental the renter requests a new end date and escrows the extra fee. The owner approves or rejects. Rejecting, withdrawing, returning first or opening a dispute refunds the extra fee in full. An approval fails if it would collide with another booking.
- Existing deployments need a redeploy of the contract, a new `CONTRACT_ADDRESS` and `START_BLOCK`, and a restart of the api and indexer so the new database columns get added.

## 7. Verification levels
- Levels: Registered (1, default), Verified (2), Inspected (3). The client can no longer set a level. The API forces every stored listing to 1 and takes the displayed level only from a platform attestation.
- An admin wallet listed in `ADMIN_ADDRESSES` signs in at `/admin`, picks an equipment id, a level and a validity period, and the API signs the attestation with `VERIFIER_PRIVATE_KEY`. Expired or revoked attestations drop the listing back to Registered. Each attestation also pins the listing's details by hash, so if the owner changes the name, category, location or description the badge turns off automatically and `/admin` shows "Listing changed" until an admin reviews it and grants the level again. Rate, deposit and visibility changes don't affect it.
- Anyone can check an attestation: `GET /equipment/{id}` returns the signed message, the signature and the signer, and `GET /verifier` returns the platform verifier address.
- Keep the verifier key only on the api service. Losing it lets anyone forge badges, so rotate it and re-issue attestations if it leaks.
