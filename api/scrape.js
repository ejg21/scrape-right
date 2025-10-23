const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');

module.exports = async (req, res) => {
  // Allow all origins
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url, filter, clickSelector, origin: customOrigin, referer, iframe, wait, clearlocalstorage } = req.query;

  console.log(`Scraping url: ${url}`);

  if (!url) {
    return res.status(400).send('Please provide a URL parameter.');
  }

  const waitTime = wait ? parseFloat(wait) * 1000 : 0;
  const clearLS = clearlocalstorage === 'true';

  // More realistic User-Agent (Chrome on Windows) and matching client hints
  const realisticUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const clientHints = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'accept-language': 'en-US,en;q=0.5',
    'sec-gpc': '1',
    'upgrade-insecure-requests': '1',
    // Typical Sec-CH-UA values that don't reveal "HeadlessChrome"
    'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", "Not A;Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };

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
      userAgent: realisticUserAgent,
      // you can also set viewport / locale here if needed:
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
    });

    const page = await context.newPage();

    // Start with the client-hint headers above, add Origin/Referer if provided
    const headers = { ...clientHints };
    if (customOrigin) headers['Origin'] = customOrigin;
    if (referer) headers['Referer'] = referer;
    await page.setExtraHTTPHeaders(headers);

    let requests = [];

    await page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const reqUrl = request.url();

      // Block images, stylesheets, fonts, and common static extensions
      const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.css', '.woff', '.woff2', '.ttf', '.otf'];
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || blockedExtensions.some(ext => reqUrl.endsWith(ext))) {
        return route.abort();
      }

      // Block obvious tracking scripts
      if (reqUrl.includes('google-analytics') || reqUrl.includes('googletagmanager')) {
        return route.abort();
      }

      // Track requests that match filter (or all if no filter)
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
      await page.waitForTimeout(5000); // Wait for iframe to load
    } else {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
    }

    // Clear localStorage and reload if requested
    if (clearLS) {
      console.log('Clearing localStorage for this site...');
      // If iframe we must run on the frame; otherwise run on page
      if (pageOrFrame !== page) {
        await pageOrFrame.evaluate(() => localStorage.clear());
      } else {
        await page.evaluate(() => localStorage.clear());
      }
      console.log('Reloading page after clearing localStorage...');
      if (iframe) {
        // navigate the frame to the URL again
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
          // small wait for initialization (keeps your original behavior)
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (e) {
        console.log(`Could not find or click the element with selector "${clickSelector}".`, e);
      }
    }

    // Additional wait if provided
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
    if (browser) {
      await browser.close();
    }
    await chromium.fontconfig_clear();
    await chromium.cld_clear();
  }
};
