# `@deepseek-ai/dsh-tavern`

English | [中文](README.zh.md)

An optional patch layer over the dsh Web profile. It binds the Web server using `DSH_WEB_HOST` and `DSH_WEB_PORT` (defaults `0.0.0.0:3080`) and inserts [`ui-tavern`](../../client/ui-tavern/README.md) into the browser plugin roster. The bundle also loads the Tavern Host service that stores imported assets, records session selections, and projects the selected persona and World Info into later requests.

Run it from a built checkout with:

```sh
corepack pnpm run tavern
```

The Web app's own arguments can be forwarded after `--`, for example `corepack pnpm run tavern -- --port 3081`. The equivalent explicit command is `corepack pnpm dsh web --patch packages/bundle/tavern/cordis.patch.yml`.

To verify the built product against local Character Card and World Info JSON files, run `DSH_TAVERN_CHARACTER_JSON=... DSH_TAVERN_WORLD_INFO_JSON=... corepack pnpm test:tavern:release` (PowerShell uses `$env:DSH_TAVERN_CHARACTER_JSON=...` and `$env:DSH_TAVERN_WORLD_INFO_JSON=...`). The check uses a local mock model and does not require Docker or a real API key.

Build and run the first deployable container from the repository root with:

```sh
docker build -f Dockerfile.tavern -t dsh-tavern .
docker run --rm -p 3080:3080 -v dsh-tavern-data:/data/.dsh dsh-tavern
```

Open `http://127.0.0.1:3080/` after the Web server starts.

The layer selects the dedicated `tavern` agent preset, which starts direct roleplay sessions with a complete persona and no coding tool rows. The workbench imports JSON Character Cards and World Info, saves the selected assets to the current Session, exposes Memory, canonical location/time Story State, candidate Swipe selection, regeneration into a child Session, and the latest recorded system prompt. Selected character fields and World Info entry text are rendered as author-provided story data; they do not grant tools or alter system policy. General-purpose fork, group chat, and scene orchestration remain separate capabilities.

## Model Experience

None, as the browser plugin adds no model-visible text by itself; selecting a character or World Info asset changes later requests through the Host runtime's session projection.

#### KV Cache effect

None. The patch does not alter provider requests.

## Known Limitations and Deferred Work

- **Development bundle** — it currently runs from the source checkout and is not yet a separately published Tavern distribution.
- **Environment configuration** — the default all-interface bind is intended for a container or trusted local network; set `DSH_WEB_HOST=127.0.0.1` for loopback-only use.
