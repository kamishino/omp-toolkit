# Provider logo sources

Vendored offline for the desktop widget (no runtime fetching). Primary source:
Lobe Icons `@lobehub/icons-static-svg@1.102.0` (MIT) —
https://github.com/lobehub/lobe-icons — fetched 2026-11-02 from
`unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/<file>`.

Official-first rule: where a vendor publishes a clean official SVG, that asset
wins; otherwise the Lobe mark is used and logged here as `fallback`. Marks are
trademarks of their owners; the icon-file license is not a trademark license.

Official assets added 2026-11-11:

- `muse-code.svg` — Meta Muse Code SDK documentation favicon,
  `https://raw.githubusercontent.com/meta-models/muse-code-sdk/gh-pages/1.4/favicon.svg`.
  MIT, copyright Meta Platforms, Inc. and affiliates; full text in
  `THIRD_PARTY_NOTICES.md` section 11. One color file for both themes; an
  accessibility `<title>` was added without changing its artwork.
- `antigravity-color.svg` / `antigravity-white.svg` — Google Antigravity brand
  assets,
  `https://antigravity.google/assets/image/brand/antigravity-icon__full-color.svg`
  and
  `https://antigravity.google/assets/image/brand/antigravity-icon__white.svg`.
  Used unchanged (full color in light themes, white in dark themes) for
  identification only; accessibility `<title>` elements were added. Google
  publishes these as brand artwork, not under an open-source license; no such
  license is claimed here.

| Local file | Provider | Source file | Kind | Notes |
| --- | --- | --- | --- | --- |
| `antigravity-color.svg` / `antigravity-white.svg` | Google Antigravity | official Antigravity brand assets | official (light/dark) | Color/white pair |
| `openai-light.svg` / `openai-dark.svg` | OpenAI Codex | `openai.svg` | fallback (mono pair) | Fill `currentColor` → `#000` / `#fff` |
| `deepseek.svg` | DeepSeek | `deepseek-color.svg` | fallback (color) | Whale, `#4D6BFE` |
| `muse-code.svg` | Muse Code | Meta SDK documentation favicon | official (color) | Bundled unmodified, MIT |
| `anthropic-light.svg` / `anthropic-dark.svg` | Anthropic | `anthropic.svg` | fallback (mono pair) | Fill derived as above |
| `claude.svg` | Claude | `claude-color.svg` | fallback (color) | `#D97757` |
| `mistral.svg` | Mistral | `mistral-color.svg` | fallback (color) | |
| `xai-light.svg` / `xai-dark.svg` | xAI | `xai.svg` | fallback (mono pair) | Fill derived as above |
| `grok-light.svg` / `grok-dark.svg` | Grok | `grok.svg` | fallback (mono pair) | Fill derived as above |
| `meta.svg` | Meta | `meta-color.svg` | fallback (color) | |
| `cohere.svg` | Cohere | `cohere-color.svg` | fallback (color) | |
| `perplexity.svg` | Perplexity | `perplexity-color.svg` | fallback (color) | |
| `groq-light.svg` / `groq-dark.svg` | Groq | `groq.svg` | fallback (mono pair) | Fill derived as above |
| `qwen.svg` | Qwen | `qwen-color.svg` | fallback (color) | |
| `ollama-light.svg` / `ollama-dark.svg` | Ollama | `ollama.svg` | fallback (mono pair) | Fill derived as above |
| `openrouter-light.svg` / `openrouter-dark.svg` | OpenRouter | `openrouter.svg` | fallback (mono pair) | Fill derived as above |

To update: re-fetch the pinned (or newer) `@lobehub/icons-static-svg` files,
regenerate mono pairs by replacing `currentColor` with `#000`/`#fff`, re-fetch
the official Meta/Google URLs above, update this table and the retrieval dates,
then run `bun run build:desktop`.
