const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url, filter, clickSelector, origin: customOrigin, referer, iframe, wait, clearlocalstorage } = req.query;

  console.log(`Scraping url: ${url}`);

  if (!url) {
    return res.status(400).send('Please provide a URL parameter.');
  }

  const waitTime = wait ? parseFloat(wait) * 1000 : 0;
  const clearLS = clearlocalstorage === 'true';

  let browser = null;
  try {
    browser = await playwright.chromium.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--single-process',
      ],
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
    });

    const page = await context.newPage();
    const headers = {
      'Accept-Language': 'en-US,en;q=0.5',
      'Sec-GPC': '1',
    };
    if (customOrigin) headers['Origin'] = customOrigin;
    if (referer) headers['Referer'] = referer;
    await page.setExtraHTTPHeaders(headers);

    let requests = [];

    await page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();

      const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.css', '.woff', '.woff2', '.ttf', '.otf'];
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || blockedExtensions.some(ext => url.endsWith(ext))) {
        return route.abort();
      }
      if (url.includes('google-analytics') || url.includes('googletagmanager')) {
        return route.abort();
      }

      if (!filter || (filter && url.includes(filter))) {
        requests.push({
          url: url,
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
      await page.evaluate(() => localStorage.clear());
      console.log('Reloading page after clearing localStorage...');
      if (iframe) {
        await pageOrFrame.goto(url, { waitUntil: 'domcontentloaded' });
      } else {
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
    }

    // Click element if selector provided
    if (clickSelector) {
      try {
        const element = await pageOrFrame.waitForSelector(clickSelector, { timeout: 5000 });
        if (element) {
          await element.click();
          console.log(`Clicked element with selector: ${clickSelector}`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (e) {
        console.log(`Could not find or click the element with selector "${clickSelector}".`, e);
      }
    }

    if (waitTime > 0) {
      console.log(`Waiting for ${waitTime / 1000} seconds before returning requests...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    res.status(200).json({
      message: `Successfully scraped ${url}`,
      requests,
    });
  } catch (error) {
    console.error(error);
    res.status(500).send(`An error occurred while scraping the page: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    await chromium.fontconfig_clear();
    await chromium.cld_clear();
  }
};
