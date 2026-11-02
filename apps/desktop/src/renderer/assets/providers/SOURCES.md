# Provider logo sources

Vendored offline for the desktop widget (no runtime fetching). Primary source:
Lobe Icons `@lobehub/icons-static-svg@1.102.0` (MIT) —
https://github.com/lobehub/lobe-icons — fetched 2026-11-02 from
`unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/<file>`.

Official-first rule: where a vendor publishes a clean official SVG, that asset
wins; otherwise the Lobe mark is used and logged here as `fallback`. Marks are
trademarks of their owners; the icon-file license is not a trademark license.

| Local file | Provider | Source file | Kind | Notes |
| --- | --- | --- | --- | --- |
| `google-gemini.svg` | Google Antigravity (Gemini) | `gemini-color.svg` | fallback (color) | Gradient spark |
| `openai-light.svg` / `openai-dark.svg` | OpenAI Codex | `openai.svg` | fallback (mono pair) | Fill `currentColor` → `#000` / `#fff` |
| `deepseek.svg` | DeepSeek | `deepseek-color.svg` | fallback (color) | Whale, `#4D6BFE` |
| `muse-code.svg` | Muse Code | pre-existing repo asset | fallback (color) | Kept; not a Lobe file |
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
regenerate mono pairs by replacing `currentColor` with `#000`/`#fff`, update
this table and the version above, then run `bun run build:desktop`.
