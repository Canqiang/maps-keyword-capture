import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFeedFixtureHtml, namedCards } from './feed-fixture.js';

export const screenshotBudgetKeyword = 'sichuan restaurant near Columbia University';

/** Replays the Sep 20 feed geometry with synthetic businesses in a real scrolling DOM.
 * The first eleven cards end at 2401px. The browser clamps the third scroll at 1749px
 * before nine more cards load, so the first five images cover only fourteen ranks.
 * Card heights and offsets come from the saved q0004/qa01 observations.jsonl.
 */
export async function writeScreenshotBudgetFixture(directory: string): Promise<string> {
  const heights = [190, 250, 210, 230, 210, 250, 190, 210, 190, 230, 230,
    270, 210, 230, 210, 250, 230, 210, 250, 210];
  const html = buildFeedFixtureHtml({
    query: screenshotBudgetKeyword,
    cards: namedCards(11),
    moreCards: namedCards(9, 11),
    endOfList: true,
  }).replace('</head>', `<style>
    #feed { overflow-anchor: none; }
    .hdr1 { height: 0; overflow: hidden; }
    .trail0 { height: 119px; }
    ${heights.map((height, i) => `.card:nth-of-type(${3 + i * 2}) { height: ${height}px; }`).join('\n')}
  </style></head>`);
  const file = join(directory, 'screenshot-budget-feed.html');
  await writeFile(file, html, 'utf8');
  return pathToFileURL(file).toString();
}
