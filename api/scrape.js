const playwright = require('playwright-core');
const chromium = require('@sparticuz/chromium');

module.exports = async (req, res) => {
  // Allow all origins
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { url, filter, clickSelector } = req.query;

  console.log(`Scraping url: ${url}`);

  if (!url) {
    return res.status(400).send('Please provide a URL parameter.');
  }

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
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.5',
      'Sec-GPC': '1',
    });
    let requests = [];

    await page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();

      // Block images, stylesheets, and fonts by resource type and file extension
      const blockedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.css', '.woff', '.woff2', '.ttf', '.otf'];
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || blockedExtensions.some(ext => url.endsWith(ext))) {
        return route.abort();
      }

      // Block tracking scripts
      if (url.includes('google-analytics') || url.includes('googletagmanager')) {
        return route.abort();
      }

      // Allow everything else
      if (!filter || (filter && url.includes(filter))) {
        requests.push({
          url: url,
          method: request.method(),
          headers: request.headers(),
        });
      }
      return route.continue();
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // If a clickSelector is provided, try to click it
    if (clickSelector) {
      try {
        const element = await page.waitForSelector(clickSelector, { timeout: 5000 });
        if (element) {
          await element.click();
          console.log(`Clicked element with selector: ${clickSelector}`);
          // Wait for a few seconds for the video to initialize
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (e) {
        console.log(`Could not find or click the element with selector "${clickSelector}".`, e);
      }
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
    // Clean up the temporary files
    await chromium.fontconfig_clear();
    await chromium.cld_clear();
  }
};