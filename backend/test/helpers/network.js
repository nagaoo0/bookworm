// Outbound HTTP stub. Tests never touch the network: every fetch (the global
// one used by lib/safeUrl.js, and the `node-fetch` import used by the book
// providers and reCAPTCHA) goes through one dispatcher that either matches a
// registered route or fails loudly.

export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

export function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' }, ...init,
  });
}

export function createNetwork() {
  const routes = [];
  const calls = [];

  async function dispatch(input, init) {
    const url = typeof input === 'string' ? input : (input?.href ?? input?.url ?? String(input));
    calls.push({ url, init });
    for (let i = routes.length - 1; i >= 0; i--) { // newest route wins
      const r = routes[i];
      if (r.match instanceof RegExp ? r.match.test(url) : url.startsWith(r.match)) {
        return typeof r.respond === 'function' ? r.respond(url, init) : r.respond.clone();
      }
    }
    throw new Error(`Unexpected outbound request in test: ${url}`);
  }

  return {
    dispatch,
    calls,
    /** Register a response (a Response, or (url, init) => Response) for urls matching a prefix/RegExp. */
    on(match, respond) { routes.push({ match, respond }); },
    reset() { routes.length = 0; calls.length = 0; },
    callsTo(match) {
      return calls.filter(c => (match instanceof RegExp ? match.test(c.url) : c.url.startsWith(match)));
    },
  };
}

// A Google Books volume payload, as returned by GET /books/v1/volumes/:id
export function googleVolume(id, { title, authors = ['Some Author'], pages = 321, thumbnail } = {}) {
  return {
    id,
    volumeInfo: {
      title, authors, pageCount: pages, publishedDate: '2001-02-03',
      description: `Description of ${title}`, categories: ['Fiction'],
      industryIdentifiers: [],
      imageLinks: thumbnail ? { thumbnail } : undefined,
    },
  };
}
