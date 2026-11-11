export const platforms = ['Instagram', 'TikTok', 'Facebook'];
export const statusNames = { draft: 'Draft', planned: 'Planned', published: 'Published' };

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function seedState(now = new Date()) {
  const dateAt = (offset) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    return `${localDate(date)}T11:00`;
  };
  return {
    media: [
      { id: 'celestial', name: 'Cherry, with a little magic', url: '/images/cherry-celestial.png', type: 'image/png', consent: 'unknown', sample: true },
      { id: 'ruby', name: 'The ruby cat-eye', url: '/images/ruby-cat-eye.jpg', type: 'image/jpeg', consent: 'unknown', sample: true },
    ],
    posts: [
      { id: 'post-1', title: 'A little cherry magic', caption: 'Deep cherry, delicate stars, and all the little details. A Russian manicure made to be admired up close.', hashtags: '#RussianManicure #CherryNails #NailArt', mediaId: 'celestial', platforms: ['Instagram'], variations: {}, status: 'planned', date: dateAt(1), approval: 'pending', sample: true },
      { id: 'post-2', title: 'Your next signature shade', caption: 'Meet your new favorite red. A velvet ruby cat-eye that catches the light from every angle.', hashtags: '#CatEyeNails #RubyNails #ManicureInspo', mediaId: 'ruby', platforms: ['Instagram', 'TikTok'], variations: {}, status: 'planned', date: dateAt(3), approval: 'not-required', sample: true },
      { id: 'post-3', title: 'The details make the difference', caption: 'Beautiful nails start with thoughtful prep. Clean lines, precise cuticle work, and a finish that feels like you.', hashtags: '#RussianManicure #NailDetails', mediaId: 'celestial', platforms: ['Instagram'], variations: {}, status: 'draft', date: '', approval: 'not-required', sample: true },
      { id: 'post-4', title: 'Ruby red, forever a favorite', caption: 'Some shades never need an introduction. Save this ruby red for your next appointment.', hashtags: '#RedNails #NailInspo', mediaId: 'ruby', platforms: ['Facebook'], variations: {}, status: 'draft', date: '', approval: 'not-required', sample: true },
    ],
    hashtags: '#RussianManicure #NailArt #ManicureInspo',
  };
}

export function validatePost(post, media) {
  if (!post.title.trim()) return 'Give your post a title.';
  if (!post.caption.trim()) return 'Add a caption before saving.';
  if (!post.platforms.length) return 'Choose at least one platform.';
  if (post.status === 'planned' && (!post.date || !Number.isFinite(new Date(post.date).getTime()))) return 'Choose a valid date and time for your planned post.';
  if (post.status === 'published') {
    if (!post.publishedUrl || !/^https?:\/\/\S+$/i.test(post.publishedUrl)) return 'Add the live post URL to confirm publication.';
    if (post.approval === 'pending') return 'Mya needs to approve this post before you confirm publication.';
    if (post.mediaId && media.find((item) => item.id === post.mediaId)?.consent !== 'approved') return 'Confirm client permission for the selected media first.';
  }
  return '';
}

export function captionFor(post, platform) {
  return [post.variations?.[platform] || post.caption, post.hashtags].filter(Boolean).join('\n\n');
}
