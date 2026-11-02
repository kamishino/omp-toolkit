# OMP Auth Gateway & Cloudflare Templates

These templates provide operator configuration examples for serving the **OMP Auth Gateway** through a secure **Cloudflare Argo Tunnel** protected by **Cloudflare Zero Trust Access Service Tokens**.

---

## 1. Cloudflare Tunnel Ingress (`cloudflared-config.example.yaml`)

- **Destination:** `~/.cloudflared/config.yaml` (Windows: `%USERPROFILE%\.cloudflared\config.yaml`)
- **Key Invariant:**
  ```yaml
  originRequest:
    noChunkedEncoding: false
    http2Origin: false
    connectTimeout: 30s
  ```
  Setting `noChunkedEncoding: false` prevents Cloudflare's edge proxy from buffering token-by-token Server-Sent Events (SSE), ensuring real-time LLM response streaming.

---

## 2. Cloudflare Access Service Token (`cf-access.example.json`)

- **Destination:** `~/.omp/cf-access.json` (Windows: `%USERPROFILE%\.omp\cf-access.json`)
- **Usage:** Used by `omp-gateway.ps1` and `doctor-gateway.ts` to automatically authenticate against Gate 1 during automated status probes and live inference testing.

---

## 3. Workflow Summary

1. Create a Cloudflare Tunnel: `cloudflared tunnel create <tunnel-name>`.
2. Copy `cloudflared-config.example.yaml` to `~/.cloudflared/config.yaml` and update tunnel UUID and hostname.
3. In Cloudflare Zero Trust (**Access > Service Auth > Service Tokens**), create a Service Token.
4. Copy `cf-access.example.json` to `~/.omp/cf-access.json` with the Client ID and Secret.
5. In Cloudflare Zero Trust (**Access > Applications**), protect the hostname with a `Service Auth` rule requiring that Service Token.
6. Launch services: `powershell -File scripts/gateway/omp-gateway.ps1 start`.
