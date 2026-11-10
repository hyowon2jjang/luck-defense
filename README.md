# Luck Defense

A single-player tower defense built around a gacha roll. Units arrive by luck;
whether you win is decided by what you do with them.

Thirty waves on a closed circular track. Monsters you fail to kill do not
leave — they keep circling and pile into the next wave, and a hundred of them
on the track ends the run. A boss every fifth wave, each one built to punish a
different kind of board. Upgrades are exponential, so spreading them is the
same as wasting them.

**Stack:** React + TypeScript + Canvas, built with Vite. No art or audio
files — every unit, boss, and sound effect is generated at runtime from code.

## Running it

```sh
npm install
npm run dev
```

## Building for the web

```sh
npm run build     # typechecks, then writes dist/
```

`dist/` is a static folder with no server requirement — copy it anywhere and
open `index.html`. Asset paths are relative (`base: './'` in
[vite.config.ts](vite.config.ts)), so it works at a domain root and inside a
subdirectory like `example.com/games/luck-defense/` without reconfiguring.

Saved runs and the best-wave record live in the browser's `localStorage` under
`meundee.*` keys, which means they are per-browser and per-origin: moving the
game to a different domain starts everyone fresh.

## Design and balance

The game is balanced against a pair of targets rather than a single number:
**roughly 20% clear rate for strategic play, and 0–2% for random input.** Hit
only the first and the game has no luck in it; hit only the second and it has
no skill. Both are measured, not estimated.

`src/core/` never touches the DOM, which is what lets the whole game run
headless. The simulator plays it with scripted policies and reports the two
rates:

```sh
npm run sim       # clear rates for the heuristic and random policies
npm run bosses    # per-boss fight length and which trait is actually biting
npm run waves     # HP curve and wave composition
npm run report    # placement and coverage
npm run audit     # roll distribution against the published odds
```

Current measurement: **22% strategic, 0% random** over 100 runs each.

[DESIGN.md](DESIGN.md) is the full design document — every system, the reasoning
behind each number, and a log of what measurement caused which change. It is
written in Korean. All in-game text is English.

Note that it is a spoiler: it documents exactly how each boss works and which
builds beat them.

## Layout

```
src/core/     rules, data, and systems — no DOM, deterministic, seeded RNG
src/sim/      headless policies and balance reports
src/render/   canvas drawing, procedural unit and boss art, hit effects
src/ui/       React shell, input, audio, persistence
dev-*.html    development harnesses (dev server only, not part of a build)
```

## Credit

Rule structure is borrowed from **MapleStory Luck Defense**, a StarCraft custom
map. Units, monsters, art, audio, and all names here are original.

## License

None — all rights reserved. The source is public to read and learn from, but it
carries no license, so it may not be copied, modified, or redistributed. Ask if
you want to do something with it.
