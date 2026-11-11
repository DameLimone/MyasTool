import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, localDate, validatePost, captionFor } from './model.js';

test('sample posts never imply published content or approved client consent', () => {
  const state = seedState(new Date(2026, 10, 9));
  assert.equal(state.posts.filter((post) => post.status === 'published').length, 0);
  assert.ok(state.posts.every((post) => post.sample));
  assert.ok(state.media.every((media) => media.consent === 'unknown'));
  assert.equal(state.posts[0].date, '2026-11-10T11:00');
});
test('local dates preserve local calendar boundaries', () => {
  assert.equal(localDate(new Date(2026, 0, 2, 0, 1)), '2026-01-02');
});
test('post validation requires a caption, title, platforms and valid planned date', () => {
  const { posts, media } = seedState();
  const post = posts[0];
  assert.equal(validatePost(post, media), '');
  for (const change of [{ title: ' ' }, { caption: '' }, { platforms: [] }, { date: '' }, { date: 'not-a-date' }]) {
    assert.ok(validatePost({ ...post, ...change }, media));
  }
});
test('publication needs a live URL, approval and client permission', () => {
  const { posts, media } = seedState();
  const post = { ...posts[0], status: 'published' };
  assert.match(validatePost(post, media), /URL/);
  post.publishedUrl = 'javascript:alert(1)';
  assert.match(validatePost(post, media), /URL/);
  post.publishedUrl = 'https://www.instagram.com/p/example';
  assert.match(validatePost(post, media), /approve/);
  post.approval = 'approved';
  assert.match(validatePost(post, media), /permission/);
  const approvedMedia = media.map((item) => ({ ...item, consent: 'approved' }));
  assert.equal(validatePost(post, approvedMedia), '');
  assert.match(validatePost(post, media.map((item) => ({ ...item, consent: 'declined' }))), /permission/);
});
test('manual sharing uses platform variations and shared hashtags', () => {
  const post = { caption: 'Original caption', hashtags: '#Nails', variations: { TikTok: 'A little shimmer' } };
  assert.equal(captionFor(post, 'TikTok'), 'A little shimmer\n\n#Nails');
  assert.equal(captionFor(post, 'Instagram'), 'Original caption\n\n#Nails');
});
