# AI Provider Logo Collections — Offline Research

Researched 2026-11-02 against primary sources. Scope (user-confirmed): broad,
future-proof set; correct logos; fully offline at runtime.

Trademark note for every row: the icon-file license is not a trademark
license. Marks remain their owners' property.

## Findings

### Lobe Icons — chosen primary source

- Repo: https://github.com/lobehub/lobe-icons — "340+ AI model and provider
  logos", Mono / Color / Text / Avatar variants, MIT license.
- Static package `@lobehub/icons-static-svg@1.102.0` serves plain files at
  `unpkg.com/@lobehub/icons-static-svg@1.102.0/icons/<name>.svg` (verified
  HTTP 200 for `deepseek-color.svg`, `gemini-color.svg`, `claude-color.svg`,
  `openai.svg`, `anthropic.svg`, `mistral-color.svg`, `xai.svg`,
  `meta-color.svg`, `cohere-color.svg`, `perplexity-color.svg`, `groq.svg`,
  `qwen-color.svg`, `ollama.svg`, `openrouter.svg`, `grok.svg`,
  `claudecode.svg`).
- Naming: color marks are `<name>-color.svg`; mono glyphs are `<name>.svg`
  with `fill="currentColor"` (verified in fetched files). PNG/WebP ship in
  `light`/`dark` folders. Because the widget uses `<img>`, mono SVGs were
  vendored as derived `#000`/`#fff` light/dark pairs.

### Simple Icons — rejected as primary

- Repo: https://github.com/simple-icons/simple-icons — CC0-1.0 SVG paths,
  single-path monochrome + brand hex.
- Verified: `simpleicons.org/icons/openai.svg` returns 404 in v16 (200 in
  v15; removal reported in simple-icons#12739 pending OpenAI brand
  permission), while `anthropic.svg`, `claude`, `deepseek.svg`,
  `googlegemini`, `mistralai`, `perplexity`, `meta` exist. No `antigravity`,
  `cohere`, `groq`, or dedicated `xai` slug at the slugs probed.
- A set that cannot show OpenAI cannot be the single source for this widget.

### Dashboard Icons — rejected as primary, previous source

- Repo: https://github.com/homarr-labs/dashboard-icons — 3,400+ icons,
  SVG/PNG/WebP, `-light`/`-dark` variants, Apache-2.0.
- Verified coverage includes `google-gemini`, `openai`, `chatgpt`,
  `anthropic`, `claude-ai`, `deepseek`, `mistral-ai`, `perplexity`, `grok`,
  `meta`; no Antigravity/Cohere/Groq/xAI at probed slugs.
- General service-directory style rather than AI-specific; it was the repo's
  previous source for Gemini/OpenAI/DeepSeek (see THIRD_PARTY_NOTICES.md §1).

### Official brand sources — no unified kit

- OpenAI publishes brand assets at https://openai.com/brand/ (Blossom +
  wordmark, usage terms). No unified downloadable SVG kit was verified for
  Anthropic/Claude, Google Gemini/Antigravity, DeepSeek, Mistral, xAI, Meta,
  Cohere, Perplexity, or Groq; surfaced assets were homepages, favicons, and
  org avatars. Hence the official-first rule is applied per file in the
  manifest and currently resolves to the Lobe mark (`fallback`) everywhere.

## Comparison

| Collection | AI coverage (probed) | Format | License | Offline vendoring |
| --- | --- | --- | --- | --- |
| Lobe Icons | All 16 probed incl. Antigravity, Grok, xAI, Cohere, Groq | SVG/PNG/WebP, color + mono | MIT | Copy static SVGs, pin version |
| Simple Icons | Missing OpenAI (v16), Antigravity, Cohere, Groq, xAI | SVG mono | CC0-1.0 | npm/git/CDN |
| Dashboard Icons | Broad, but dashboard-styled; gaps at probed slugs | SVG/PNG/WebP, light/dark | Apache-2.0 | Clone/vendor folders |
| Official per-vendor | OpenAI only (verified kit) | As published | Trademark terms | Manual per file |

## Decision (implemented)

- Source: `@lobehub/icons-static-svg` pinned at `1.102.0`; official asset
  wins where a clean SVG exists, logged per file.
- Set: curated ~16 files — current 4 providers plus Anthropic, Claude,
  Mistral, xAI, Grok, Meta, Cohere, Perplexity, Groq, Qwen, Ollama,
  OpenRouter — vendored in `apps/desktop/src/renderer/assets/providers/`
  with `SOURCES.md` manifest; unknown providers render a letter badge.
- Variants: brand-color single file where color is identity (Gemini,
  DeepSeek, Claude, Mistral, Meta, Cohere, Perplexity, Qwen); `#000`/`#fff`
  light/dark pairs for mono glyphs (OpenAI, Anthropic, xAI, Grok, Groq,
  Ollama, OpenRouter).

## Gaps and risks

- Every vendored mark is currently `fallback`, not official; re-check vendor
  brand pages on each version bump.
- Lobe mono files use `currentColor`; the derived pairs must be regenerated
  on update (steps in `SOURCES.md`).
- `muse-code.svg` predates this set and was kept as-is; its provenance is
  the weakest in the folder.
