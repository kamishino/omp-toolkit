# OMP model intelligence / "brain" score

## Short answer

OMP does not compute the score. The model picker/status line reads a catalog
field named `int` and displays it as a brain icon plus a rounded integer.

For `google-antigravity/gemini-3.8-flash` the local OMP catalog contains:

```json
{ "id": "gemini-3.8-flash", "int": 40.9 }
```

The picker formats it as `Math.round(40.9)` -> **41**.

The score is delivered by the shared catalog at
`https://catalog.stencil.so/models.json` (OMP fetches the `.zstd` variant) and
persisted in `~/.omp/agent/models.db` (`model_cache.models`). The value matches
the **Artificial Analysis Intelligence Index** for Gemini 3.8 Flash (High),
which Artificial Analysis currently publishes as **41** on Intelligence Index
v4.3.2. OMP's catalog does not carry a publisher or index-version field for the
score, so this is an inferred/undocumented provenance, not an OMP guarantee.

## Source chain

1. **External benchmark:** Artificial Analysis Intelligence Index, Gemini 3.8
   Flash (High) = 41. The page lists the index composition (10 evaluations,
   v4.3.2) and describes it as independently measured.
   <https://artificialanalysis.ai/models/gemini-3-8-flash>
2. **Stencil catalog:** live JSON exposes `int: 40.9` for
   `google/gemini-3.8-flash` and `google-vertex/gemini-3.8-flash`.
   <https://catalog.stencil.so/models.json>
3. **OMP catalog:** `packages/catalog/src/provider-models/openai-compat.ts`
   defines `MODELS_DEV_URL = "https://catalog.stencil.so/models.json.zstd"`,
   maps Stencil `int`/`tps` into model specs, and `generate-models.ts` fills
   `int` from the same-id reference.
4. **OMP types:** `packages/catalog/src/types.ts` documents
   `int?: number | null` as "Intelligence score delivered by the model
   catalog." `packages/catalog/src/identity/metrics.ts` resolves catalog
   metrics across provider-id dialects.
5. **OMP persistence:** the model cache table is `model_cache` in
   `<agent-dir>/models.db`; the materialized `models` column is a JSON array.
   For `provider_id = "google-antigravity"`, the row for `gemini-3.8-flash` has
   `int: 40.9`.
6. **OMP display:** `packages/tui/src/overlays/model-browser.ts`'s
   `formatIntelligence()` returns
   `${theme.symbol("icon.intelligence")} ${Math.round(model.int)}`; the
   `icon.intelligence` default is 🧠 and the detail fact is titled
   "Intelligence". <https://github.com/can1357/oh-my-pi/blob/main/packages/tui/src/overlays/model-browser.ts>

OMP docs describe the shared catalog refresh from Stencil:
<https://github.com/can1357/oh-my-pi/blob/main/docs/models.md>
(section "Shared catalog refresh").

## How to retrieve it

`omp models --json` (OMP 18.12.6) prints model metadata but does not expose
`int`; the score is not a public CLI field. Read the local cache with Bun:

```ts
import { Database } from "bun:sqlite";
import os from "node:os";
import path from "node:path";

const db = new Database(path.join(os.homedir(), ".omp", "agent", "models.db"), {
  readonly: true,
});
const row = db
  .query("select models from model_cache where provider_id = ?")
  .get("google-antigravity") as { models: string } | null;
const models = row ? (JSON.parse(row.models) as Array<{ id: string; int?: number }>) : [];
const model = models.find((m) => m.id === "gemini-3.8-flash");
console.log(model?.int); // 40.9
```

Fallback sources:

```bash
# Live catalog (plain JSON); look for provider "google" / "google-vertex"
curl -fsSL https://catalog.stencil.so/models.json

# Bundled catalog from the npm package
npm view @oh-my-pi/pi-catalog version
curl -fsSL https://registry.npmjs.org/@oh-my-pi/pi-catalog/-/pi-catalog-18.12.6.tgz \
  | tar -xOzf - package/src/models.json
```

The local `model_cache` can be refreshed with `omp models refresh` or runtime
discovery; a stale cache keeps the old `int`.

## Caveats

- **Not computed by OMP.** It is catalog-delivered data. There is no OMP
  benchmark run that produces 40.9.
- **Attribution/version gap.** OMP issue #10934 states the Stencil payload
  prunes models.dev and adds `int`/`tps` from elsewhere; the numbers match
  Artificial Analysis to a decimal but carry no publisher, index version, or
  attribution. Artificial Analysis requires attribution for use of its data.
  <https://github.com/can1357/oh-my-pi/issues/10934>
- **Mixed vintages.** OMP issue #11642 notes scores can come from different
  Artificial Analysis index vintages, so two numbers in the picker may not be
  directly comparable. <https://github.com/can1357/oh-my-pi/issues/11642>
- **One aggregate.** The picker shows one model-level score, not per-domain
  coding/agentic/review scores. OMP issue #11057 requests separate capability
  scores. <https://github.com/can1357/oh-my-pi/issues/11057>
- **Per model, not per account.** All Antigravity accounts using
  `gemini-3.8-flash` share this model score. It is not a route/account health
  metric and does not reflect the HANG/OK/ERR snapshot.
- **One value for thinking variants.** The OMP model has minimal/low/medium/high
  effort routing, but `int` is stored at the model level; the displayed score
  is not per effort. The Artificial Analysis page's 41 is specifically the
  High configuration.
- **Scale.** Artificial Analysis Intelligence Index is a composite benchmark
  score (0–100 scale); OMP rounds it to an integer for the compact UI. Do not
  treat it as a percentage or a provider SLA.
