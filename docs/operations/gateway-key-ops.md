# Gateway Key Operations

Gateway keys are operator-provisioned. Do not store plaintext keys in the repo, `.env` files, issue comments, task notes, or logs.

## Generate A New Hashed Key

```bash
pnpm keys:generate -- --label testing-20260603
```

This prints the plaintext key once and stores only its SHA-256 hash in `ops/gateway-key-hashes.local.json`.

The local manifest is ignored by git. Keep a copy in the operator's secure storage so future updates can append keys without reading Cloudflare secret values.

## Import An Existing Hash

If an existing accepted key is known only by hash, import it:

```bash
node scripts/gateway-key-ring.mjs add-hash \
  --label existing-key \
  --sha256 <64-char-sha256-hex>
```

## Review The Secret Value

```bash
pnpm keys:print-secret
```

The output is the complete `GATEWAY_API_KEY_HASHES` value as newline-separated `label:sha256hex` entries.

## Upload The Hash Ring

```bash
pnpm keys:upload
```

This replaces the complete Cloudflare Worker secret `GATEWAY_API_KEY_HASHES` with the manifest contents. Because Worker secrets are write-only, do not run this until the manifest includes every hash that should remain valid.

## Legacy Key

`GATEWAY_API_KEY` remains supported for backward compatibility. Rotating it makes the new plaintext key usable immediately, but any previous legacy plaintext key stops working. Prefer the hash ring for additional keys.
