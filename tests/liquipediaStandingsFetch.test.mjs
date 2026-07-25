import assert from 'node:assert/strict';
import test from 'node:test';
import * as cheerio from 'cheerio';

process.env.DISCORD_TOKEN = 'test-token';
process.env.DISCORD_CLIENT_ID = 'test-client-id';

const { fetchEventStandings } = await import('../src/services/liquipedia/fetchers.js');

test('standings fetch reuses its loaded page for battle-royale detail snapshots', async () => {
  const $ = cheerio.load(`
    <div class="panel-content">
      <div class="standings-ffa-detail">Grand Final</div>
      <div class="panel-content__game-schedule">
        <div class="panel-content__game-schedule__list-item">
          <div class="panel-content__game-schedule__title">Game 1</div>
          <span data-timestamp="1784986800"></span>
        </div>
      </div>
      <div class="panel-table">
        <div class="panel-table__row row--header"></div>
        <div class="panel-table__row">
          <div class="cell--rank" data-sort-val="1"></div>
          <div class="cell--team" data-sort-val="Team Alpha"></div>
          <div class="cell--total-points" data-sort-val="15"></div>
          <div class="panel-table__cell cell--game">
            <div class="panel-table__cell__game-placement" data-sort-val="1">1</div>
            <div class="panel-table__cell__game-kills" data-sort-val="5">5</div>
          </div>
        </div>
      </div>
    </div>
  `);
  let loads = 0;
  const result = await fetchEventStandings(
    { external_id: 'pubg/Esports_World_Cup/2026' },
    {
      loadPage: async () => {
        loads += 1;
        return { $ };
      },
    },
  );

  assert.equal(loads, 1);
  assert.equal(result.detailMatches.length, 1);
  assert.equal(result.detailMatches[0].details.entries[0].points, 15);
});
