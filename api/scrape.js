// api/scrape.js
const playwrightExtra = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth');
const chromiumPkg = require('@sparticuz/chromium'); // used for executablePath and helpers
const playwrightCore = require('playwright-core'); // fallback for types if needed

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // keep existing params + new ones
  const {
    url,
    filter,
    clickSelector,
    origin: customOrigin,
    referer,
    iframe,
    wait,
    clearlocalstorage,
    stealth,
    headful,
  } = req.query;

  if (!url) return res.status(400).send('Please provide a URL parameter.');

  const waitTime = wait ? parseFloat(wait) * 1000 : 0;
  const clearLS = clearlocalstorage === 'true';
  const useStealth = stealth === 'true';
  const isHeadful = headful === 'true';

  // enable stealth plugin only if requested
  if (useStealth) {
    playwrightExtra.use(StealthPlugin());
  }

  // realistic UA & client hints
  const realisticUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const clientHints = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.5',
    'sec-gpc': '1',
    'upgrade-insecure-requests': '1',
    'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", "Not A;Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

  let browser = null;
  try {
    // Launch using playwright-extra's chromium (it wraps playwright-core)
    // We still use sparticuz/chromium's executablePath to get a usable chromium in serverless env
    const chromium = playwrightExtra.chromium || playwrightExtra['chromium'];

    // If playwrightExtra.chromium isn't set (rare), fall back to playwright-core.chromium
    const launcherChromium = chromium || playwrightCore.chromium;

    browser = await launcherChromium.launch({
      args: [
        ...chromiumPkg.args,
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--single-process',
      ],
      executablePath: await chromiumPkg.executablePath(),
      headless: !isHeadful, // allow headful if requested
    });

    const context = await browser.newContext({
      userAgent: realisticUserAgent,
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
    });

    const page = await context.newPage();
    const headers = { ...clientHints };
    if (customOrigin) headers['Origin'] = customOrigin;
    if (referer) headers['Referer'] = referer;
    await page.setExtraHTTPHeaders(headers);

    let requests = [];

    await page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const reqUrl = request.url();

      const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.css', '.woff', '.woff2', '.ttf', '.otf'];
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || blockedExtensions.some(ext => reqUrl.endsWith(ext))) {
        return route.abort();
      }
      if (reqUrl.includes('google-analytics') || reqUrl.includes('googletagmanager')) {
        return route.abort();
      }

      if (!filter || (filter && reqUrl.includes(filter))) {
        requests.push({
          url: reqUrl,
          method: request.method(),
          headers: request.headers(),
        });
      }
      return route.continue();
    });

    let pageOrFrame = page;
    if (iframe) {
      await page.setContent(`<iframe src="${url}" style="width:100%; height:100vh;" frameBorder="0"></iframe>`);
      const iframeElement = await page.waitForSelector('iframe');
      pageOrFrame = await iframeElement.contentFrame();
      await page.waitForTimeout(5000);
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    // Clear localStorage and reload if requested
    if (clearLS) {
      console.log('Clearing localStorage for this site...');
      if (pageOrFrame !== page) {
        await pageOrFrame.evaluate(() => localStorage.clear());
      } else {
        await page.evaluate(() => localStorage.clear());
      }
      console.log('Reloading page after clearing localStorage...');
      if (iframe) {
        await pageOrFrame.goto(url, { waitUntil: 'domcontentloaded' });
      } else {
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
    }

    // Click selector (works on frame if pageOrFrame is a frame)
    if (clickSelector) {
      try {
        const element = await pageOrFrame.waitForSelector(clickSelector, { timeout: 5000 });
        if (element) {
          await element.click();
          console.log(`Clicked element with selector: ${clickSelector}`);
          await page.waitForTimeout(5000);
        }
      } catch (e) {
        console.log(`Could not find or click the element with selector "${clickSelector}".`, e);
      }
    }

    // Extra wait if provided
    if (waitTime > 0) {
      console.log(`Waiting for ${waitTime / 1000} seconds before returning requests...`);
      await page.waitForTimeout(waitTime);
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      message: `Successfully scraped ${url}`,
      requests,
      meta: {
        stealthEnabled: useStealth,
        headful: isHeadful,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).send(`An error occurred while scraping the page: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    await chromiumPkg.fontconfig_clear();
    await chromiumPkg.cld_clear();
  }
};
