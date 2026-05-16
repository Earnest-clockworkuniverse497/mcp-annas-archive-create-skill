<div align="center">

<img src="https://github.com/VKirill/codex-starter-kit/raw/main/assets/avatar-round.png" width="120" alt="Kirill Vechkasov" />

# MCP Annas-Archive + Create Skill

**The Anna's Archive MCP server for Claude Code that turns any methodology book into a production-ready Claude Code skill — in a single tool call.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-43853d.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-7c3aed.svg)](https://modelcontextprotocol.io)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-d97757.svg)](https://docs.claude.com/en/docs/claude-code)
[![Gemini](https://img.shields.io/badge/Gemini-3%20Flash-4285F4.svg)](https://aistudio.google.com)

[💬 Telegram: @pomogay_marketing](https://t.me/pomogay_marketing) · [Русская версия](./README.ru.md) · [GitHub](https://github.com/VKirill/mcp-annas-archive-create-skill)

</div>

---

> **TL;DR** — A Model Context Protocol (MCP) server for Anthropic's Claude Code, OpenCode, Codex CLI and any MCP-compatible agent. It searches and downloads books from Anna's Archive via its official member JSON API (`?key=` auth, no scraping), extracts the underlying methodology with Google's Gemini 3 Flash into a strict JSON schema, renders an Anthropic Agent-Skills-compliant `SKILL.md`, runs a programmatic audit (description length, required sections, citation density), and — if the audit passes zero errors — drops the result straight into `~/.claude/skills/<name>/`. End-to-end. One tool call.

## Why this MCP exists

Coding agents like **Claude Code**, **Cursor**, **OpenCode** and **OpenAI Codex CLI** are only as smart as the knowledge they can reach. They know React, FastAPI, Postgres out of the box. They **do not** know:

- How exactly to interview a non-technical customer (Rob Fitzpatrick — *The Mom Test*)
- How to elicit functional requirements without ambiguity (Karl Wiegers — *Software Requirements*)
- How to map user stories and slice for outcomes (Jeff Patton — *User Story Mapping*)
- How to design data-intensive systems under failure (Martin Kleppmann — *DDIA*)
- The specific methodology that lives in **your** library

You can keep pasting chapters into prompts. Or you can **codify each book once into a Claude Code skill**, and the agent will load it automatically when the topic comes up. That's what this MCP automates.

```
Methodology book  →  mcp-annas-archive-create-skill  →  ~/.claude/skills/<name>/SKILL.md
(EPUB / PDF / FB2 / TXT)                                (audit-clean, citation-backed)
```

The output is **not** a human-readable summary. It is a **structured AI agent skill**: `capabilities[]`, `behavioral_traits[]`, `important_constraints[]` (NEVER/ALWAYS), `anti_patterns[]`, plus verbatim `citations[]` with chapter and page references.

## Who is this for?

| If you are… | What you get |
|---|---|
| **A non-programmer with a coding agent** | Turn business/product/sales/UX books into AI agent skills. The agent applies the right methodology when you ask it to plan a feature. No code required. |
| **A developer building agentic tools** | A reference MCP server: Node 24 + TypeScript 5.7, stdio transport, zod-validated, one file per tool, ~1500 LOC total. Fork it, learn from it, extend it. |
| **A researcher or knowledge worker** | A reproducible way to turn a personal library into machine-readable methodology JSONs. The audit-clean `SKILL.md` works in any Anthropic-compatible agent. |
| **A Claude Code power user** | A way to enrich `~/.claude/skills/` with authoritative sources. Your `project-architecting`, `brainstorming`, `client-elicitation` skills get sharper. |

## Key features

- 🎯 **Two tools, three modes.** `book_skill({mode: "create"|"enrich"|"preview", book, ...})` covers the whole pipeline. `skill_audit` validates any SKILL.md.
- 🚫 **Genre detection.** Refuses to invent skills from novels, folklore, or memoirs — returns `{error: "not_methodology", detected_genre: "..."}`.
- 📚 **Citation-backed.** Every capability and constraint cites a verbatim quote with chapter + page reference.
- ✅ **Audit gate.** Generated skills are validated against Anthropic Agent Skills best practices. Promotion to `~/.claude/skills/` happens **only if audit passes zero errors**.
- 🔒 **No HTML scraping.** Uses Anna's Archive's official member JSON API (`/dyn/api/fast_download.json` with `?key=`). No cookies, no IP binding, returns quota info.
- 💰 **Cheap.** Typical 300-page book extraction = ~$0.05–$0.20 on `gemini-3-flash-preview`.
- 🧱 **Idempotent.** Books cached by md5; analyses cached by `(md5, promptHash)`. Re-runs are free.
- 🔧 **Stack-agnostic output.** The SKILL.md works in any Claude Code installation. The audit standard mirrors public Anthropic guidance.

## How it works

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Anna's Archive  │ →  │  book_search +   │ →  │   PDF/EPUB/FB2   │
│  member API     │    │   book_download  │    │   on disk        │
└─────────────────┘    └──────────────────┘    └──────────────────┘
                                                         │
                                                         ▼
┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  ~/.claude/      │ ←  │   audit gate    │ ←  │ Gemini extracts  │
│  skills/<name>/  │    │  (skill-eval    │    │ methodology      │
│   SKILL.md       │    │   checklist)    │    │ → strict JSON    │
└──────────────────┘    └─────────────────┘    └──────────────────┘
   (only if audit                                      │
    passes 0 errors)                                   ▼
                                            ┌──────────────────┐
                                            │  SKILL.md render │
                                            │ (frontmatter +   │
                                            │  required sections)│
                                            └──────────────────┘
```

Two MCP tools. The unified `book_skill` runs the whole pipeline; `skill_audit` is standalone.

## Use cases

- **Greenfield project planning** — extract *The Mom Test* + *Software Requirements* + *User Story Mapping* → your `project-architecting` skill asks better client questions
- **Sales discovery training** — codify *SPIN Selling* + *Solution Selling* → your agent runs structured discovery on cold leads
- **Architecture decisions** — extract *Designing Data-Intensive Applications* + *Clean Architecture* → your refactor agent grounds recommendations in established patterns
- **UX research workflow** — extract *Don't Make Me Think* + *Lean UX* → usability review agent applies real heuristics
- **Domain modeling** — extract *Domain-Driven Design* (Evans) → your agent speaks bounded-contexts and ubiquitous language
- **Security review** — extract OWASP guides + *The Tangled Web* → your security audit agent catches what generic checklists miss

## Quick start

```bash
# 1. Install
git clone https://github.com/VKirill/mcp-annas-archive-create-skill ~/tools/mcp-books
cd ~/tools/mcp-books
npm install
npm run build

# 2. Configure secrets
cp .env.example .env
$EDITOR .env                  # fill ANNAS_ACCOUNT_KEY + GEMINI_API_KEY

# 3. Register with Claude Code
claude mcp add --scope user mcp-books -- node "$PWD/dist/index.js"

# 4. Restart Claude Code → tools appear as mcp__mcp-books__*

# 5. (optional) Smoke-test locally without MCP transport:
npm run smoke:e2e -- "The Mom Test Rob Fitzpatrick"
```

## Configuration

Edit `.env`:

```dotenv
# Anna's Archive — member secret key (URL-key API auth, no cookies)
ANNAS_ACCOUNT_KEY=<paste-from-annas-archive.gl/account>
ANNAS_BASE_URL=https://annas-archive.gl

# Google AI Studio
GEMINI_API_KEY=<paste-from-aistudio.google.com/app/apikey>
GEMINI_MODEL=gemini-3-flash-preview

# Working directory (downloads + skill drafts)
DATA_DIR=./data
```

### Getting an Anna's Archive member key

1. Become a member at https://annas-archive.gl/donate (one-time or recurring donation)
2. After login visit https://annas-archive.gl/account → copy the long alphanumeric **secret key** under "Stable API access"
3. Paste into `.env` as `ANNAS_ACCOUNT_KEY`

Free members get ~25 fast downloads/day. The `book_get_download_url` response includes remaining quota.

### Getting a Gemini API key

1. https://aistudio.google.com/app/apikey → **Create API key**
2. Paste into `.env` as `GEMINI_API_KEY`

Default model `gemini-3-flash-preview` — approximately $0.50 / $3.00 per 1M input/output tokens at time of writing. A typical 300-page book extraction costs **$0.05–$0.20**.

## MCP tools reference (v0.3.0 — consolidated)

Just **two tools**, no decision fatigue:

| Tool | Purpose |
|---|---|
| **`book_skill`** | Modal pipeline. `mode=create` → new SKILL.md. `mode=enrich` → additions into existing SKILL.md. `mode=preview` → analysis + proposed additions, NO writes (for interactive review by the agent). |
| `skill_audit` | Audit any SKILL.md against the Claude Code skill-evaluation standard. Reusable beyond books. |

### `book_skill` modes at a glance

| mode | When to use | Side effect |
|---|---|---|
| `create` | New skill from a book | Writes `$DATA_DIR/skill-drafts/<name>/SKILL.md`; optionally copies to `promote_to` IF audit passes 0 errors |
| `enrich` | Add a book's methodology to an EXISTING SKILL.md | Surgical inserts into named sections; backup saved; auto-rollback if audit worsens |
| `preview` | Discover what Gemini would produce, decide interactively | **No writes.** Returns full SKILL.md preview (no `skill_path`) or proposed additions + patched preview (with `skill_path`) |

### What you can pass as `book`

The same `book` parameter accepts three forms — `book_skill` picks automatically:

| Form | Example | Behaviour |
|---|---|---|
| **Local file path** | `/home/user/Downloads/mom-test.pdf` (also `~/`, `./`) | Anna's Archive is NOT called. File is read directly. Supported: `.epub`, `.fb2`, `.pdf`, `.txt`. |
| **MD5 (32 hex)** | `ad8211428498baf5e6197a2579e4acf2` | Looks for `$DATA_DIR/books/<md5>.*` first; downloads from Anna's only if missing. |
| **Search query** | `Designing Data-Intensive Applications Kleppmann` | Searches Anna's, picks best hit (prefers epub→fb2→pdf→txt), downloads. |

### Example: create from a local file

```json
{
  "mode": "create",
  "book": "/home/user/books/the-mom-test.pdf",
  "promote_to": "/home/user/.claude/skills/book-mom-test/SKILL.md"
}
```

### Example: create via Anna's search

```json
{
  "mode": "create",
  "book": "Designing Data-Intensive Applications Kleppmann",
  "promote_to": "/home/user/.claude/skills/book-ddia/SKILL.md"
}
```

### Example: enrich an existing skill

```json
{
  "mode": "enrich",
  "book": "User Story Mapping Jeff Patton",
  "skill_path": "/home/user/.claude/skills/project-architecting/SKILL.md",
  "focus": "MVP slicing, walking skeleton"
}
```

Response (success):

```json
{
  "ok": true,
  "mode": "enrich",
  "additions_count": 7,
  "additions_by_section": { "Capabilities": 3, "Important Constraints": 2, "Anti-patterns": 2 },
  "skipped_duplicates": ["..."],
  "audit_before": { "passed": true, "error_count": 0, "warning_count": 0 },
  "audit_after":  { "passed": true, "error_count": 0, "warning_count": 0 },
  "rolled_back": false,
  "backup_path": ".../SKILL.md.bak-2026-05-17T..."
}
```

### Example: preview (interactive, no writes)

```json
{
  "mode": "preview",
  "book": "The Mom Test Rob Fitzpatrick",
  "skill_path": "/home/user/.claude/skills/project-architecting/SKILL.md",
  "focus": "client discovery questions"
}
```

Returns the proposed additions + a full patched preview. The agent reviews, picks selectively, and applies via `Edit` — no automatic disk write.

### Rejection (non-methodology books)

```json
{
  "ok": false,
  "rejection": { "reason": "Collection of folklore narratives, not methodology.", "detected_genre": "Fairy Tale Collection" }
}
```

## The audit standard

`src/lib/skill-audit.ts` enforces (errors block promotion, warnings allow):

- `name` is kebab-case, no `-pro/-expert/-specialist` suffix
- `description` is 150-400 chars (hard cap 600), contains trigger nouns and SKIP edges
- Required sections present: `## Use this skill when`, `## Do not use this skill when`, `## Purpose`, `## Capabilities`, `## Behavioral Traits`, `## Important Constraints`
- SKILL.md ≤ 500 lines (otherwise Pattern 2 split warning)
- No placeholder prose (`TBD`, `TODO`, `lorem ipsum`, `FIXME`)
- No time-sensitive phrases (`as of <month> <year>`, `current best practice`)
- `## Capabilities` has ≥3 real subsections with body text
- `## Important Constraints` uses concrete `NEVER`/`ALWAYS` markers

These rules mirror the [Anthropic Agent Skills best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) checklist embedded in `~/.claude/skills/skill-evaluation/`.

## Smoke (no MCP transport)

```bash
npm run smoke -- preview "The Mom Test Rob Fitzpatrick"
npm run smoke -- preview "Software Requirements Wiegers" /path/to/SKILL.md
npm run smoke -- create  "Designing Data-Intensive Applications"
npm run smoke -- enrich  "User Story Mapping Patton" /tmp/test-skill.md
```

## File layout

```
src/
├── index.ts                    MCP stdio server, registers 2 tools
├── smoke.ts                    unified CLI smoke (3 modes)
├── lib/
│   ├── annas-client.ts         JSON API client (?key= auth only)
│   ├── downloader.ts           streaming download + idempotent cache
│   ├── epub-extractor.ts       epub / fb2 / pdf / txt → text
│   ├── gemini-client.ts        Google AI Studio (text + JSON mode)
│   ├── proxy.ts                HTTP / HTTPS / SOCKS5 dispatcher selection
│   ├── skill-renderer.ts       JSON → SKILL.md + zod validator
│   ├── skill-patcher.ts        deterministic surgical insertions for enrich mode
│   └── skill-audit.ts          embedded Claude Code skill auditor
├── tools/
│   ├── book-skill.ts           unified modal tool (create / enrich / preview)
│   └── skill-audit-tool.ts
└── prompts/
    ├── extract-skill.md        Senior Skill Author prompt for create mode
    └── enrich-skill-v2.md      Strict-JSON additions-only prompt for enrich/preview
```

## Proxy & WireGuard (optional)

Anna's Archive is accessible from Russia without any geo-block — if you're hitting 502s or DDoS-Guard challenges, the most reliable fix is to use a residential RU IP. A cheap source of working IPv4/IPv6 IPs from Russia is [px6.me](https://px6.me/?r=32352) (proxy6 reseller), and any of those plug directly into `ANNAS_HTTPS_PROXY` below.

Anna's Archive sometimes blocks server / datacenter IPs (DDoS-Guard, Cloudflare). If you need to route only the Anna's traffic through a proxy — leaving Gemini traffic direct — set one env var:

```dotenv
# .env
ANNAS_HTTPS_PROXY=<scheme>://[user:pass@]host:port
```

Supported schemes:

| Scheme | When to use |
|---|---|
| `http://` | Corporate forward proxy, residential HTTP proxy |
| `https://` | TLS-wrapped HTTP proxy |
| `socks5://` | Most consumer VPN / proxy providers (Mullvad, etc.). Also `socks4://`, `socks5h://`. |

Examples:

```dotenv
ANNAS_HTTPS_PROXY=http://corp-proxy.local:8080
ANNAS_HTTPS_PROXY=https://user:pass@proxy.example.com:443
ANNAS_HTTPS_PROXY=socks5://127.0.0.1:1080
ANNAS_HTTPS_PROXY=socks5://user:pass@residential.proxy.io:1080
```

If `ANNAS_HTTPS_PROXY` is unset, the server falls back to `HTTPS_PROXY` / `HTTP_PROXY` env vars (standard convention). Leave them unset for direct traffic.

The MCP server logs the active proxy at startup: `mcp-books MCP server running via stdio (Anna's proxy: socks5://127.0.0.1:1080)`.

### WireGuard

WireGuard is a **system-level VPN**, not an app-level proxy — so it's configured outside this MCP. Three patterns:

| Pattern | How |
|---|---|
| **System-wide** | `wg-quick up <name>` — entire host routes through WG. No env var needed; mcp-books traffic follows system routing. |
| **Scoped via network namespace** | `ip netns add anna && ip netns exec anna wg-quick up <conf> && ip netns exec anna node dist/index.js` — only this server runs through WG. |
| **WG endpoint exposes a SOCKS/HTTP proxy** | Set `ANNAS_HTTPS_PROXY=socks5://<wg-host>:<port>`. Useful with `microsocks` / `gost` bridges. |

## FAQ

**Q: Is this legal?**
Anna's Archive is a shadow library aggregator; legality of access varies by jurisdiction. This MCP is a thin client around Anna's **official member JSON API** — it does not bypass any access control. Members pay for the service and accept its terms. You are responsible for compliance with your local copyright law.

**Q: Does it work with non-English books?**
Yes. Gemini extracts methodology from English, Russian, German, French, Spanish, and many other languages. The output `SKILL.md` description and section titles stay in English (Claude Code routing language), but the body and citations preserve the source language where helpful.

**Q: What about Cursor / Continue / OpenCode / Codex CLI?**
The MCP transport is stdio + standard MCP protocol. Any MCP-compatible client works. Skill format follows Anthropic Agent Skills — best support in Claude Code, but the JSON extraction is reusable.

**Q: Can I run this without Anna's Archive?**
Use `skill_audit` standalone on any SKILL.md. To extract from a local PDF/EPUB without Anna's, add a tool that wraps `extractBookText` + Gemini — ~30 lines following the existing `book-to-skill.ts` pattern.

**Q: What's the difference between this and a generic "summarize book" tool?**
A summary is for humans. This produces a structured **AI agent skill**: capabilities the agent applies, constraints it follows, citations it can quote, anti-patterns it refuses. Audit-validated. Drop-in compatible with Claude Code's skill loader.

**Q: How does it avoid hallucinating methodology that isn't in the book?**
The Gemini prompt requires citations with chapter/page for every capability. Genre detection refuses non-methodology books. The audit checks for placeholder prose. None of this is bulletproof, but together it constrains the output significantly compared to a free-form summary.

## Roadmap

- [x] `book_enrich_skill(skill_path, book)` — augment an existing SKILL.md with a new book — shipped in v0.2.0
- [x] Unified `book_skill` modal tool (`create | enrich | preview`) — shipped in v0.3.0
- [x] WireGuard / SOCKS5 proxy opt-in via `ANNAS_HTTPS_PROXY` env (annas-only; Gemini direct) — shipped in v0.1.1
- [x] **Pattern 2 awareness** — enrich/preview now read the entire skill folder (SKILL.md + `references/*.md`); create auto-splits into Pattern 2 when content would exceed ~500 lines — shipped in v0.4.0
- [ ] Retry-with-feedback — on audit failure, re-prompt Gemini with the specific audit issues
- [ ] `book_synthesize_skill(books[], target_name)` — merge N books into one synthesized skill
- [ ] Published to npm as `mcp-annas-archive-create-skill`

## GitHub topics

Recommended topics for repository discoverability:

```
mcp, model-context-protocol, claude-code, claude-skill, anna-archive,
annas-archive, anthropic, ai-agent, agent-skills, book-extraction,
methodology, gemini, google-ai-studio, rag, knowledge-extraction,
epub, pdf, fb2, skill-evaluation, stdio-server, typescript, nodejs
```

## Contributing

Issues and PRs welcome. Before opening a PR:

```bash
npm run build       # must be tsc-clean
npm run smoke -- preview "Software Requirements Karl Wiegers"   # must complete cleanly
```

## Author

<div align="center">

<img src="https://github.com/VKirill/codex-starter-kit/raw/main/assets/avatar-round.png" width="80" alt="Kirill Vechkasov" />

**Kirill Vechkasov** — builds AI tools, marketing automation, and agentic workflows.

[💬 Telegram channel: @pomogay_marketing](https://t.me/pomogay_marketing) · [GitHub: @VKirill](https://github.com/VKirill)

</div>

## License

[MIT](./LICENSE) — Copyright (c) 2026 Kirill Vechkasov

---

<div align="center">

*MCP Annas-Archive + Create Skill — turn books into Claude Code agent skills, one tool call at a time.*

</div>
