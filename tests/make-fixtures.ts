import { writeFileSync } from 'node:fs';
import * as alphaTab from '@coderline/alphatab';
import { DEMO_TEX } from '../core/demo';

const settings = new alphaTab.Settings();
function texToGp(tex: string, out: string) {
  const importer = new alphaTab.importer.AlphaTexImporter();
  importer.initFromString(tex, settings);
  const score = importer.readScore();
  const exporter = new alphaTab.exporter.Gp7Exporter();
  const bytes = exporter.export(score, settings);
  writeFileSync(out, bytes);
  console.log(out, bytes.length, 'bytes; title', score.title, 'bars', score.masterBars.length);
}

texToGp(DEMO_TEX, 'samples/tabfall-demo.gp');
texToGp(String.raw`\title "Repeat Test"
\tempo 120
\ts 4 4
.
\ro
:4 0.6 2.5 3.4 5.3 |
:4 3.3 5.5 7.6 8.1 |
\rc 2
:4 0.6 0.6 0.6 0.6 |`, 'samples/tabfall-repeat.gp');
texToGp(String.raw`\title "Tie Test"
\tempo 120
\ts 4 4
.
:4 0.6 0.6{t} 0.6{t} 0.6{t} |
:4 (0.6 2.5 3.4) 0.6 0.6 0.6 |`, 'samples/tabfall-tie.gp');
