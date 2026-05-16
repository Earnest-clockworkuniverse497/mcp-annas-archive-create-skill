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

- 🎯 **One tool call → full pipeline.** `book_to_skill("Title or md5")` returns a finished `SKILL.md` (or an honest rejection for fiction).
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

Five MCP tools. One (`book_to_skill`) composes the others end-to-end.

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

## MCP tools reference

| Tool | What it does |
|---|---|
| `book_search` | Search Anna's Archive by title / author / ISBN / keywords. Returns md5 + metadata for up to 50 hits. |
| `book_get_download_url` | Resolve direct partner-server URL for a known md5 (via JSON API). Returns quota info. |
| `book_download` | Download by md5 to `$DATA_DIR/books/<md5>.<ext>`. Idempotent. Auto-fallback across 4 partner servers. |
| **`book_to_skill`** | **The headline tool.** End-to-end: query/md5 → download → extract → Gemini → render → audit → optional promote to `~/.claude/skills/<name>/SKILL.md`. |
| `skill_audit` | Run the embedded skill-evaluation audit on any SKILL.md file. Reusable beyond books. |

### Example: `book_to_skill`

```json
{
  "query": "Designing Data-Intensive Applications Kleppmann",
  "promote_to": "/home/user/.claude/skills/book-ddia/SKILL.md",
  "max_text_chars": 800000,
  "temperature": 0.2
}
```

Response on success:

```json
{
  "ok": true,
  "md5": "...",
  "gemini": { "prompt_tokens": 150000, "output_tokens": 2500, "total_tokens": 152500 },
  "skill": { "name": "book-ddia", "description_length": 350, "capability_count": 6, "citation_count": 9 },
  "audit": { "passed": true, "error_count": 0, "warning_count": 1, "pass_count": 12 },
  "paths": {
    "draft_skill_md": "...skill-drafts/book-ddia/SKILL.md",
    "draft_extraction_json": "...skill-drafts/book-ddia/extraction.json",
    "promoted_skill_md": "/home/user/.claude/skills/book-ddia/SKILL.md"
  }
}
```

Response when the book is fiction:

```json
{
  "ok": false,
  "rejection": {
    "reason": "Collection of folklore narratives, not methodology.",
    "detected_genre": "Fairy Tale Collection"
  }
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

## Smoke scripts (no MCP transport)

```bash
npm run smoke         -- <md5>            # download only
npm run smoke:analyze -- "<query>"        # generic literary summary (debug)
npm run smoke:skill   -- "<query>"        # structured JSON extraction + draft
npm run smoke:e2e     -- "<query>"        # full book_to_skill + audit
npm run smoke:batch   -- "Q1" "Q2" "Q3"   # batch + token ledger
```

## File layout

```
src/
├── index.ts                    MCP stdio server, registers 5 tools
├── lib/
│   ├── annas-client.ts         JSON API client (?key= auth only)
│   ├── downloader.ts           streaming download + idempotent cache
│   ├── epub-extractor.ts       epub / fb2 / pdf / txt → text
│   ├── gemini-client.ts        Google AI Studio (text + JSON mode)
│   ├── skill-renderer.ts       JSON → SKILL.md + zod validator
│   └── skill-audit.ts          embedded Claude Code skill auditor
├── tools/
│   ├── book-search.ts
│   ├── book-get-url.ts
│   ├── book-download.ts
│   ├── book-to-skill.ts        end-to-end orchestration
│   └── skill-audit-tool.ts
├── prompts/
│   ├── extract-skill.md        Senior Skill Author prompt for Gemini (JSON schema)
│   └── enrich-skill.md         (internal) merge multiple books into existing skill
└── smoke*.ts                   CLI dev smokes
```

## Proxy & WireGuard (optional)

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

- [ ] `book_enrich_skill(skill_path, book)` — augment an existing SKILL.md with one or more new books (the «integrate Mom Test into project-architecting» flow as a first-class MCP tool)
- [ ] Retry-with-feedback — on audit failure, re-prompt Gemini with the specific audit issues
- [ ] `book_synthesize_skill(books[], target_name)` — merge N books into one synthesized skill
- [ ] WireGuard / SOCKS5 proxy opt-in via `ANNAS_HTTPS_PROXY` env (annas-only; Gemini direct)
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
npm run smoke:e2e -- "Software Requirements Karl Wiegers"   # must pass audit
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
