import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Audible unofficial API client
// Implements the same device-registration OAuth flow as the audible Python lib
// ---------------------------------------------------------------------------

const MARKETPLACES = {
  us: { tld: 'com',    locale: 'en_US' },
  uk: { tld: 'co.uk',  locale: 'en_GB' },
  de: { tld: 'de',     locale: 'de_DE' },
  fr: { tld: 'fr',     locale: 'fr_FR' },
  ca: { tld: 'ca',     locale: 'en_CA' },
  au: { tld: 'com.au', locale: 'en_AU' },
  jp: { tld: 'co.jp',  locale: 'ja_JP' },
  in: { tld: 'in',     locale: 'en_IN' },
  es: { tld: 'es',     locale: 'es_ES' },
  it: { tld: 'it',     locale: 'it_IT' },
  br: { tld: 'com.br', locale: 'pt_BR' },
};

function getMarket(marketplace) {
  const m = MARKETPLACES[marketplace];
  if (!m) throw new Error(`Unknown Audible marketplace: ${marketplace}`);
  return m;
}

// PKCE helpers
export function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildAuthUrl(marketplace, redirectUri, pkce) {
  const { tld } = getMarket(marketplace);
  const params = new URLSearchParams({
    openid_ns: 'http://specs.openid.net/auth/2.0',
    openid_identity: 'http://specs.openid.net/auth/2.0/identifier_select',
    openid_claimed_id: 'http://specs.openid.net/auth/2.0/identifier_select',
    openid_mode: 'checkid_setup',
    openid_return_to: redirectUri,
    openid_assoc_handle: `amzn_audible_ios_${marketplace}`,
    openid_ns_pape: 'http://specs.openid.net/extensions/pape/1.0',
    openid_pape_max_auth_age: '0',
    openid_ns_oa2: 'http://www.amazon.com/ap/ext/oauth/2',
    openid_oa2_application_name: 'audible',
    openid_oa2_client_id: 'device:6a52316c62706d53427a5735505a76477a45375959566674327959465a6374424a53497069546d45234132435a4a5a474c4b324a4a564d',
    openid_oa2_scope: 'device_auth_access',
    openid_oa2_response_type: 'code',
    openid_oa2_code_challenge_method: 'S256',
    openid_oa2_code_challenge: pkce.challenge,
  });
  return `https://www.amazon.${tld}/ap/signin?${params}`;
}

// Exchange the auth code from Amazon's redirect for tokens
export async function exchangeCode(code, verifier, marketplace, redirectUri) {
  const { tld } = getMarket(marketplace);
  const body = new URLSearchParams({
    app_name: 'Audible',
    app_version: '3.56.2',
    source_token: code,
    requested_token_type: 'access_token',
    source_token_type: 'authorization_code',
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`https://api.amazon.${tld}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Audible token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function refreshTokens(config) {
  const { tld } = getMarket(config.marketplace);
  const body = new URLSearchParams({
    app_name: 'Audible',
    app_version: '3.56.2',
    source_token: config.refreshToken,
    requested_token_type: 'access_token',
    source_token_type: 'refresh_token',
  });

  const res = await fetch(`https://api.amazon.${tld}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) throw new Error(`Audible token refresh failed: ${res.status}`);
  return res.json();
}

function audibleHeaders(config) {
  return {
    Authorization: `Bearer ${config.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Audible/671 CFNetwork/1240.0.4 Darwin/20.6.0',
  };
}

async function audibleGet(config, path, params = {}) {
  const { tld } = getMarket(config.marketplace);
  const url = new URL(`https://api.audible.${tld}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: audibleHeaders(config) });
  if (res.status === 401) throw new Error('AUDIBLE_AUTH_EXPIRED');
  if (!res.ok) throw new Error(`Audible ${path} → ${res.status}`);
  return res.json();
}

export async function fetchLibrary(config) {
  const PAGE_SIZE = 1000;
  let page = 1;
  const all = [];

  while (true) {
    const data = await audibleGet(config, '/1.0/library', {
      response_groups: 'product_attrs,media,series,relationships',
      num_results: PAGE_SIZE,
      page,
    });
    const items = data.items ?? [];
    all.push(...items);
    if (items.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

export async function fetchWishlist(config) {
  try {
    const data = await audibleGet(config, '/1.0/wishlist', {
      response_groups: 'product_attrs,media',
      num_results: 999,
    });
    return (data.products ?? []).map(p => ({ ...p, _isWishlist: true }));
  } catch {
    return [];
  }
}

export function mapItemToBook(item) {
  const authors = (item.authors ?? []).map(a => a.name);
  const narrators = (item.narrators ?? []).map(n => n.name).join(', ');

  return {
    title: item.title,
    authors,
    isbn13: item.isbn ?? null,
    cover_url: item.product_images?.['500'] ?? item.product_images?.['1024'] ?? null,
    _audibleItem: item,
    extra: {
      asin: item.asin ?? null,
      narrator: narrators || null,
      duration_minutes: item.runtime_length_min ?? null,
      series: item.series?.[0]?.title ?? null,
      publisher: item.publisher_name ?? null,
      is_wishlist: item._isWishlist ?? false,
      rating: item.rating?.overall_distribution?.average_rating ?? null,
    },
  };
}
