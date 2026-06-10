import client from './client';

export function fetchBlogPosts() {
  return client.get('/hub/blog-posts').then((res) => (Array.isArray(res.data.blog_posts) ? res.data.blog_posts : []));
}

export function fetchBlogPost(id) {
  return client.get(`/hub/blog-posts/${id}`).then((res) => res.data.blog_post);
}

export function createBlogPost(data) {
  return client.post('/hub/blog-posts', data).then((res) => res.data.blog_post);
}

export function updateBlogPost(id, data) {
  return client.put(`/hub/blog-posts/${id}`, data).then((res) => res.data.blog_post);
}

export function deleteBlogPost(id) {
  return client.delete(`/hub/blog-posts/${id}`).then((res) => res.data);
}

export function generateBlogIdeas() {
  return client.post('/hub/blog-posts/ai/ideas').then((res) => res.data.ideas);
}

export function generateBlogDraft(title) {
  return client.post('/hub/blog-posts/ai/draft', { title }).then((res) => res.data.content);
}

export function generateBlogImage(title, options = {}) {
  return client
    .post('/hub/blog-posts/ai/image', { title, ...options })
    .then((res) => res.data);
}

