# Gallery overlays

Each gallery entry is three files in `data/`:

- `<name>.png`: the image
- `<name>.json`: its metadata
- `<name>_annotated.svg`: the catalogue overlay, drawn at the PNG's pixel size

The overlay is made by `annotate.js`. It drives PixInsight's stock ImageSolver 6.4.2 and AnnotateImage 2.3.1 engines. All settings come from `style.json`, and nothing is read from or written to PixInsight's saved dialog settings, so every image gets the same layers, colours and sizes.

| File | Purpose |
|---|---|
| `style.json` | Holds every solver, engine and layer parameter, plus the sizing and layer-selection rules |
| `annotate.js` | The runner (PJSR). It solves the image if it has no solution, then writes the SVG |
| `bundle.py` | Expands `annotate.js` and its `#include`s into one file for the PixInsight MCP bridge, and prints the `run_script` call |

## From finished image to committed entry

1. **Export the PNG.** Save the final image as 8-bit RGB PNG at `data/<name>.png`, then shrink it with `scripts/optipng.sh data/<name>.png`.
2. **Write `data/<name>.json`.** Copy the fields from an existing entry: `title`, `annotated: true`, `filters`, `frames` and `integrationSeconds` per filter, and `text`. `text` is one short factual sentence, for example: "The Cosmic Bat Nebula is a dark nebula in the constellation Ophiuchus."
3. **Solve and annotate.** Use either route:
   - **GUI:** open the image in PixInsight (the XISF with a solution, or the PNG). Run *Script > Execute Script File > scripts/annotate/annotate.js* and save as `data/<name>_annotated.svg`.
   - **Headless (MCP):**

     ```sh
     python3 scripts/annotate/bundle.py --image data/<name>.png --target "NGC 7000" [--resolution 1.92] [--date 2025-09-30]
     ```

     Paste the printed code into `mcp__pixinsight__run_script`. The SVG goes next to the PNG, and the report to `<svg>.report.json`.

   A PNG has no WCS, so the script solves it:
   - **Centre:** `ra`/`dec` if given, otherwise the image's keywords, otherwise a Sesame lookup of `target`.
   - **Scale:** `resolution` if given, otherwise the existing WCS or FOCALLEN/XPIXSZ, otherwise 1.92"/px (75Q + 2600MM). A drizzled image needs its real scale; the Virgo panels are 0.96.
   - **Date:** `date` if given, otherwise DATE-OBS, otherwise 2016-01-01. The date only affects proper motion.
4. **Check the overlay.** Look at the SVG over the PNG, for example `rsvg-convert -w 1600 x.svg` composited over a 1600 px copy of the PNG. Also read `selection` in the report: which layers were used, how many labels, and any magnitude or size limit applied.
5. **Commit the three files.**

## Per-image overrides: `data/<name>.annotate.json` (optional)

All keys are optional:

```json
{
  "target": "LDN 43", "ra": 248.62, "dec": -15.79, "resolution": 0.96, "date": "2025-06-01",
  "resolve": false,
  "solver": { "enableSimplifier": false },
  "fieldType": "galaxy",
  "addLayers": ["LBN"], "removeLayers": ["PGC"],
  "minLabels": 8, "targetLabels": 12, "maxPerLayer": 20,
  "layerMax": { "NGC-IC": 40 }
}
```

## Sizing

- `graphicsScale = width / 3000`, rounded to 0.01. Lines are drawn at `lineWidth × graphicsScale`.
- `textScale = 2`. AnnotateImage draws text at `labelSize × graphicsScale × textScale`, so text also grows in proportion to width. If both scales were `width / 3000`, text would grow with width squared.
- A 6k image gets about 2 and 2, the same as `north-america` and `cosmic-bat`: NGC labels about 66 px, grid labels about 50 px, lines 2 px, constellation lines 8 px.
- A 12k image gets 4 and 2: NGC labels about 129 px, 1.1 % of the width.

## Style

All labels use DejaVu Sans. Duplicate removal and label placement optimisation are on. The output is an SVG only, with no annotated image.

| Layer | Line | Label | Base size |
|---|---|---|---|
| Grid | #ffffff, 50 % | #ffffff | 12 |
| Constellation lines | #ff8080, 50 %, width 4 | #ff8080 | 32 |
| Named stars | #ffd700 | #ffd700 | 14 |
| Messier | #8080ff | #8080ff | 16 |
| NGC-IC | #ff8080 | #ff8080 | 16 |
| PGC | #00ffff | #00ffff | 12 |
| LDN | #bc8f8f | #f08080 | 10 |
| Sharpless | #ff9966 | #ff9966 | 12 |
| LBN | #ffb07a | #ffb07a | 10 |
| Barnard | #d2b48c | #d2b48c | 10 |
| VdB | #87cefa | #87cefa | 10 |

The last four layers are new; the others keep the existing gallery colours.

## Layer rules

A label count is the number of catalogue objects inside the frame after duplicate removal. Grid labels and constellation names are not counted.

1. **Core layers are always drawn:** grid, constellation lines, named stars, Messier and NGC-IC. Messier is core because it adds M numbers and common names without adding clutter; duplicate removal keeps "M84" instead of "NGC4374".
2. **Cap per layer.** No layer shows more than `maxPerLayer` = 20 objects. When a layer has more, it keeps the brightest (NGC-IC, stars, Messier, VdB) or the largest (PGC, Sharpless, LDN, LBN, Barnard). The report gives the resulting limit, for example "mag <= 13.80".
3. **Field type:**
   - If the largest Messier/NGC-IC object in the frame has a PGC number, it is a galaxy field.
   - Otherwise, galactic latitude |b| < 30° makes it a Milky Way field, and anything higher a galaxy field.
4. **Optional layers.** While fewer than `minLabels` = 8 objects are labelled, the next layer in priority order is tried:
   - Milky Way fields: Sharpless, LDN, Barnard, LBN, VdB, PGC.
   - Galaxy fields: PGC, Sharpless, LDN, Barnard.

   An added layer keeps only its most prominent objects, up to `targetLabels` = 12 in total. A layer with nothing in the frame is skipped.
5. **PGC size limit.** PGC objects smaller than 24 px on the image are never labelled. Smaller ones are invisible at gallery scale; this is the source of the flood of PGC labels in the old overlays.

**Why these numbers.** Counts of object labels in the existing overlays, ignoring the grid:

| Group | Overlays and object counts |
|---|---|
| Bare | rosette 2, western_veil 3, cosmic-bat 4 |
| Readable | rosette_sho 7, north-america 8, orion_nebula about 17, horsehead_and_flame about 20 without its PGCs |
| Flooded by PGC | heart-and-soul 27, andromeda 84, triangulum 120, ic3393 panels 390–560 |

So the floor is 8, adding layers stops by 12, and the ceiling is 20 per layer.

## Notes

- **Alignment retry:** a centre taken from the target name can be about 0.5° off the frame centre; NGC 7000 is that far from the north-america frame centre. The default initial alignment then fails, so the script retries with `tryExhaustiveInitialAlignment: true`.
- **Two solver guards:**
  - Retry: if the simplified distortion surface has residuals above 2 px, the script solves once more with `enableSimplifier: false`. AnnotateImage silently drops objects on a bad surface; ic3393_panel4 lost M86 this way.
  - Local catalogue check: AnnotateImage keeps an object only if RA/Dec → pixel → RA/Dec comes back within 1 px, and that dropped 8 φ Oph between two solves of cosmic-bat. The script relaxes the check to 5 px.
- **Large PNGs:** PixInsight cannot open a PNG larger than 256 MiB decoded (w × h × 4, for example 12k × 8k), because of the Qt reader limit. `bundle.py` converts such a PNG to a TIFF next to the bundle. In the GUI, open the XISF, or a TIFF made with `magick in.png -compress none out.tif`.
- **Bridge timeout:** the MCP bridge gives up after 300 s. A 12k image that needs two solves takes longer, but PixInsight carries on, so wait for the report file.
- **Stock script paths:** `annotate.js` includes the stock scripts from `/opt/PixInsight/src/scripts/`, which is the Linux install path.
