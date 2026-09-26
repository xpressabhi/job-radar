# Configuration reference

`data/config.json` is a **sparse override** over the built-in defaults in
`scripts/lib/config.mjs`. Only keys you actually change need to be present; `npm run setup`
writes exactly that. Merge semantics: plain objects merge recursively, arrays and scalars
(including `null`) replace. Unknown keys are ignored and reported as warnings by
`npm run validate:config`.

Print the effective config any time:

```bash
npm run validate:config -- --show
```

Everything below has a generic default. The upstream instance only overrides `site`,
`location`, `pay`, and `crawl` — see `data/config.json`.

## `site`

Branding and links for the rendered site and RSS feed.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | `"Job Radar"` | Site heading (`<h1>`) and footer/archive title |
| `title` | string \| null | `null` | `<title>` and RSS channel title; defaults to `"<name> — <tagline>"` |
| `tagline` | string | generic | Sentence under the heading |
| `description` | string | generic | `<meta name="description">` and RSS channel description |
| `about` | string[] \| null | `null` | Footer "How this list is built" bullets (raw HTML allowed). When null, bullets are generated from `location`/`pay` |
| `url` | string \| null | `null` | Explicit site URL for RSS/canonical links. **Leave null in forks** — the URL is derived: `site.url` → `GITHUB_REPOSITORY` → git remote → omitted |

## `location`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `country` | string \| null | `null` | Home country (required to crawl). Matches country names in posting text |
| `countryCode` | string \| null | `null` | ISO-2 code (e.g. `IN`, `DE`) matched against structured posting countries; its own code is removed from the exclusion list |
| `cities` | object | `{}` | `{ "alias": "Display Name" }` — alias matched case-insensitively in location text, `Display Name` shown on the page |
| `acceptRemote` | boolean | `true` | Keep remote roles with no region signal (flagged "verify eligibility") |
| `excludeRegex` | string (regex) | world list | Region/country names to reject when appearing in a posting. The home country is checked first, so home matches win |
| `excludeRemotePatterns` | string[] | `["remote … us", "us remote"]` | Extra raw regexes for region-restricted remote text |
| `excludeCountryCodes` | string[] | world list | Country codes that mark a posting as restricted elsewhere |

## `roles.seniority`

Controls which titles count as senior+ (the engineering-title gate itself is built in).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `includeKeywords` | string[] | `[]` | Extra accepted words/phrases, matched whole-word (regex chars escaped) |
| `excludeKeywords` | string[] | `[]` | Extra rejected words/phrases (exclusions are checked first) |
| `includePatterns` | `{label, pattern}[]` | senior/staff/principal/lead/architect/head/director/EM/VP | Raw case-insensitive regexes; the match label becomes the seniority badge |
| `excludePatterns` | `{label, pattern}[]` | intern/new grad/graduate/junior/associate/entry level/engineer I/II | Raw regexes that reject a title |
| `skipSeniorPatterns` | `{label, pattern}[]` | `member of technical staff`, `mts` | Titles that bypass keyword matching and fall through to the tier rule |
| `assumeSeniorForTiers` | string[] | `["frontier-ai"]` | Company tiers whose unlabeled titles are assumed senior (`levelSource: "tier-assumed"`) |

Patterns first, then keywords; exclusions beat inclusions. `npm run validate:config` checks
that every raw pattern compiles.

## `pay`

All amounts are **annual, in `pay.currency`**. Published bands from postings are annualized,
converted through `fxRates`, and rounded **down** at display precision (conservative).

| Key | Type | Default | Meaning |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` disables the floor gate entirely (roles still show published pay) |
| `currency` | string | `"USD"` | Base currency for floors and display |
| `floorAnnual` | number | `0` | Senior-role floor applied to a band's lower bound |
| `companyFloorAnnual` | number | `0` | Floor a company's `payVetting.generalBaseMin` must clear (validator) |
| `vettingRequired` | boolean | `false` | Require `payVetting` on enabled companies in `validate:companies` |
| `display.symbol` | string | `"$"` | Currency symbol |
| `display.divisor` | number ≥ 1 | `1` | Amounts are shown divided by this (`100000` renders ₹ lakhs) |
| `display.suffix` | string | `""` | Suffix after the amount (`"L"` → `₹50L`) |
| `display.decimals` | integer 0–4 | `0` | Max decimals (also sets the conservative rounding step: `divisor / 10^decimals`) |
| `fxRates` | object | `{}` | `{ "USD": 87, ... }` — multiply a published amount's currency to get base-currency units. The base currency converts at 1 (omit it or set 1) |
| `fxNote` | string | generic | Free-text note shown nowhere yet; keep the review date here |

Currency-change warning: vetting amounts and floors are denominated in `pay.currency`;
switching currency means re-vetting.

## `crawl`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `requestDelayMs` | number | `1000` | Politeness delay between requests |
| `timeoutMs` | number | `20000` | Per-request timeout |
| `retries` | number | `1` | Retries after a failed request |
| `archiveMisses` | integer ≥ 1 | `2` | Consecutive successful fetches without a role before it is archived |
| `userAgent` | string \| null | derived | Crawler identity. Default: `job-radar/1.0 (+https://github.com/<GITHUB_REPOSITORY>)`, falling back to `job-radar/1.0` locally |

## `llm`

| Key | Type | Default | Meaning |
|---|---|---|---|
| `maxPerRun` | number | `40` | Ambiguous titles sent to the optional LLM fallback per run |

The fallback is enabled by environment, not by this file: `LLM_API_KEY` (secret) plus
`LLM_API_BASE_URL` and `LLM_MODEL` (repository variables), any OpenAI-compatible endpoint.
Without them the crawler is rules-only and retries ambiguous titles later.

## Environment

| Variable | Used for |
|---|---|
| `GITHUB_REPOSITORY` | Per-fork defaults: site URL (`https://<owner>.github.io/<repo>/`) and `User-Agent` |
| `LLM_API_KEY`, `LLM_API_BASE_URL`, `LLM_MODEL` | Optional LLM classification fallback |
| `JOB_RADAR_PROFILE` | Default profile path for the local-only `personal-rank.mjs` |

## `data/companies.json`

```jsonc
{
  "name": "Acme",                     // required
  "ats": "gh",                        // gh | lever | ashby | sr | workable
  "slug": "acme",                     // board slug
  "careersUrl": "https://…",          // optional (add-company sets it)
  "tier": "big-tech",                 // optional, free-form; feeds assumeSeniorForTiers
  "location": {                       // optional presence notes
    "offices": ["Bengaluru"],
    "remoteOk": true,
    "note": "…"
  },
  "payVetting": {                     // optional unless pay.vettingRequired
    "generalBaseMin": 3000000,        // annual, pay.currency
    "seniorBaseMin": 7000000,         // must clear pay.floorAnnual
    "confidence": "estimate",         // estimate | verified
    "sources": ["levels.fyi 2026-08"],
    "verifiedOn": "2026-09-26",
    "notes": "…"
  },
  "enabled": true                     // required; false skips the board
}
```

`npm run add-company -- <url|slug>` creates entries that already pass validation;
`npm run verify:companies` reports board health for the whole list.

## Examples

India, senior engineering, strict pay vetting (the upstream instance):

```jsonc
{
  "location": { "country": "India", "countryCode": "IN", "cities": { "bengaluru": "Bengaluru" } },
  "pay": {
    "currency": "INR", "floorAnnual": 5000000, "companyFloorAnnual": 2000000,
    "vettingRequired": true,
    "display": { "symbol": "₹", "divisor": 100000, "suffix": "L", "decimals": 1 },
    "fxRates": { "USD": 87, "EUR": 95 }
  }
}
```

Germany, EUR, no pay gate, custom level keyword:

```jsonc
{
  "site": { "name": "Berlin Radar" },
  "location": { "country": "Germany", "countryCode": "DE", "cities": { "berlin": "Berlin", "munich": "Munich" } },
  "roles": { "seniority": { "includeKeywords": ["fachbereichsleiter"] } },
  "pay": { "enabled": false, "currency": "EUR" }
}
```
