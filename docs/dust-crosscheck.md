# 拆粉基數交叉比對(APT disenchantValue vs poe-dust.js)

> 由 `node scripts/dust-crosscheck.mjs` 產生,請勿手改。只報告差異,不改任何資料。

- APT 來源:data/poe1/en/items.ndjson ← apt-patched (Hsiung-Shao/awakened-poe-trade-zh-TW) @ a73fe3b5f1328f074c68ff42526cd3b09d881b2b
- poe-dust 來源:data/dust/poe-dust.json ← deronek/poe-disenchant-tool data/dust/poe-dust.js @ 75eb61132f2d6c94952b260f67dbb65d170332a3
- 產生時間:2026-09-28T17:52:35.543Z
- 對接鍵:英文名 + 基底(APT `refName` + `unique.base` ↔ poe-dust `name` + `baseType`),不按位置。
- 比較:`floor(disenchantValue × 2500)` vs `dustValIlvl84`、`floor(disenchantValue × 3500)` vs `dustValIlvl84Q20`(即 `dustAt(dv, {ilvl: 84, quality: 0|20})`),容忍 ±1。

## 統計

| 項目 | 筆數 |
|---|---:|
| APT 有 disenchantValue 的傳奇 | 1219 |
| poe-dust 列數 | 1103 |
| 兩邊都有且一致 | 955 |
| 兩邊都有但不一致 | 25 |
| 只在 APT | 239 |
| 只在 poe-dust | 123 |
| 兩邊都有但 poe-dust 缺 goldCost | 0 |

## 不一致

「勢力數 n 時吻合」= 把 APT 公式的勢力數設成 n(每個 +50%)後兩欄都在容忍範圍內;共 24 / 25 筆。這些推定是本身固定帶勢力(Shaper/Elder 等)的傳奇:APT 在解析物品文字時才加勢力倍率,disenchantValue 不含。**拆粉排行**沒有物品文字,改用 `inherentInfluencesFromPoeDust` 對這些列套上 n(只接受 1 / 2 且兩欄恰好吻合);單件查價(有物品文字)不受影響。沒有 n 的列(如 Venarius' Astrolabe)排行維持 APT 值。

| 名稱 | 基底 | disenchantValue | APT q0 | poe-dust q0 | 比值 q0 | APT q20 | poe-dust q20 | 比值 q20 | 勢力數 n 時吻合 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Blasphemer's Grasp | Assassin's Mitts | 14.49 | 36225 | 54338 | 1.5000 | 50715 | 68828 | 1.3572 | 1 |
| Call of the Void | Sapphire Ring | 2.46 | 6150 | 12300 | 2.0000 | 8610 | 14760 | 1.7143 | 2 |
| Cyclopean Coil | Leather Belt | 14.49 | 36225 | 54338 | 1.5000 | 50715 | 68828 | 1.3572 | 1 |
| Disintegrator | Maelström Staff | 38.63 | 96575 | 193150 | 2.0000 | 135205 | 231780 | 1.7143 | 2 |
| Echoes of Creation | Royal Burgonet | 13.26 | 33150 | 49725 | 1.5000 | 46410 | 62985 | 1.3571 | 1 |
| Entropic Devastation | Assassin's Mitts | 134.79 | 336975 | 505462 | 1.5000 | 471765 | 640253 | 1.3571 | 1 |
| Hopeshredder | Ranger Bow | 17.82 | 44550 | 66825 | 1.5000 | 62370 | 84645 | 1.3571 | 1 |
| Impresence | Onyx Amulet | 20.66 | 51650 | 77475 | 1.5000 | 72310 | 98135 | 1.3571 | 1 |
| Indigon | Hubris Circlet | 44.78 | 111950 | 223900 | 2.0000 | 156730 | 268680 | 1.7143 | 2 |
| Mark of the Elder | Steel Ring | 19.48 | 48700 | 73050 | 1.5000 | 68180 | 92530 | 1.3571 | 1 |
| Mark of the Shaper | Opal Ring | 19.48 | 48700 | 73050 | 1.5000 | 68180 | 92530 | 1.3571 | 1 |
| Nebuloch | Nightmare Mace | 17.82 | 44550 | 66825 | 1.5000 | 62370 | 84645 | 1.3571 | 1 |
| Replica Eternity Shroud | Blood Raiment | 165.78 | 414450 | 828900 | 2.0000 | 580230 | 994680 | 1.7143 | 2 |
| Replica Voidwalker | Murder Boots | 14.93 | 37325 | 55988 | 1.5000 | 52255 | 70918 | 1.3572 | 1 |
| Shaper's Touch | Crusader Gloves | 13.66 | 34150 | 51225 | 1.5000 | 47810 | 64885 | 1.3571 | 1 |
| Shimmeron | Tornado Wand | 17.82 | 44550 | 66825 | 1.5000 | 62370 | 84645 | 1.3571 | 1 |
| Solstice Vigil | Onyx Amulet | 12.2 | 30500 | 45750 | 1.5000 | 42700 | 57950 | 1.3571 | 1 |
| Soul Ascension | Carnal Mitts | 317.64 | 794100 | 1191150 | 1.5000 | 1111740 | 1508790 | 1.3571 | 1 |
| Starforge | Infernal Sword | 703.49 | 1758725 | 2638088 | 1.5000 | 2462215 | 3341578 | 1.3571 | 1 |
| The Devourer of Minds | Pig-Faced Bascinet | 37.5 | 93750 | 140625 | 1.5000 | 131250 | 178125 | 1.3571 | 1 |
| The Eternity Shroud | Blood Raiment | 39.79 | 99475 | 198950 | 2.0000 | 139265 | 238740 | 1.7143 | 2 |
| The Tides of Time | Vanguard Belt | 50.4 | 126000 | 189000 | 1.5000 | 176400 | 239400 | 1.3571 | 1 |
| Venarius' Astrolabe | Astrolabe Amulet | 53.47 | 133675 | 534700 | 4.0000 | 187145 | 588170 | 3.1429 | — |
| Voidforge | Infernal Sword | 703.49 | 1758725 | 3517450 | 2.0000 | 2462215 | 4220940 | 1.7143 | 2 |
| Voidwalker | Murder Boots | 14.93 | 37325 | 55988 | 1.5000 | 52255 | 70918 | 1.3572 | 1 |

## 只在 APT(poe-dust 沒有這個 名稱+基底)

| 名稱 | 基底 | poe-dust 同名但基底不同 |
|---|---|---|
| Acton's Nightmare | Map |  |
| Altered Distant Memory | Map |  |
| Amanamu's Gaze | Ghastly Eye Jewel |  |
| Ambition | Vaal Aspect |  |
| Ancestral Vision | Viridian Jewel |  |
| Apex Mode | Cobalt Jewel |  |
| Ashcaller | Goat's Horn | Carved Wand |
| Atziri's Promise | Amethyst Flask |  |
| Atziri's Reign | Crimson Jewel |  |
| Augmented Distant Memory | Map |  |
| Baleful Dominion | Hypnotic Eye Jewel |  |
| Beauty | Vaal Aspect |  |
| Blightwell | Shield Crab Talisman | Clutching Talisman |
| Blood of the Karui | Sanctified Life Flask |  |
| Bloodnotch | Crimson Jewel |  |
| Bottled Faith | Sulphur Flask |  |
| Bound By Destiny | Prismatic Jewel |  |
| Brutal Restraint | Timeless Jewel |  |
| Brute Force Solution | Cobalt Jewel |  |
| Caer Blaidd, Wolfpack's Den | Map |  |
| Calamitous Visions | Small Cluster Jewel |  |
| Careful Planning | Viridian Jewel |  |
| Chill of Corruption | Viridian Jewel |  |
| Cinderswallow Urn | Silver Flask |  |
| Combat Focus | Cobalt Jewel |  |
| Combat Focus | Crimson Jewel |  |
| Combat Focus | Viridian Jewel |  |
| Cooperation | Vaal Aspect |  |
| Coralito's Signature | Diamond Flask |  |
| Cortex | Map |  |
| Coruscating Elixir | Ruby Flask |  |
| Curio of Absorption | Primordial Fragment |  |
| Curio of Consumption | Primordial Fragment |  |
| Curio of Decay | Primordial Fragment |  |
| Curio of Potential | Primordial Fragment |  |
| Curiosity | Vaal Aspect |  |
| Dead Reckoning | Cobalt Jewel |  |
| Death and Taxes | Map |  |
| Destructive Aspiration | Ghastly Eye Jewel |  |
| Dissolution of the Flesh | Crimson Jewel |  |
| Divination Distillate | Large Hybrid Flask |  |
| Doedre's Elixir | Greater Mana Flask |  |
| Doryani's Delusion | Leviathan Greaves | Sorcerer Boots |
| Doryani's Delusion | Velour Boots | Sorcerer Boots |
| Doryani's Delusion | Warlock Boots | Sorcerer Boots |
| Doryani's Machinarium | Map |  |
| Dying Sun | Ruby Flask |  |
| Eclipse Solaris | Faun's Horn | Engraved Wand |
| Efficient Training | Crimson Jewel |  |
| Elegant Hubris | Timeless Jewel |  |
| Elixir of the Unbroken Circle | Iron Flask |  |
| Emperor's Cunning | Viridian Jewel |  |
| Emperor's Mastery | Prismatic Jewel |  |
| Emperor's Might | Crimson Jewel |  |
| Emperor's Wit | Cobalt Jewel |  |
| Energised Armour | Crimson Jewel |  |
| Energy From Within | Cobalt Jewel |  |
| Extinguishing Grasp | Searching Eye Jewel |  |
| Fertile Mind | Cobalt Jewel |  |
| Festering Vengeance | Murderous Eye Jewel |  |
| Fevered Mind | Cobalt Jewel |  |
| Firesong | Crimson Jewel |  |
| First Piece of Brutality | Imperial Staff Piece |  |
| First Piece of Directions | Blunt Arrow Quiver Piece |  |
| First Piece of Focus | Archon Kite Shield Piece |  |
| First Piece of Storms | Callous Mask Piece |  |
| First Piece of Time | Cloth Belt Piece |  |
| First Piece of the Arcane | Legion Sword Piece |  |
| Fluid Motion | Viridian Jewel |  |
| Forbidden Flame | Crimson Jewel |  |
| Forbidden Flesh | Cobalt Jewel |  |
| Forbidden Taste | Quartz Flask |  |
| Fortress Covenant | Cobalt Jewel |  |
| Fourth Piece of Focus | Archon Kite Shield Piece |  |
| Fragility | Crimson Jewel |  |
| Glorious Vanity | Timeless Jewel |  |
| Grand Spectrum | Cobalt Jewel |  |
| Grand Spectrum | Crimson Jewel |  |
| Grand Spectrum | Viridian Jewel |  |
| Grasping Nightshade | Sporebloom Tincture |  |
| Hall of Grandmasters | Map |  |
| Hallowed Ground | Map |  |
| Healthy Mind | Cobalt Jewel |  |
| Hidden Potential | Viridian Jewel |  |
| Immutable Force | Crimson Jewel |  |
| Impossible Escape | Viridian Jewel |  |
| Inertia | Crimson Jewel |  |
| Inspired Learning | Crimson Jewel |  |
| Intuitive Leap | Viridian Jewel |  |
| Kiara's Determination | Silver Flask |  |
| Kitava's Teachings | Small Cluster Jewel |  |
| Kurgal's Gaze | Hypnotic Eye Jewel |  |
| Lavianga's Spirit | Sanctified Mana Flask |  |
| Lethal Pride | Timeless Jewel |  |
| Lion's Roar | Granite Flask |  |
| Lioneye's Fall | Viridian Jewel |  |
| Maelström of Chaos | Map |  |
| Mao Kun | Map |  |
| Megalomaniac | Medium Cluster Jewel |  |
| Melding of the Flesh | Cobalt Jewel |  |
| Midnight Bargain | Calling Wand | Engraved Wand |
| Might of the Meek | Crimson Jewel |  |
| Mightblood Ire | Ironwood Tincture |  |
| Militant Faith | Timeless Jewel |  |
| Moonsorrow | Kinetic Wand | Imbued Wand |
| Nadir Mode | Cobalt Jewel |  |
| Natural Affinity | Small Cluster Jewel |  |
| Natural Hierarchy | Rhex Talisman | Rotfeather Talisman |
| Oba's Cursed Trove | Map |  |
| Obliteration | Omen Wand | Imbued Wand |
| Olmec's Sanctum | Map |  |
| Olroth's Resolve | Iron Flask |  |
| One With Nothing | Small Cluster Jewel |  |
| Oriath's End | Bismuth Flask |  |
| Pacifism | Viridian Jewel |  |
| Pillars of Arun | Map |  |
| Piscator's Vigil | Kinetic Wand | Imbued Wand |
| Poorjoy's Asylum | Map |  |
| Powerlessness | Cobalt Jewel |  |
| Precursor's Emblem | Prismatic Ring | Ruby Ring |
| Precursor's Emblem | Sapphire Ring | Ruby Ring |
| Precursor's Emblem | Topaz Ring | Ruby Ring |
| Precursor's Emblem | Two-Stone Ring | Ruby Ring |
| Primordial Eminence | Viridian Jewel |  |
| Primordial Harmony | Cobalt Jewel |  |
| Primordial Might | Crimson Jewel |  |
| Progenesis | Amethyst Flask |  |
| Pure Talent | Viridian Jewel |  |
| Quickening Covenant | Viridian Jewel |  |
| Rain of Splinters | Crimson Jewel |  |
| Rational Doctrine | Cobalt Jewel |  |
| Reckless Defence | Cobalt Jewel |  |
| Reclaimed Malevolence | Assembled Eye Jewel |  |
| Replica Cortex | Map |  |
| Replica Fragility | Crimson Jewel |  |
| Replica Lavianga's Spirit | Sanctified Mana Flask |  |
| Replica Midnight Bargain | Calling Wand | Engraved Wand |
| Replica Pacifism | Viridian Jewel |  |
| Replica Pillars of Arun | Map |  |
| Replica Poorjoy's Asylum | Map |  |
| Replica Powerlessness | Cobalt Jewel |  |
| Replica Primordial Might | Crimson Jewel |  |
| Replica Reckless Defence | Cobalt Jewel |  |
| Replica Rumi's Concoction | Granite Flask |  |
| Replica Sorrow of the Divine | Sulphur Flask |  |
| Replica Twyzel | Blasting Wand | Sage Wand |
| Replica Witchfire Brew | Stibnite Flask |  |
| Rewritten Distant Memory | Map |  |
| Rigwald's Curse | Wolf Alpha Talisman | Wereclaw Talisman |
| Rotgut | Quicksilver Flask |  |
| Rumi's Concoction | Granite Flask |  |
| Sap of the Seasons | Prismatic Tincture |  |
| Second Piece of Brutality | Imperial Staff Piece |  |
| Second Piece of Directions | Blunt Arrow Quiver Piece |  |
| Second Piece of Focus | Archon Kite Shield Piece |  |
| Second Piece of Storms | Callous Mask Piece |  |
| Second Piece of Time | Cloth Belt Piece |  |
| Second Piece of the Arcane | Legion Sword Piece |  |
| Seething Fury | Viridian Jewel |  |
| Self-Flagellation | Viridian Jewel |  |
| Sin's Rebirth | Stibnite Flask |  |
| Soul Catcher | Quartz Flask |  |
| Soul Ripper | Quartz Flask |  |
| Split Personality | Crimson Jewel |  |
| Starlight Chalice | Iron Flask |  |
| Stormblood | Sapphire Flask |  |
| Stormblood | Topaz Flask |  |
| Stormshroud | Viridian Jewel |  |
| Sublime Vision | Prismatic Jewel |  |
| Taste of Hate | Sapphire Flask |  |
| Tecrod's Gaze | Murderous Eye Jewel |  |
| Tempered Flesh | Crimson Jewel |  |
| Tempered Mind | Cobalt Jewel |  |
| Tempered Spirit | Viridian Jewel |  |
| That Which Was Taken | Crimson Jewel |  |
| The Adorned | Crimson Jewel |  |
| The Anima Stone | Prismatic Jewel |  |
| The Balance of Terror | Cobalt Jewel |  |
| The Battle Within | Oakbranch Tincture |  |
| The Blood of Innocence | Censer Relic |  |
| The Blue Dream | Cobalt Jewel |  |
| The Blue Nightmare | Cobalt Jewel |  |
| The Broken Censer | Tome Relic |  |
| The Chains of Castigation | Processional Relic |  |
| The Coward's Trial | Map |  |
| The First Crest | Coffer Relic |  |
| The Front Line | Small Cluster Jewel |  |
| The Gilded Chalice | Processional Relic |  |
| The Golden Rule | Viridian Jewel |  |
| The Green Dream | Viridian Jewel |  |
| The Green Nightmare | Viridian Jewel |  |
| The Hour of Divinity | Censer Relic |  |
| The Interrogation | Small Cluster Jewel |  |
| The Light of Meaning | Prismatic Jewel |  |
| The Night Lamp | Urn Relic |  |
| The Original Scripture | Papyrus Relic |  |
| The Overflowing Chalice | Sulphur Flask |  |
| The Perandus Pact | Prismatic Jewel |  |
| The Poet's Pen | Somatic Wand | Carved Wand |
| The Power and the Promise | Tome Relic |  |
| The Putrid Cloister | Map |  |
| The Red Dream | Crimson Jewel |  |
| The Red Nightmare | Crimson Jewel |  |
| The Second Sacrament | Candlestick Relic |  |
| The Siege | Small Cluster Jewel |  |
| The Sorrow of the Divine | Sulphur Flask |  |
| The Twilight Temple | Map |  |
| The Utmost | Gold Amulet |  |
| The Vinktar Square | Map |  |
| The Wise Oak | Bismuth Flask |  |
| The Writhing Jar | Hallowed Hybrid Flask |  |
| Third Piece of Brutality | Imperial Staff Piece |  |
| Third Piece of Directions | Blunt Arrow Quiver Piece |  |
| Third Piece of Focus | Archon Kite Shield Piece |  |
| Third Piece of Storms | Callous Mask Piece |  |
| Third Piece of the Arcane | Legion Sword Piece |  |
| Thread of Hope | Crimson Jewel |  |
| To Dust | Cobalt Jewel |  |
| Transcendent Flesh | Crimson Jewel |  |
| Transcendent Mind | Cobalt Jewel |  |
| Transcendent Spirit | Viridian Jewel |  |
| Twisted Distant Memory | Map |  |
| Twyzel | Blasting Wand | Sage Wand |
| Ulaman's Gaze | Searching Eye Jewel |  |
| Unending Hunger | Cobalt Jewel |  |
| Unnatural Instinct | Viridian Jewel |  |
| Vaults of Atziri | Map |  |
| Vessel of Vinktar | Topaz Flask |  |
| Voices | Large Cluster Jewel |  |
| Voidfletcher | Ornate Quiver | Primal Arrow Quiver |
| Vorana's Preparation | Iron Flask |  |
| Watcher's Eye | Prismatic Jewel |  |
| Wellwater Phylactery | Colossal Mana Flask |  |
| Whakawairua Tuahu | Map |  |
| Wildfire Phloem | Ashbark Tincture |  |
| Wine of the Prophet | Gold Flask |  |
| Witchbane | Cobalt Jewel |  |
| Witchfire Brew | Stibnite Flask |  |
| Zerphi's Last Breath | Grand Mana Flask |  |

## 只在 poe-dust(APT 沒有這個 名稱+基底)

| 名稱 | 基底 | APT 同名但基底不同 |
|---|---|---|
| Amplification Rod | Spiraled Wand |  |
| Angler's Plait | Unset Ring |  |
| Asenath's Chant | Iron Circlet |  |
| Ashcaller | Carved Wand | Goat's Horn |
| Atziri's Mirror | Golden Buckler |  |
| Blightwell | Clutching Talisman | Shield Crab Talisman |
| Bloodboil | Coral Ring |  |
| Broadstroke | Shackled Boots |  |
| Chaber Cairn | Great Mallet |  |
| Chitus' Needle | Elegant Foil |  |
| Corona Solaris | Crystal Wand |  |
| Cragfall | Serrated Arrow Quiver |  |
| Crystal Vault | Latticed Ringmail |  |
| Death's Opus | Death Bow |  |
| Deidbellow | Gilded Sallet |  |
| Demigod's Authority | Golden Blade |  |
| Demigod's Beacon | Golden Flame |  |
| Demigod's Bounty | Golden Obi |  |
| Demigod's Dominance | Golden Mantle |  |
| Demigod's Eye | Golden Hoop |  |
| Demigod's Immortality | Golden Visage |  |
| Demigod's Presence | Gold Amulet |  |
| Demigod's Stride | Golden Caligae |  |
| Demigod's Touch | Golden Bracers |  |
| Demigod's Triumph | Golden Wreath |  |
| Doedre's Malevolence | Velvet Gloves |  |
| Doomfletch's Prism | Royal Bow |  |
| Doryani's Delusion | Sorcerer Boots | Leviathan Greaves, Velour Boots, Warlock Boots |
| Dreadbeak | Rusted Sword |  |
| Dreadsurge | Cleaver |  |
| Duskblight | Ironscale Boots |  |
| Duskwing | Saqawine Vulture |  |
| Eclipse Solaris | Engraved Wand | Faun's Horn |
| El'Abin's Visage | Fencer Helm |  |
| Ezomyte Hold | Iron Hat |  |
| Fleshrender | Exquisite Blade |  |
| Fox's Fortune | Wild Leather |  |
| Frostferno | Leather Hood |  |
| Geofri's Devotion | Brass Maul |  |
| Geofri's Legacy | Great Crown |  |
| Glitterdisc | Burnished Spiked Shield |  |
| Greedtrap | Velvet Slippers |  |
| Honoured Alliance | Coral Ring |  |
| Hrimburn | Goathide Gloves |  |
| Hrimnor's Dirge | Sledgehammer |  |
| Hyrri's Demise | Sharktooth Arrow Quiver |  |
| Iron Heart | Crusader Plate |  |
| Izaro's Dilemma | Imperial Claw |  |
| Kaltensoul | Painted Buckler |  |
| Kaom's Way | Coral Ring |  |
| Karui Charge | Jade Amulet |  |
| Khatal's Geyser | Lapis Amulet |  |
| Khatal's Weeping | Lapis Amulet |  |
| Malachai's Awakening | Iron Mask |  |
| Martyr's Crown | Vine Circlet |  |
| Midnight Bargain | Engraved Wand | Calling Wand |
| Mirebough | Gnarled Branch |  |
| Moonsorrow | Imbued Wand | Kinetic Wand |
| Natural Hierarchy | Rotfeather Talisman | Rhex Talisman |
| Ngamahu Tiki | Coral Amulet |  |
| Obliteration | Imbued Wand | Omen Wand |
| Panquetzaliztli | Jagged Maul |  |
| Piscator's Vigil | Imbued Wand | Kinetic Wand |
| Queen's Escape | Ornate Sword |  |
| Realm Ender | Iron Staff |  |
| Reefbane | Fishing Rod |  |
| Replica Forbidden Shako | Great Crown |  |
| Replica Midnight Bargain | Engraved Wand | Calling Wand |
| Replica Soul Taker | Siege Axe |  |
| Replica Twyzel | Sage Wand | Blasting Wand |
| Rigwald's Curse | Wereclaw Talisman | Wolf Alpha Talisman |
| Rotting Legion | Loricated Ringmail |  |
| Sanguine Gambol | Skinning Knife |  |
| Saresh's Darkness | Chain Belt |  |
| Serle's Masterwork | Phantom Mace |  |
| Shavronne's Gambit | Scholar Boots |  |
| Silverbough | Crude Bow |  |
| Skysunder | Exquisite Blade |  |
| Solerai's Radiance | Chain Belt |  |
| Song of the Sirens | Fishing Rod |  |
| Spine of the First Claimant | Iron Sceptre |  |
| Sunspite | Clasped Boots |  |
| Talisman of the Victor | Jet Amulet |  |
| The Bane of Hope | Maraketh Bow |  |
| The Broken Elegy | Foul Staff |  |
| The Cauteriser | Woodsplitter |  |
| The Dancing Duo | Reaver Sword |  |
| The Desecrated Chalice | Coronal Maul |  |
| The Effigon | Gold Amulet |  |
| The Enmity Divine | Imperial Staff |  |
| The Flame of Hope | Maraketh Bow |  |
| The Flow Untethered | Cloth Belt |  |
| The Fracturing Spinner | Blunt Arrow Quiver |  |
| The Geomantic Gyre | Highborn Staff |  |
| The Goddess Unleashed | Eternal Sword |  |
| The Gryphon | Jade Hatchet |  |
| The Megalomaniac | Bronze Stalker Sentinel |  |
| The Nomad | Studded Belt |  |
| The Oak | Plank Kite Shield |  |
| The Peregrine | Visored Sallet |  |
| The Poet's Pen | Carved Wand | Somatic Wand |
| The Redblade | Gladius |  |
| The Rippling Thoughts | Legion Sword |  |
| The Sacred Chalice | Coronal Maul |  |
| The Sands of Time | Tyrant's Sekhem |  |
| The Signal Fire | Blazing Arrow Quiver |  |
| The Stormwall | Royal Staff |  |
| The Tactician | Studded Belt |  |
| The Tempest | Long Bow |  |
| The Tempest's Binding | Callous Mask |  |
| The Unshattered Will | Archon Kite Shield |  |
| Thirst for Horrors | War Buckler |  |
| Timetwist | Moonstone Ring |  |
| Tipua Kaikohuru | Whalebone Rapier |  |
| Twyzel | Sage Wand | Blasting Wand |
| Viper's Scales | Full Scale Armour |  |
| Voidfletcher | Primal Arrow Quiver | Ornate Quiver |
| Voidheart | Iron Ring |  |
| Wall of Brambles | Plate Vest |  |
| Whakatutuki o Matua | Tarnished Spirit Shield |  |
| Wildwrap | Strapped Leather |  |
| Windshriek | Reinforced Greaves |  |
| Worldcarver | Dragonscale Gauntlets |  |

## poe-dust 缺 goldCost

(無)
