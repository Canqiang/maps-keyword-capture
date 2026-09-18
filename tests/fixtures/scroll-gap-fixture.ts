import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildFeedFixtureHtml, namedCards } from './feed-fixture.js';

/** Reconstructs the recorded 2026-09-18 brunch geometry in a real scrolling DOM.
 * At offset 658, rank 9 ends at y=922 and rank 10 starts at y=923; loaded rank 13
 * is below the viewport at y=1446. The scroll range ends at 1545.
 */
export async function writeScrollGapFixture(options: { jumpToBottomOnce?: boolean; replaceOnRecovery?: boolean } = {}): Promise<string> {
  const heights = [120, 120, 176, 190, 190, 176, 120, 176, 176, 210, 176, 134, 162];
  const html = buildFeedFixtureHtml({ query: 'brunch near me', cards: namedCards(13), endOfList: true })
    .replace('</head>', `<style>
      #feed { height: 842px; overflow-anchor: none; }
      .trail0 { height: 0; } .trail1 { height: 200px; }
      .end { height: 0; }
      ${heights.map((height, i) => `.card:nth-of-type(${3 + i * 2}) { height: ${height}px; }`).join('\n')}
    </style></head>`)
    .replace('</body>', `<script>
      let previousOffset = 0, jumped = false;
      document.getElementById('feed').addEventListener('scroll', event => {
        const list = event.currentTarget;
        const offset = list.scrollTop;
        if (${options.jumpToBottomOnce === true} && !jumped && offset > 658) {
          // Model a one-time browser scroll-anchor/layout movement after the intended scroll.
          jumped = true;
          list.scrollTop = 1545;
        } else if (${options.replaceOnRecovery === true} && jumped && offset < previousOffset) {
          const card = list.querySelectorAll('.card')[9];
          card.querySelector('a').setAttribute('aria-label', 'Reordered business');
          card.querySelector('.name').textContent = 'Reordered business';
        }
        previousOffset = list.scrollTop;
      });
    </script></body>`);
  const directory = await mkdtemp(join(tmpdir(), 'mkc-scroll-gap-'));
  const file = join(directory, 'feed.html');
  await writeFile(file, html, 'utf8');
  return pathToFileURL(file).toString();
}
