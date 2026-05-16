<div align="center">

<img src="https://github.com/VKirill/codex-starter-kit/raw/main/assets/avatar-round.png" width="120" alt="Кирилл Вечкасов" />

# MCP Annas-Archive + Create Skill

**MCP-сервер Anna's Archive для Claude Code, который превращает любую методологическую книгу в production-ready Claude Code скилл — одним вызовом инструмента.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-43853d.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-7c3aed.svg)](https://modelcontextprotocol.io)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-compatible-d97757.svg)](https://docs.claude.com/en/docs/claude-code)
[![Gemini](https://img.shields.io/badge/Gemini-3%20Flash-4285F4.svg)](https://aistudio.google.com)

[💬 Telegram: @pomogay_marketing](https://t.me/pomogay_marketing) · [English version](./README.md) · [GitHub](https://github.com/VKirill/mcp-annas-archive-create-skill)

</div>

---

> **TL;DR** — MCP (Model Context Protocol) сервер для Claude Code, OpenCode, Codex CLI и любого MCP-совместимого агента. Ищет и скачивает книги с Anna's Archive через официальный member JSON API (auth по `?key=`, без HTML-скрапинга), вытаскивает методологию через Google Gemini 3 Flash в строгий JSON, рендерит `SKILL.md` по стандарту Anthropic Agent Skills, прогоняет программный аудит (длина description, обязательные секции, плотность цитат) и — если audit прошёл с нулём ошибок — кладёт результат сразу в `~/.claude/skills/<имя>/`. End-to-end. Одним вызовом.

## Зачем нужен этот MCP

Кодинг-агенты вроде **Claude Code**, **Cursor**, **OpenCode** и **OpenAI Codex CLI** умны настолько, насколько умны знания до которых они дотягиваются. Они знают React, FastAPI, Postgres из коробки. Они **не знают**:

- Как именно интервьюировать не-технического клиента (Rob Fitzpatrick — *The Mom Test*)
- Как элиситировать функциональные требования без двусмысленности (Karl Wiegers — *Software Requirements*)
- Как строить user story map и нарезать на outcomes (Jeff Patton — *User Story Mapping*)
- Как проектировать data-intensive системы под отказы (Martin Kleppmann — *DDIA*)
- Конкретную методологию которая лежит в **твоей** библиотеке

Можешь каждый раз вставлять главы в промпт. Или **закодировать каждую книгу один раз в скилл Claude Code**, и агент сам подгрузит когда тема всплывёт. Этим и занимается MCP.

```
Методологическая книга →  mcp-annas-archive-create-skill  →  ~/.claude/skills/<имя>/SKILL.md
(EPUB / PDF / FB2 / TXT)                                     (прошёл аудит, с цитатами)
```

На выходе **не** саммери для людей. На выходе — **структурированный навык AI-агента**: `capabilities[]`, `behavioral_traits[]`, `important_constraints[]` (NEVER/ALWAYS), `anti_patterns[]`, плюс дословные `citations[]` с указанием глав и страниц.

## Для кого это

| Если ты… | Что получаешь |
|---|---|
| **Не-программист с AI-агентом** | Превращаешь бизнес/продуктовые/sales/UX книги в навыки агента. Агент применяет правильную методологию когда ты просишь спланировать фичу. Программировать не надо. |
| **Разработчик пишет агентский тул** | Эталонный MCP-сервер: Node 24 + TypeScript 5.7, stdio transport, zod-валидация, один файл на инструмент, ~1500 LOC всего. Форкай, изучай, расширяй. |
| **Исследователь / knowledge worker** | Воспроизводимый способ превратить личную библиотеку в машиночитаемые JSON по методологиям. Audit-clean `SKILL.md` работает в любом Anthropic-совместимом агенте. |
| **Опытный Claude Code пользователь** | Обогащаешь `~/.claude/skills/` авторитетными источниками. Твои `project-architecting`, `brainstorming`, `client-elicitation` становятся острее. |

## Ключевые возможности

- 🎯 **Один вызов → весь конвейер.** `book_to_skill("Title or md5")` возвращает готовый `SKILL.md` (или честный отказ для художки).
- 🚫 **Определение жанра.** Отказывается выдумывать скилл из романов, сказок, мемуаров — возвращает `{error: "not_methodology", detected_genre: "..."}`.
- 📚 **С цитатами.** Каждая capability и constraint цитирует дословный фрагмент с указанием главы и страницы.
- ✅ **Гейт аудита.** Сгенерированные скиллы валидируются по лучшим практикам Anthropic Agent Skills. Промоут в `~/.claude/skills/` происходит **только если audit прошёл с нулём ошибок**.
- 🔒 **Никакого HTML парсинга.** Используется официальный member JSON API Anna's Archive (`/dyn/api/fast_download.json` + `?key=`). Без cookies, без привязки к IP, возвращает квоту.
- 💰 **Дёшево.** Типичная книга на 300 страниц = ~$0.05–$0.20 на `gemini-3-flash-preview`.
- 🧱 **Идемпотентность.** Книги кешируются по md5; анализы — по `(md5, promptHash)`. Повторные запуски бесплатны.
- 🔧 **Стек-агностичный вывод.** SKILL.md работает в любой установке Claude Code. Стандарт аудита совпадает с публичной документацией Anthropic.

## Как работает

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Anna's Archive  │ →  │  book_search +   │ →  │   PDF/EPUB/FB2   │
│  member API     │    │   book_download  │    │   на диске       │
└─────────────────┘    └──────────────────┘    └──────────────────┘
                                                         │
                                                         ▼
┌──────────────────┐    ┌─────────────────┐    ┌──────────────────┐
│  ~/.claude/      │ ←  │  гейт аудита    │ ←  │  Gemini вытащил  │
│  skills/<имя>/   │    │ (skill-eval     │    │  методологию     │
│   SKILL.md       │    │  чек-лист)      │    │  → строгий JSON  │
└──────────────────┘    └─────────────────┘    └──────────────────┘
   (только если                                        │
    audit: 0 ошибок)                                   ▼
                                            ┌──────────────────┐
                                            │ Рендер SKILL.md  │
                                            │ (frontmatter +   │
                                            │  обязательные    │
                                            │   секции)        │
                                            └──────────────────┘
```

Пять MCP инструментов. Один (`book_to_skill`) собирает их в pipeline.

## Сценарии применения

- **Планирование greenfield-проекта** — вытащить *Mom Test* + *Software Requirements* + *User Story Mapping* → твой `project-architecting` задаёт лучшие вопросы клиенту
- **Тренинг discovery в продажах** — закодировать *SPIN Selling* + *Solution Selling* → агент проводит структурированный discovery по холодным лидам
- **Архитектурные решения** — вытащить *DDIA* + *Clean Architecture* → агент рефакторинга обосновывает рекомендации устоявшимися паттернами
- **UX-research воркфлоу** — вытащить *Don't Make Me Think* + *Lean UX* → агент usability-ревью применяет реальные эвристики
- **Domain modeling** — вытащить *Domain-Driven Design* (Evans) → агент говорит на языке bounded contexts и ubiquitous language
- **Security review** — вытащить OWASP гайды + *The Tangled Web* → security-audit агент ловит то что мимо generic чек-листов

## Быстрый старт

```bash
# 1. Установка
git clone https://github.com/VKirill/mcp-annas-archive-create-skill ~/tools/mcp-books
cd ~/tools/mcp-books
npm install
npm run build

# 2. Настройка секретов
cp .env.example .env
$EDITOR .env                  # впиши ANNAS_ACCOUNT_KEY + GEMINI_API_KEY

# 3. Регистрация в Claude Code
claude mcp add --scope user mcp-books -- node "$PWD/dist/index.js"

# 4. Перезапусти Claude Code → инструменты появятся как mcp__mcp-books__*

# 5. (опционально) Smoke-тест локально без MCP transport:
npm run smoke:e2e -- "The Mom Test Rob Fitzpatrick"
```

## Настройка

Правишь `.env`:

```dotenv
# Anna's Archive — member secret key (API auth по URL ?key=, без cookies)
ANNAS_ACCOUNT_KEY=<вставь-с-annas-archive.gl/account>
ANNAS_BASE_URL=https://annas-archive.gl

# Google AI Studio
GEMINI_API_KEY=<вставь-с-aistudio.google.com/app/apikey>
GEMINI_MODEL=gemini-3-flash-preview

# Рабочая директория (загрузки + черновики скиллов)
DATA_DIR=./data
```

### Как получить member ключ Anna's Archive

1. Стань участником: https://annas-archive.gl/donate (разово или подпиской)
2. После входа зайди в https://annas-archive.gl/account → скопируй длинный алфавитно-цифровой **secret key** под надписью "Stable API access"
3. Вставь в `.env` как `ANNAS_ACCOUNT_KEY`

Бесплатные участники получают ~25 fast download'ов в день. Ответ `book_get_download_url` включает остаток квоты.

### Как получить Gemini API ключ

1. https://aistudio.google.com/app/apikey → **Create API key**
2. Вставь в `.env` как `GEMINI_API_KEY`

Дефолтная модель `gemini-3-flash-preview` — примерно $0.50 / $3.00 за 1M input/output токенов на момент написания. Типичная книга на 300 страниц = **$0.05–$0.20**.

## Справочник MCP инструментов

| Инструмент | Что делает |
|---|---|
| `book_search` | Поиск Anna's Archive по названию / автору / ISBN / ключевым словам. До 50 хитов с md5 + метаданными. |
| `book_get_download_url` | Прямой URL партнёр-сервера по md5 (через JSON API). Возвращает квоту. |
| `book_download` | Скачивание по md5 в `$DATA_DIR/books/<md5>.<ext>`. Идемпотентно. Auto-fallback на 4 партнёр-сервера. |
| **`book_to_skill`** | **Главный.** End-to-end: query/md5 → download → extract → Gemini → render → audit → optional promote в `~/.claude/skills/<имя>/SKILL.md`. |
| `skill_audit` | Запускает встроенный skill-evaluation аудит на любом SKILL.md. Переиспользуется не только для книжных скиллов. |

### Пример: `book_to_skill`

```json
{
  "query": "Designing Data-Intensive Applications Kleppmann",
  "promote_to": "/home/user/.claude/skills/book-ddia/SKILL.md",
  "max_text_chars": 800000,
  "temperature": 0.2
}
```

Успешный ответ:

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

Ответ когда книга художественная:

```json
{
  "ok": false,
  "rejection": {
    "reason": "Collection of folklore narratives, not methodology.",
    "detected_genre": "Fairy Tale Collection"
  }
}
```

## Стандарт аудита

`src/lib/skill-audit.ts` проверяет (errors → блок промоута, warnings → разрешают):

- `name` — kebab-case, без `-pro/-expert/-specialist`
- `description` — 150-400 символов (потолок 600), содержит trigger существительные и SKIP-границы
- Обязательные секции: `## Use this skill when`, `## Do not use this skill when`, `## Purpose`, `## Capabilities`, `## Behavioral Traits`, `## Important Constraints`
- SKILL.md ≤ 500 строк (иначе предупреждение о Pattern 2 split)
- Нет placeholder prose (`TBD`, `TODO`, `lorem ipsum`, `FIXME`)
- Нет временных привязок (`as of <месяц> <год>`, `current best practice`)
- `## Capabilities` имеет ≥3 настоящих субсекций с телом
- `## Important Constraints` использует конкретные `NEVER`/`ALWAYS`

Правила совпадают с [Anthropic Agent Skills best-practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) и встроенным чек-листом в `~/.claude/skills/skill-evaluation/`.

## Smoke-скрипты (без MCP transport)

```bash
npm run smoke         -- <md5>            # только загрузка
npm run smoke:analyze -- "<query>"        # литературное саммери (debug)
npm run smoke:skill   -- "<query>"        # JSON-извлечение + черновик
npm run smoke:e2e     -- "<query>"        # полный book_to_skill + audit
npm run smoke:batch   -- "Q1" "Q2" "Q3"   # батч + token ledger
```

## Структура

```
src/
├── index.ts                    MCP stdio сервер, регистрирует 5 инструментов
├── lib/
│   ├── annas-client.ts         JSON API клиент (auth только по ?key=)
│   ├── downloader.ts           streaming download + идемпотентный кеш
│   ├── epub-extractor.ts       epub / fb2 / pdf / txt → текст
│   ├── gemini-client.ts        Google AI Studio (text + JSON mode)
│   ├── skill-renderer.ts       JSON → SKILL.md + zod валидатор
│   └── skill-audit.ts          встроенный аудитор скилла Claude Code
├── tools/
│   ├── book-search.ts
│   ├── book-get-url.ts
│   ├── book-download.ts
│   ├── book-to-skill.ts        end-to-end оркестрация
│   └── skill-audit-tool.ts
├── prompts/
│   ├── extract-skill.md        Senior Skill Author промпт для Gemini (JSON schema)
│   └── enrich-skill.md         (внутренний) merge нескольких книг в существующий скилл
└── smoke*.ts                   CLI dev smokes
```

## Прокси и WireGuard (опционально)

Anna's Archive иногда блокирует server/datacenter IP (DDoS-Guard, Cloudflare). Если нужно завернуть **только** anna's-трафик через прокси (Gemini идёт напрямую), достаточно одной env-переменной:

```dotenv
# .env
ANNAS_HTTPS_PROXY=<scheme>://[user:pass@]host:port
```

Поддерживаемые схемы:

| Схема | Когда |
|---|---|
| `http://` | Корпоративный forward proxy, residential HTTP-прокси |
| `https://` | TLS-обёрнутый HTTP-прокси |
| `socks5://` | Большинство пользовательских VPN/прокси (Mullvad и т.п.). Также `socks4://`, `socks5h://`. |

Примеры:

```dotenv
ANNAS_HTTPS_PROXY=http://corp-proxy.local:8080
ANNAS_HTTPS_PROXY=https://user:pass@proxy.example.com:443
ANNAS_HTTPS_PROXY=socks5://127.0.0.1:1080
ANNAS_HTTPS_PROXY=socks5://user:pass@residential.proxy.io:1080
```

Если `ANNAS_HTTPS_PROXY` не задан — сервер падает обратно на стандартные `HTTPS_PROXY` / `HTTP_PROXY` env vars. Не задавай ничего → трафик идёт напрямую.

MCP сервер логирует активный прокси при старте: `mcp-books MCP server running via stdio (Anna's proxy: socks5://127.0.0.1:1080)`.

### WireGuard

WireGuard — это **системный VPN**, не прокси уровня приложения, поэтому он конфигурируется вне MCP. Три паттерна:

| Паттерн | Как |
|---|---|
| **Системно** | `wg-quick up <name>` — весь хост идёт через WG. Никакая env не нужна; трафик mcp-books идёт по системной маршрутизации. |
| **Через network namespace** | `ip netns add anna && ip netns exec anna wg-quick up <conf> && ip netns exec anna node dist/index.js` — только этот сервер идёт через WG. |
| **WG endpoint отдаёт SOCKS/HTTP прокси** | Поставь `ANNAS_HTTPS_PROXY=socks5://<wg-host>:<port>`. Полезно с `microsocks` / `gost`-мостами. |

## FAQ

**В: Это законно?**
Anna's Archive — теневая библиотека-агрегатор; законность доступа зависит от юрисдикции. Этот MCP — тонкий клиент к **официальному member JSON API** Anna's — он не обходит контроль доступа. Участники платят за сервис и принимают его условия. Ты отвечаешь за соблюдение местного авторского права.

**В: Работает ли с не-английскими книгами?**
Да. Gemini вытаскивает методологию из английского, русского, немецкого, французского, испанского и многих других языков. Description и заголовки секций в `SKILL.md` остаются на английском (язык routing'а Claude Code), но тело и цитаты сохраняют исходный язык где это уместно.

**В: А Cursor / Continue / OpenCode / Codex CLI?**
MCP transport — stdio + стандартный MCP протокол. Любой MCP-совместимый клиент работает. Формат скилла соответствует Anthropic Agent Skills — лучшая поддержка в Claude Code, но JSON-извлечение переиспользуется.

**В: Можно ли запускать без Anna's Archive?**
Используй `skill_audit` отдельно на любом SKILL.md. Чтобы извлекать из локального PDF/EPUB без Anna's, добавь инструмент-обёртку над `extractBookText` + Gemini — ~30 строк по шаблону `book-to-skill.ts`.

**В: В чём отличие от обычного "summarize book" тула?**
Саммери — для людей. Этот тул производит структурированный **AI agent skill**: capabilities которые агент применяет, constraints которым он следует, цитаты которые он может процитировать, anti-patterns которые он отвергает. Прошёл валидацию аудита. Drop-in совместимо с загрузчиком скиллов Claude Code.

**В: Как избежать галлюцинаций методологии которой нет в книге?**
Gemini промпт требует цитаты с указанием главы/страницы для каждой capability. Жанр-детекция отказывается от не-методологии. Аудит проверяет placeholder prose. Это не пуленепробиваемо, но в сумме значительно ограничивает вывод vs свободное саммери.

## Roadmap

- [ ] `book_enrich_skill(skill_path, book)` — обогащение существующего SKILL.md одной или несколькими книгами (то что сейчас делалось руками для project-architecting — как полноценный MCP tool)
- [ ] Retry с feedback — при провале аудита, перепрашиваем Gemini с конкретными issues
- [ ] `book_synthesize_skill(books[], target_name)` — синтез N книг в один сводный скилл
- [x] WireGuard / SOCKS5 proxy opt-in через `ANNAS_HTTPS_PROXY` (только трафик anna's; Gemini напрямую) — выпущено в v0.1.1
- [ ] Публикация в npm как `mcp-annas-archive-create-skill`

## GitHub topics

Рекомендуемые topics для repository discoverability:

```
mcp, model-context-protocol, claude-code, claude-skill, anna-archive,
annas-archive, anthropic, ai-agent, agent-skills, book-extraction,
methodology, gemini, google-ai-studio, rag, knowledge-extraction,
epub, pdf, fb2, skill-evaluation, stdio-server, typescript, nodejs
```

## Контрибьютинг

Issues и PR приветствуются. Перед PR:

```bash
npm run build       # должно быть tsc-clean
npm run smoke:e2e -- "Software Requirements Karl Wiegers"   # audit должен пройти
```

## Автор

<div align="center">

<img src="https://github.com/VKirill/codex-starter-kit/raw/main/assets/avatar-round.png" width="80" alt="Кирилл Вечкасов" />

**Кирилл Вечкасов** — делает AI-инструменты, маркетинг-автоматизацию и агентские воркфлоу.

[💬 Telegram канал: @pomogay_marketing](https://t.me/pomogay_marketing) · [GitHub: @VKirill](https://github.com/VKirill)

</div>

## Лицензия

[MIT](./LICENSE) — Copyright (c) 2026 Кирилл Вечкасов

---

<div align="center">

*MCP Annas-Archive + Create Skill — превращаем книги в навыки агента Claude Code, одним вызовом инструмента.*

</div>
