# ExileAppraiser

**English** | [繁體中文](README.md)

[![Release](https://img.shields.io/github/v/release/Hsiung-Shao/exile-appraiser)](https://github.com/Hsiung-Shao/exile-appraiser/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)

A price checker for Path of Exile 1 and 2: hover an item in game, press a hotkey, and listings from the official trade site pop up next to your cursor. Works with the international and Taiwan realms, and with Traditional Chinese or English game clients.

> Formerly named `poe-price-zh`; settings from the old version are migrated automatically on first launch.

## Download

**Windows only.** Get the files from the **[latest release](https://github.com/Hsiung-Shao/exile-appraiser/releases/latest)**:

| File | What it is |
|---|---|
| `ExileAppraiser-Setup-<version>.exe` | **Installer — recommended.** By default installs for the current user into your user folder, needs no administrator rights, and creates shortcuts (you can also choose the install location). **Only the installed version updates itself**: new versions download in the background and are applied when you quit the app; you can turn this off in Settings › About. |
| `ExileAppraiser-<version>-portable.exe` | Portable build; just double-click to run. **Does not update itself**; Settings › About tells you when a new version is out, and "Open Releases" takes you to the download page. |
| `ExileAppraiser-Setup-<version>.exe.blockmap` | Used by the auto-updater (delta download: only the changed parts are fetched). **You don't need to download it.** |
| `latest.yml` | Used by the auto-updater (version info and file hash check). **You don't need to download it.** |
| Source code (zip / tar.gz) | Source archive added automatically by GitHub. Not needed to use the app. |

**Windows SmartScreen**: the app is not code-signed, so the first launch may show "Windows protected your PC". If you downloaded the file from the Releases page above, click **More info → Run anyway**.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Feature guides](#feature-guides)
  - [Well of Souls reveal OCR (PoE2)](#well-of-souls-reveal-ocr-poe2)
  - [Runeshape auto price check (PoE2)](#runeshape-auto-price-check-poe2)
  - [Poe Regex search string builder](#poe-regex-search-string-builder)
  - [Disenchant ranking (PoE1)](#disenchant-ranking-poe1)
  - [Chat commands and stash search](#chat-commands-and-stash-search)
  - [Browser preview of settings](#browser-preview-of-settings)
- [FAQ](#faq)
- [Privacy](#privacy)
- [Support and community](#support-and-community)
- [License and credits](#license-and-credits)

## Features

- **PoE1 and PoE2 in one app**: switches automatically based on which game window is in front.
- **International and Taiwan realms**: both trade sites are supported; item text from Traditional Chinese and English clients is parsed.
- **In-game overlay price check**: the panel appears over the game next to your cursor; a standalone window mode is also available.
- **Separate interface language** (中文 / English), independent of the client language; four themes, accent colour and font size; your own background image for the price panel and settings window (PNG / JPG / WebP, with brightness, panel opacity and frosted blur).
- **Poe Regex search string builder**: tick mods or names to build a string for the in-game search bar; supports combining pages, bookmarks, share codes and templates.
- **Disenchant ranking (PoE1)**: the price panel shows how much Thaumaturgic Dust a unique yields, plus a ranking of dust efficiency across all uniques.
- **PoE2 desecrated mod tiers**: shows the tier reported by the game; when only plain copied text is available, the tier is inferred from PoB2 mod data and marked as inferred.
- **PoE2 Well of Souls reveal OCR**: open the reveal panel and it is recognized automatically; each option is labelled with the tier, mod pool and value range of its desecrated mods.
- **PoE2 runeshape auto price check**: while the runeshape panel is open, each row gets a poe.ninja reference price.
- **Chat command and stash search hotkeys**: one key types chat commands such as `/hideout` or `@last ty`, or a saved string into the stash search box (PoE1 and PoE2).
- **Browser preview of settings**: view and edit settings in a normal browser; changes sync back to the overlay instantly.
- **Automatic updates**: the installed version downloads updates in the background and applies them when you quit; later updates only download what changed.
- **Startup notice**: a short "running in the background" notice with your price-check hotkey appears at the bottom right after launch, and shows the new version after an update.
- **One-click report**: when a price check goes wrong, a GitHub issue draft is prepared for you to review and submit yourself.
- **Anonymous queries**: no login and no POESESSID required.

## Getting started

### 1. First launch

- The app runs in the background with no main window. A notice at the bottom right of the screen briefly shows that it is running, together with the price-check hotkey (can be turned off in Settings › General).
- The app icon lives in the **system tray** (bottom right of the taskbar). Its right-click menu has: Show, Settings, Open settings in browser, Check for updates, Open config folder, About, Quit.
- Ways to open Settings:
  - right-click the tray icon → "Settings";
  - in game, with no price panel open, press **`Shift + Space`** (toggle overlay focus);
  - the gear ⚙ in the price panel's title bar.

### 2. Basic settings (Settings › General)

The interface language can be switched to English here; the screenshots in this README show the Chinese interface.

1. **Interface language**: the language of the app itself (繁體中文 / English).
2. **Game**: PoE1 / PoE2. By default the app switches automatically based on the game window in front ("Auto-switch PoE1 / PoE2" in Settings › Hotkeys & window).
3. **Realm**: international (`pathofexile.com`) or Taiwan (`pathofexile.tw`). The Taiwan realm currently supports the Traditional Chinese client only.
4. **Client language**: whether your **game** runs in Traditional Chinese or English. This decides how copied item text is read; the wrong choice makes parsing fail.
5. **League**: the league to price check in. If the list does not load, click "Open trade site (solve challenge)" and complete the Cloudflare check once in the window that opens.

Changes are saved automatically.

### 3. Price checking

![Settings › Hotkeys & window](docs/images/settings-hotkeys.png)

Default hotkeys (all changeable in **Settings › Hotkeys & window**: click a field and press the new combination; `Esc` / `Backspace` clears it):

| Hotkey | Default | What it does |
|---|---|---|
| Quick check | `Ctrl + D` | Hold `Ctrl` and press `D`; the panel appears next to your cursor. **Keep holding `Ctrl`** and move the mouse into the panel to use it; after releasing `Ctrl`, moving the mouse away closes the panel. |
| Locked check | `Ctrl + Alt + D` | The panel is clickable right away and does not close when you move the mouse — good for adjusting filters. |
| Toggle overlay focus | `Shift + Space` | Moves focus between the game and the overlay; opens Settings when no price panel is showing. |

Steps:

1. With the game window in front, hover an item and press the price-check hotkey. The app sends the copy keys for you to read the item text:
   - **PoE1**: sends `Ctrl + C`.
   - **PoE2**: sends `Ctrl + Alt + C` (advanced copy), which is needed to get the desecrated mod tiers from the game. The game's default `Alt` is assumed as the "show advanced description" key; a remapped key is not supported yet.
2. The panel lists the item's mod filters: **tick** the mods to include in the search and adjust value ranges (the default tolerance is in Settings › Price check).
3. Uniques, currency and similar items are searched immediately; for other items, adjust the filters and click **Search**.
4. To see the full results on the web, click **Trade** to open the same search in your system browser.
5. If a price check goes wrong, click "Report this item" at the bottom of the panel to prepare a GitHub issue draft (never sent automatically, no account name included).

> You can also paste manually: when the panel has no item (or after clicking "Paste another"), paste the item text (what `Ctrl + C` copies in game) and click "Parse".

More options in **Settings › Price check**: stat value tolerance, default price currency (PoE1 only), show seller, restore clipboard after check, and account name (marks your own listings; optional).

## Feature guides

### Well of Souls reveal OCR (PoE2)

![Well of Souls OCR badges](docs/images/well-of-souls-ocr.png)

The Well of Souls three-option reveal panel cannot be copied as text, so the app reads the screen with Windows' built-in text recognition (OCR).

**Requirements**: PoE2, overlay mode, **Traditional Chinese game client**, and the Windows Traditional Chinese OCR language pack.

**Install the Traditional Chinese OCR language pack** (once):

1. Windows Settings → **Time & language** → **Language & region**.
2. Next to "Chinese (Traditional, Taiwan)" click **⋯ → Language options** (add the language first with "Add a language" if it is not listed).
3. Under "Optical character recognition" click **Download**.
4. Back in the app, **Settings › Hotkeys & window** should show "OCR status: Available (zh-Hant-TW)" (click "Check again" if needed).

**Usage**:

1. Open the Well of Souls reveal screen; it is recognized automatically (on by default, can be turned off in Settings › Hotkeys & window).
2. Each option gets a badge on its right: `Tier · mod pool · value range`, also while the price panel is open.
3. Badges disappear when the reveal panel closes. **`Ctrl + Shift + R`** pauses / resumes auto-recognition.

- A **"?"** on a badge means you have not price checked this item in the last 10 minutes, so the base type is unknown and tiers are inferred from the bases common to all three options. **Price check the item once before opening the reveal panel** for exact results.
- **Recognition area (optional)**: in Settings › Hotkeys & window, click "Select on game screen" and drag a box around the reveal panel on the game screen; `Enter` confirms, `Esc` cancels. Recognition then looks at that area first (faster and more accurate) and falls back to the whole screen if the panel is not found there.
- **Settings** (the desecration and runeshape sections offer the same items): enable, current status, scan interval (1000 ms by default, 100–3000; below 500 ms costs noticeably more CPU), recognition area, pause / resume hotkey, select-area hotkey (unset by default).

### Runeshape auto price check (PoE2)

![Runeshape auto price check](docs/images/runeshape-prices.png)

While the runeshape panel is open, the app periodically reads the panel and shows a poe.ninja reference price to the right of each row. It only takes screenshots and runs OCR locally; no keys are sent.

**Requirements**: PoE2, overlay mode, Traditional Chinese game client, and the Traditional Chinese OCR language pack (see above). poe.ninja reference prices are **international realm only**; on the Taiwan realm rows are looked up on the Taiwan trade site instead (see "Automatic trade site lookup" below).

**Enable**: Settings › Hotkeys & window → tick "Enable runeshape auto price check (PoE2, overlay mode)" (off by default).

- **Panel area**: without a selection, the app finds the panel by itself (looks at the whole screen about every 3 seconds, then scans only the panel once found). If recognition is unstable, select the area manually, covering every item row including quantities. A manual area that does not contain the panel is **not** widened to the whole screen automatically; select again or clear the area.
- **Scan interval**: 1000 ms by default (100–3000; below 500 ms costs noticeably more CPU). Increase it if CPU use bothers you. Scanning pauses while the price panel, Settings or the area picker is open, or when the game is not in front.
- **Pause / resume hotkey** and **select-area hotkey**: unset by default; assign them in this section if you like.

**Reading the badges**:

| Badge | Meaning |
|---|---|
| `29 ex`, `1.7 div` | Reference price in Exalted Orbs, switching to Divine Orbs from 1 div; stacks show the total and the unit price. |
| Gold | Total ≥ the "above" threshold (5 ex by default). |
| Accent-coloured left border | Between the two thresholds. |
| Dim | Total < the "below" threshold (0.5 ex by default). Both thresholds can be changed in Settings. |
| `≈` before the name | The name was matched approximately and may be wrong. |
| **no price** | A specific item with no poe.ninja price that cannot be looked up on the trade site either (for example no league selected yet). Rows that can be looked up show the "Mkt" badge below instead. |
| **no fixed price** (dashed, italic) | A generic reward such as a Verisium Pile, random currency or any unique of a slot, which has no single market price. |
| `Mkt 80 ex · L20` (blue left border) | Trade site price looked up automatically (median of the cheapest 10 listings; under 3 listings shows the lowest, marked "few"). After `·` is the key filter: `L20` = gem level 20, `any level` = the panel shows no level. |
| `Mkt …` / `Mkt searching` | Queued / searching the trade site. |
| `?` | The name could not be matched (or matched several candidates); no price is looked up. |
| (no badge) "未發現" (undiscovered) | A recipe not unlocked yet; not labelled. |

**Automatic trade site lookup**: rows without a poe.ninja price (for example skill gems or levels that are not listed; every row on the Taiwan realm) are queued and looked up on the trade site automatically, no clicking needed.
Gems are always searched as **uncorrupted with 0% quality**, and at the level shown on the panel (`技能等級 20：…`) when there is one, so high-spec listings do not mislead you; the full filters are written to the app log.
One lookup at a time, at most one search plus one fetch per row, and the same filters are not searched again within 30 minutes. To **leave normal price checks alone**, lookups wait when the trade site rate limit is short, pause while the price panel or Settings is open, and stop entirely until the Retry-After time when the trade site returns 429; closing the panel drops lookups that have not been sent yet. The Taiwan realm shows prices in the listed currency.

### Poe Regex search string builder

Found in **Settings › Regex**.

1. At the top, pick the game and a list (PoE1: maps, expedition logbooks, scarabs, flasks, cluster jewels, gems, tattoos, heist gear, heist contracts, shop bases and more; PoE2: waystones, tablets, relics, expedition artifacts, flasks and charms, gems, shop bases and more; plus map value and shop condition pages).
2. Tick the mods / names you want; numeric conditions (map tier, item quantity, rarity, etc.) can be set as "≥ / ≤ / range".
3. Choose a mode: **Any of** / **All of** / **None of** (an exclusion string).
4. Choose the output language (**繁體中文 / English**, which must match your game client).
5. Click "Copy" and paste into the in-game search bar (stash, vendor, etc.).

- **Combined**: ticks from several pages are merged into one string, with checks for cross-page false matches and the length limit.
- **Bookmarks**: save a set of ticks you use often and load it later with one click.
- **Share codes**: pack all ticks into a code to share; pasting it restores them.
- **Templates**: built-in presets (e.g. dangerous T17 mods, no-reflect maps, 6-link vendor, dangerous waystone mods).

### Disenchant ranking (PoE1)

![Disenchant ranking](docs/images/dust-ranking.png)

- When you price check a unique, the panel shows how much dust it disenchants into and, with a poe.ninja price, dust per chaos.
- The **Disenchant ranking** is the "Disenchant ranking" tab of the Settings window (the ⚖ button in the price panel's title bar opens it too). It lists every unique, sortable by dust / c, dust / total cost, dust / gold and dust / c / slot, and accounts for item level, quality, jewellery catalysts, gold fees and inherent influences.
- Each row's "Trade ↗" and "ninja ↗" open the trade search or the poe.ninja page in your **system browser**.
- Prices come from poe.ninja and are **international realm only**; on the Taiwan realm only dust amounts are shown.

### Chat commands and stash search

- Configure them in Settings › Chat commands. Defaults: `F5` = `/hideout`, `F9` = `/exit`; `@last ty`, `/invite @last` and others can get their own hotkeys.
- `@last` = the last player who whispered you. Without "Send immediately" the text is only pasted into the chat box so you can edit it and press Enter.
- **Stash search**: a hotkey types a saved string into the stash search box. "Add to stash search" on the Regex tab fills one in for you.
- Hotkeys only work in overlay mode while the game window is in the foreground; keys the game itself uses (`Ctrl + C`, `Enter`, …) cannot be hotkeys.
- This feature pastes text through the clipboard and sends keys to the game (the same approach as Awakened PoE Trade).

### Browser preview of settings

- "Open settings in browser" in the tray menu or in Settings › General lets you view and edit settings in a normal browser; changes apply to the app immediately.
- It is only reachable from your own PC (`127.0.0.1` + a random key). It shuts down 20 seconds after the last browser tab closes.
- Changing the game, overlay mode or window titles from the browser takes effect the next time the app starts.

## FAQ

<details>
<summary><b>The hotkey does nothing / the overlay does not appear over the game</b></summary>

- Run the game in **windowed** or **borderless windowed** mode. In exclusive fullscreen the overlay may not show on top, and OCR may capture a black screen.
- The overlay only works while the game window is in front. Check that "PoE1 / PoE2 game window title" in Settings › Hotkeys & window matches the game window title (defaults: `Path of Exile` / `Path of Exile 2`).
- If another program already uses the hotkey, Settings shows a warning; pick a different combination.
- If you prefer not to use the overlay, untick "Overlay on the game" in Settings › Hotkeys & window to use a standalone window (the app restarts automatically).
</details>

<details>
<summary><b>The league list does not load / the trade site shows a challenge page</b></summary>

The trade site is protected by Cloudflare. In Settings › General, click **"Open trade site (solve challenge)"**, complete the check once in the window that opens, then click "Retry".

"Rate limited" means you hit the trade site's query limit; the app retries automatically after the countdown.
</details>

<details>
<summary><b>OCR does not recognise anything / cannot find the panel</b></summary>

- Check that "OCR status" in Settings › Hotkeys & window says "Available"; if the language pack is missing, install it as described [above](#well-of-souls-reveal-ocr-poe2).
- A very dark game UI (low UI brightness) hurts recognition.
- Selecting an area around the panel is usually faster and more accurate; select again if the panel moves (resolution or UI scale changes).
- Only the Traditional Chinese game client is supported for now.
</details>

<details>
<summary><b>What differs between the Taiwan and international realms?</b></summary>

- The Taiwan realm queries `pathofexile.tw` and currently supports the Traditional Chinese client only.
- poe.ninja has no Taiwan prices, so the Taiwan realm has no disenchant prices (dust amounts only) and runeshape badges have no reference price; rows are looked up on the Taiwan trade site automatically instead (prices in the listed currency).
</details>

<details>
<summary><b>Where are settings stored?</b></summary>

Changes are saved automatically to `%APPDATA%\exile-appraiser\config.json`. "Open config folder" in the tray menu opens that folder.
</details>

<details>
<summary><b>How do I turn off automatic updates?</b></summary>

Settings › About → untick "Automatic updates". You then click "Download" and "Install" yourself when a new version is out. The portable build never updates itself.
</details>

## Privacy

- **OCR runs locally**: it uses Windows' built-in text recognition; screenshots are neither saved nor uploaded, and no keys are sent to the game during recognition.
- **Anonymous queries**: only anonymous requests to the official trade site and poe.ninja; no login and no POESESSID.
- **Reports are up to you**: "Report" only opens a pre-filled GitHub issue page; you review and submit it yourself.

## Support and community

If this tool helps you, consider supporting **the maintainer of this project (ExileAppraiser)**. These links fund the maintenance of this project, not the original authors of Awakened PoE Trade / Exiled Exchange 2 credited below; see [License and credits](#license-and-credits) to support them.

- Buy Me a Coffee: https://buymeacoffee.com/hsiung
- Patreon: https://patreon.com/HsiungShao
- Discord (PoE roles): https://discord.gg/6VamPQb8nC
- Website: https://hsiung-shao.github.io/

Bug reports and suggestions: [GitHub Issues](https://github.com/Hsiung-Shao/exile-appraiser/issues).

## License and credits

Released under the [MIT License](LICENSE).

This tool builds on the following projects — please consider supporting their authors too:

- [Awakened PoE Trade](https://github.com/SnosMe/awakened-poe-trade) (SnosMe, MIT): PoE1 clipboard parsing, filters, trade queries and data files (via the Traditional Chinese fork [awakened-poe-trade-zh-TW](https://github.com/Hsiung-Shao/awakened-poe-trade-zh-TW)). Support the author: https://patreon.com/awakened_poe_trade
- [Exiled Exchange 2](https://github.com/Kvan7/Exiled-Exchange-2) (Kvan7, MIT): PoE2 clipboard parsing, filters, trade queries, data files and icons (via the Traditional Chinese version [Exiled-Exchange-2-zh-TW](https://github.com/Hsiung-Shao/Exiled-Exchange-2-zh-TW)).
- [poe-disenchant-tool](https://github.com/deronek/poe-disenchant-tool) (deronek, MIT) and the poe-dust data compiled by [@alserom](https://gist.github.com/alserom/22bdd4106806cbd4f85a5cb8c4345c08): gold fees, inventory sizes and cross-check values for disenchanting.

License notices for other third-party components are in [`NOTICE.md`](NOTICE.md) and [`LICENSES/`](LICENSES/).

Path of Exile, in-game terms, items and related data are the property of Grinding Gear Games. This project is not affiliated with or endorsed by Grinding Gear Games.
