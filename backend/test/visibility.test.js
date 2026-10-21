import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp } from './helpers/harness.js';

// admin is registered first (→ admin); A and B are ordinary users
let t, admin, A, B, session, book;
before(async () => {
  t = await bootApp();
  admin = await t.createUser('root');
  A = await t.createUser('alice');
  B = await t.createUser('bob');
  book = await t.addBook(A, { title: 'Alice Reads' });
  session = await t.addFinishedSession(A, book.book_id, { review: 'secret thoughts', rating: 5 });
});
after(async () => { await t.close(); });

const unreadFor = async user => (await user.agent.get('/api/notifications/unread-count')).body.count;

describe('profile visibility', () => {
  it('public by default: everybody sees A', async () => {
    assert.equal((await t.anon().get('/api/profiles/alice')).status, 200);
    assert.equal((await B.agent.get('/api/profiles/alice')).status, 200);
    const feed = await t.anon().get('/api/feed');
    assert.ok(feed.body.some(r => r.username === 'alice'));
    const users = await B.agent.get('/api/users');
    assert.ok(users.body.some(u => u.username === 'alice'));
  });

  it('A sets isPublic:false', async () => {
    const res = await A.agent.patch('/api/auth/me').send({ isPublic: false });
    assert.equal(res.status, 200);
    assert.equal(res.body.isPublic, false);
  });

  it('GET /api/profiles/A → 404 for B and anonymous, 200 for A and an admin', async () => {
    assert.equal((await t.anon().get('/api/profiles/alice')).status, 404);
    assert.equal((await B.agent.get('/api/profiles/alice')).status, 404);
    assert.equal((await A.agent.get('/api/profiles/alice')).status, 200);
    assert.equal((await admin.agent.get('/api/profiles/alice')).status, 200);
    // sub-resources are hidden too
    for (const sub of ['shelf', 'followers', 'following']) {
      assert.equal((await t.anon().get(`/api/profiles/alice/${sub}`)).status, 404, sub);
      assert.equal((await B.agent.get(`/api/profiles/alice/${sub}`)).status, 404, sub);
      assert.equal((await A.agent.get(`/api/profiles/alice/${sub}`)).status, 200, sub);
    }
  });

  it('A\'s sessions are absent from /api/feed for B and anonymous (present for A and admin)', async () => {
    for (const who of [t.anon(), B.agent]) {
      const feed = await who.get('/api/feed');
      assert.equal(feed.status, 200);
      assert.ok(!feed.body.some(r => r.username === 'alice'));
    }
    for (const who of [A.agent, admin.agent]) {
      const feed = await who.get('/api/feed');
      assert.ok(feed.body.some(r => r.username === 'alice'), 'owner / admin still see it');
    }
  });

  it('A is absent from /api/users for B and anonymous', async () => {
    const asB = await B.agent.get('/api/users');
    assert.ok(!asB.body.some(u => u.username === 'alice'));
    const anon = await t.anon().get('/api/users');
    assert.ok(!anon.body.some(u => u.username === 'alice'));
    assert.ok(anon.body.every(u => !('follows_you' in u)), 'anonymous rows keep the original shape');
    assert.ok((await A.agent.get('/api/users')).body.some(u => u.username === 'alice'));
    assert.ok((await admin.agent.get('/api/users')).body.some(u => u.username === 'alice'));
  });

  it('B liking / commenting on A\'s session → 404; comment list is hidden too', async () => {
    assert.equal((await B.agent.post(`/api/sessions/${session.id}/like`)).status, 404);
    assert.equal((await B.agent.delete(`/api/sessions/${session.id}/like`)).status, 404);
    assert.equal((await B.agent.post(`/api/sessions/${session.id}/comments`).send({ body: 'hi' })).status, 404);
    assert.equal((await B.agent.get(`/api/sessions/${session.id}/comments`)).status, 404);
    assert.equal((await t.anon().get(`/api/sessions/${session.id}/comments`)).status, 404);
    assert.equal((await A.agent.get(`/api/sessions/${session.id}/comments`)).status, 200);
    assert.equal(await unreadFor(A), 0, 'no notification leaked from the rejected attempts');
  });

  it('B cannot follow or look up A', async () => {
    assert.equal((await B.agent.post('/api/follows/alice')).status, 404);
    assert.equal((await B.agent.get('/api/follows/status?username=alice')).status, 404);
  });

  it('follower/following lists hide private users from others', async () => {
    // A follows B while private; B's followers list hides A for strangers but shows A to A
    assert.equal((await A.agent.post('/api/follows/bob')).status, 204);
    const asAnon = await t.anon().get('/api/profiles/bob/followers');
    assert.deepEqual(asAnon.body, []);
    const asA = await A.agent.get('/api/profiles/bob/followers');
    assert.deepEqual(asA.body.map(u => u.username), ['alice']);
    const bobProfile = await t.anon().get('/api/profiles/bob');
    assert.equal(bobProfile.body.followerCount, 0);
    const asAdmin = await admin.agent.get('/api/profiles/bob');
    assert.equal(asAdmin.body.followerCount, 1);
  });

  it('flipping A back to public restores everything', async () => {
    await A.agent.patch('/api/auth/me').send({ isPublic: true });
    assert.equal((await t.anon().get('/api/profiles/alice')).status, 200);
    assert.ok((await t.anon().get('/api/feed')).body.some(r => r.username === 'alice'));
    assert.equal((await B.agent.post(`/api/sessions/${session.id}/like`)).status, 200);
  });
});

describe('notifications', () => {
  it('B likes, unlikes, likes A\'s session → exactly one unread notification for A', async () => {
    // start from a clean slate for A
    await A.agent.post('/api/notifications/read-all');
    await B.agent.delete(`/api/sessions/${session.id}/like`);
    await t.query('DELETE FROM notifications WHERE user_id = $1', [A.id]);

    const like1 = await B.agent.post(`/api/sessions/${session.id}/like`);
    assert.equal(like1.status, 200);
    assert.equal(like1.body.likeCount, 1);
    assert.equal((await B.agent.delete(`/api/sessions/${session.id}/like`)).body.likeCount, 0);
    assert.equal((await B.agent.post(`/api/sessions/${session.id}/like`)).body.likeCount, 1);

    assert.equal(await unreadFor(A), 1);
    const list = await A.agent.get('/api/notifications');
    const likes = list.body.filter(n => n.type === 'like');
    assert.equal(likes.length, 1);
    assert.equal(likes[0].actor_username, 'bob');
    assert.equal(likes[0].payload.title, 'Alice Reads');
    assert.equal(String(likes[0].payload.bookId), String(session.book_id), 'like links to the book');
    assert.equal(likes[0].payload.sessionId, session.id);
    assert.equal(likes[0].read_at, null);
  });

  it('after A reads it, a fresh like notifies again', async () => {
    await A.agent.post('/api/notifications/read-all');
    assert.equal(await unreadFor(A), 0);
    await B.agent.delete(`/api/sessions/${session.id}/like`);
    await B.agent.post(`/api/sessions/${session.id}/like`);
    assert.equal(await unreadFor(A), 1);
  });

  it('you never notify yourself', async () => {
    await t.query('DELETE FROM notifications WHERE user_id = $1', [A.id]);
    assert.equal((await A.agent.post(`/api/sessions/${session.id}/like`)).status, 200);
    assert.equal(await unreadFor(A), 0);
  });

  it('different targets are not collapsed together', async () => {
    const book2 = await t.addBook(A, { title: 'Second Book' });
    const session2 = await t.addFinishedSession(A, book2.book_id, { review: 'more' });
    await t.query('DELETE FROM notifications WHERE user_id = $1', [A.id]);
    await B.agent.post(`/api/sessions/${session.id}/like`);
    await B.agent.post(`/api/sessions/${session2.id}/like`);
    assert.equal(await unreadFor(A), 2);
  });

  it('session comments collapse while unread; follows dedupe across follow/unfollow toggling', async () => {
    await t.query('DELETE FROM notifications WHERE user_id = $1', [A.id]);
    for (let i = 0; i < 3; i++) {
      const res = await B.agent.post(`/api/sessions/${session.id}/comments`).send({ body: `comment ${i}` });
      assert.equal(res.status, 201);
    }
    const comments = (await A.agent.get('/api/notifications')).body.filter(n => n.type === 'session_comment');
    assert.equal(comments.length, 1);
    assert.equal(String(comments[0].payload.bookId), String(session.book_id), 'session_comment links to the book');
    assert.equal(comments[0].payload.title, 'Alice Reads');
    assert.equal(comments[0].payload.sessionId, session.id);

    for (let i = 0; i < 3; i++) {
      assert.equal((await B.agent.post('/api/follows/alice')).status, 204);
      assert.equal((await B.agent.delete('/api/follows/alice')).status, 204);
    }
    const follows = (await A.agent.get('/api/notifications')).body.filter(n => n.type === 'follow');
    assert.equal(follows.length, 1);
  });

  it('mentions in a review notify the mentioned user once per book', async () => {
    await t.query('DELETE FROM notifications WHERE user_id = $1', [B.id]);
    for (const review of ['hey @bob!', 'again @bob']) {
      const res = await A.agent.post(`/api/books/${book.book_id}/sessions`).send({ review });
      assert.equal(res.status, 201);
    }
    // mentions are fired without awaiting; give them a moment
    for (let i = 0; i < 50 && (await unreadFor(B)) === 0; i++) await new Promise(r => setTimeout(r, 20));
    await new Promise(r => setTimeout(r, 100));
    const mentions = (await B.agent.get('/api/notifications')).body.filter(n => n.type === 'mention');
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0].actor_username, 'alice');
  });

  it('mark one as read; other users cannot mark mine', async () => {
    const [n] = (await B.agent.get('/api/notifications')).body.filter(x => x.read_at === null);
    assert.equal((await A.agent.post(`/api/notifications/${n.id}/read`)).status, 204);
    assert.equal((await B.agent.get('/api/notifications')).body.find(x => x.id === n.id).read_at, null);
    assert.equal((await B.agent.post(`/api/notifications/${n.id}/read`)).status, 204);
    assert.notEqual((await B.agent.get('/api/notifications')).body.find(x => x.id === n.id).read_at, null);
  });
});
