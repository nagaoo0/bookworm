// Calendar dates (Postgres DATE) must round-trip as the same 'YYYY-MM-DD' day,
// whatever the time zone of the machine running the API.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

let t;
before(async () => { t = await bootApp(); });
after(async () => { await t?.close(); });

describe('DATE columns', () => {
  it('challenge start/end dates come back as the exact day sent', async () => {
    const alice = await t.createUser('datealice');
    const res = await alice.agent.post('/api/challenges').send({
      title: 'Calendar year', startDate: '2026-01-01', endDate: '2026-12-31',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.start_date, '2026-01-01');
    assert.equal(res.body.end_date, '2026-12-31');

    const list = await alice.agent.get('/api/challenges');
    const c = list.body.find(x => x.id === res.body.id);
    assert.equal(c.start_date, '2026-01-01');
    assert.equal(c.end_date, '2026-12-31');
  });
});
