const { chromium } = require('playwright');

const ALLOWED_STORES = ['G2A', 'Kinguin', 'Eneba', 'GAMIVO', 'K4G'];

function titleToSlug(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function generateSlugs(title) {
  const base = title.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  const candidates = new Set();

  // 1. Full title, keep only a-z0-9 spaces and hyphens
  const full = base.replace(/[^a-z0-9\s-]/g, '').trim();
  if (full) candidates.add(full.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

  // 2. Remove everything after colon or em-dash/en-dash (but NOT regular hyphen)
  const main = base.replace(/[:\u2013\u2014].*$/, '').replace(/[^a-z0-9\s-]/g, '').trim();
  if (main && main !== full) candidates.add(main.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

  // 3. Remove apostrophe-s (tom clancy's -> tom clancys -> tom clancy)
  const noApos = base.replace(/['\u2019]s\b/g, 's').replace(/[^a-z0-9\s-]/g, '').trim();
  if (noApos && noApos !== full) candidates.add(noApos.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

  // 4. Also try with ampersand replaced by "and"
  const amp = base.replace(/&/g, 'and').replace(/[^a-z0-9\s-]/g, '').trim();
  if (amp && amp !== full) candidates.add(amp.replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''));

  return [...candidates];
}

async function tryUrl(page, url) {
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    if (resp.status() === 404) return null;
    await page.waitForTimeout(4000);

    const result = await page.evaluate(() => {
      if (typeof jQuery === 'undefined' || !jQuery.fn.DataTable) return null;
      const dt = jQuery('#offerTable').DataTable();
      const data = dt.data().toArray();
      return Array.isArray(data) ? data : null;
    });

    if (result && result.length > 0) return result;
    return null;
  } catch {
    return null;
  }
}

async function scrapeAllKeyShop(gameTitle) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    const page = await context.newPage();

    const slugs = generateSlugs(gameTitle);
    let allOffers = null;

    for (const slug of slugs) {
      const url = `https://www.allkeyshop.com/blog/buy-${slug}-cd-key-compare-prices/`;
      allOffers = await tryUrl(page, url);
      if (allOffers) break;
    }

    await browser.close();

    if (!allOffers) return [];

    const platformMap = { steam: 'Steam', gog: 'GOG', 'epic-games': 'Epic', xbox: 'Xbox', playstation: 'PlayStation', nintendo: 'Nintendo' };

    return allOffers
      .filter(o => !o.account && o.dispo > 0 && ALLOWED_STORES.includes(o.merchantName))
      .map(o => ({
        shop: o.merchantName,
        priceEUR: o.price,
        platform: platformMap[o.activationPlatform] || o.activationPlatform,
        region: o.region,
        edition: o.edition,
        voucher: o.voucher_code || null,
        voucherDiscount: o.voucher_discount_value
          ? (o.voucher_discount_type === '%' ? `${o.voucher_discount_value}%` : `${o.voucher_discount_value}`)
          : null,
        originalPriceEUR: o.originalPrice,
        url: `https://www.allkeyshop.com/redirection/offer/eur/${o.id}?locale=en&merchant=${o.merchant}`,
        type: 'grey',
      }));
  } catch (error) {
    console.error('AllKeyShop scrape error:', error.message);
    if (browser) await browser.close().catch(() => {});
    return [];
  }
}

module.exports = { scrapeAllKeyShop, titleToSlug, generateSlugs };
