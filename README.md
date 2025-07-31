# Scrape-Right

A powerful, serverless web scraper built with Playwright and deployed on Vercel.

## Features

- **Headless Browser:** Uses a full Chromium browser to render pages, enabling the scraping of modern, JavaScript-heavy websites.
- **Interactive:** Can be configured to click elements on the page (like "Play" buttons) to trigger dynamic content.
- **Optimized:** Blocks unnecessary resources like images, stylesheets, and tracking scripts to improve speed and reduce data usage.
- **Configurable:** All key parameters can be controlled through the request URL.
- **CORS Control:** A configurable whitelist allows you to control which websites can access the scraper.

## Getting Started

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/AykhanUV/scrape-right.git
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Deploy to Vercel:**
    Connect your repository to a new project on Vercel. The Vercel CLI is also configured for easy deployment with `npm run deploy`.

## API Documentation

The scraper is accessed via a single GET endpoint: `/api/scrape`.

### Parameters

| Parameter       | Type     | Description                                                                                                                                 |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`           | `string` | **Required.** The full URL of the website you want to scrape.                                                                                 |
| `filter`        | `string` | **Optional.** A string to filter the results by. Only network requests whose URLs contain this string will be returned.                       |
| `clickSelector` | `string` | **Optional.** A CSS selector for an element you want the scraper to click. Useful for triggering dynamic content like video players.         |
| `origin`        | `string` | **Optional.** A string to set the `Origin` header for all requests made by the page.                                                       |
| `referer`       | `string` | **Optional.** A string to set the `Referer` header for all requests made by the page.                                                       |
| `resolveRedirect` | `boolean` | **Optional.** If set to `true`, the function will only return the final URL after all redirects. The `filter` and `clickSelector` parameters will be ignored. |
| `getIframeSrc`    | `boolean` | **Optional.** If set to `true`, the function will find the first `<iframe>` on the page and return its `src` attribute. All other scraping logic will be ignored. |

### Example Usage

Here is an example of how to use the API with `curl` to find an `.m3u8` file on a specific page:

```bash
curl "https://your-deployment-url.vercel.app/api/scrape?url=https://player.videasy.net/movie/557&clickSelector=.play-icon-main&filter=.m3u8"
```

### CORS Configuration

This API is configured with an open CORS policy (`Access-Control-Allow-Origin: *`), which allows it to be called from any website.