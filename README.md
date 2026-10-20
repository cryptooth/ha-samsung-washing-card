# Samsung Washer Card

An animated 3D Lovelace card for Samsung washers and washer-dryers in Home Assistant.

The card renders a live [three.js](https://threejs.org) model of the machine that follows what the real one is doing. Laundry tumbles in sloshing water while it washes, the drum speeds up and the cabinet shakes during the spin, and the inside glows warm with steam while it dries. When the cycle ends, the display says *End*. Below the model you get the remaining time, the finish time, the cycle steps, power and energy.

![Washing, drying and done](images/preview.png)

<p align="center"><img src="images/demo.gif" alt="Animated preview" width="430"></p>

## Features

- Real-time 3D washer with tumbling laundry, water, bubbles, spin blur, drying glow and an opening door
- A mood colour for each phase (wash, rinse, spin, dry, cool, done, paused) that tints the card, matching the machine's LEDs
- Remaining time, finish time and a progress bar, plus a progress ring of LEDs around the program knob
- Wash, Rinse, Spin and Dry step chips, with optional chips for power, energy, door and program
- Works with the core **SmartThings** integration out of the box: point it at the washer's switch and it finds the rest
- Visual editor, white / black / silver / beige bodies, and drag to turn the model
- Self-contained: three.js is bundled, so no CDN or internet access is needed
- English and Turkish, following your Home Assistant language

## Requirements

- Home Assistant 2024.8 or newer
- A Samsung washer or washer-dryer added through the [SmartThings integration](https://www.home-assistant.io/integrations/smartthings/)
- A browser with WebGL (any current desktop or mobile browser, including the companion apps)

## Installation

### HACS (recommended)

1. In HACS, open the ⋮ menu → **Custom repositories**.
2. Add `https://github.com/cryptooth/ha-samsung-washing-card` with the type **Dashboard**.
3. Search for **Samsung Washer Card**, install it, and reload your browser.

### Manual

1. Download `samsung-washer-card.js` from the [latest release](https://github.com/cryptooth/ha-samsung-washing-card/releases/latest) (or from `dist/`).
2. Copy it to `/config/www/`. If you just created the `www` folder, restart Home Assistant once.
3. Go to **Settings → Dashboards → ⋮ → Resources** and add `/local/samsung-washer-card.js?v=1` as a **JavaScript module**. Resources only shows when **Advanced mode** is on in your user profile.
4. Hard-refresh the browser. Bump `?v=` whenever you update the file.

## Usage

Add a card and search for **Samsung Washer Card**, or use YAML:

```yaml
type: custom:samsung-washer-card
entity: switch.washer
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `entity` | `switch.washer` | The washer's power switch from SmartThings. The other entities are found from its name. |
| `name` | friendly name | Title shown on the card. |
| `color` | `white` | Body colour: `white`, `black`, `silver` or `beige`. |
| `device` | `washer` | `washer` or `dryer`. Standalone dryers: use `type: custom:samsung-dryer-card` (or `device: dryer`) for a dryer model with Sensing / Dry / Cool steps, no water, and `sensor.<x>_dryer_job_state` / `select.<x>_dryer_mode` lookups. |
| `dryer` | `true` | Show the **Dry** step (for washer-dryers). Set `false` for a washer only. |
| `height` | `320` | Height of the 3D view in pixels, or any CSS length. |
| `bloom` | `true` | Glow effect. Turn it off on low-end tablets. |
| `language` | HA language | Force a language (`en`, `tr`). |
| `entity_prefix` | from `entity` | Base name used to find the sensors, if it differs from the switch's. |
| `entities` | — | Override any entity directly (see below). |

### Entities

With `entity: switch.washer`, the card looks for these entities and uses whichever exist:

| Key | Default entity | Used for |
| --- | --- | --- |
| `job_state` | `sensor.washer_job_state` | Current phase (wash, rinse, spin, …) |
| `dryer_job_state` | `sensor.washer_dryer_job_state` | Drying phases on washer-dryers |
| `machine_state` | `sensor.washer_machine_state` | Running, paused or stopped |
| `completion_time` | `sensor.washer_completion_time` | Remaining time and finish time |
| `energy` | `sensor.washer_energy` | Energy chip |
| `power_usage` | `sensor.washer_power` | Live power chip |
| `door` | `binary_sensor.washer_door` | Opens the 3D door; door chip |
| `program` | `select.washer_washer_mode` | Program name |
| `progress` | `sensor.washer_progress` | Progress in %, if you have one |

If a model names things differently, override only what's needed:

```yaml
type: custom:samsung-washer-card
entity: switch.laundry
entities:
  job_state: sensor.laundry_washer_job_state
  completion_time: sensor.laundry_washer_completion_time
  door: binary_sensor.laundry_door
```

Without a progress sensor, the card estimates progress from the longest remaining time it has seen in the current cycle. The first cycle after installing can be off if it was already running.

Tapping the card opens the job state's more-info dialog. The power button turns the machine on or off, but it never cuts power while a cycle is running.

## Try it without Home Assistant

`demo/index.html` runs the card against a fake `hass` object that plays a sped-up cycle, with buttons to jump between phases, pause and open the door. Clone the repo and open the file in a browser: no server is needed. Add `?lang=tr` for Turkish.

## Development

```sh
npm install
npm run build   # writes dist/samsung-washer-card.js
npm run watch   # rebuilds on save; open demo/index.html to see changes
```

The source is a single file, `src/samsung-washer-card.js`. esbuild bundles it with three.js into one minified script. Please commit the rebuilt `dist/` file with your change, because CI checks that it's up to date.

## Credits

- 3D rendering by [three.js](https://github.com/mrdoob/three.js) (MIT), bundled into the card. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- The visual style follows [house-control](https://github.com/0xProbabillity/house-control).

## License

[MIT](LICENSE)

*Samsung and SmartThings are trademarks of Samsung Electronics Co., Ltd. This project is not affiliated with or endorsed by Samsung.*
