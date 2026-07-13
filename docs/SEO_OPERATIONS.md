# SEO operations

## Publishing

- Publish the complete article on Esports Community first.
- Share its public URL on X and Discord; the built-in actions add bounded UTM
  attribution while canonical URLs remain clean.
- Use translated mode only when each advertised translation is complete.
- Do not publish duplicate full articles on social platforms. Use a concise
  preview and link to the website article.

## Search discovery

- Submit `https://esportscommunity.net/sitemap.xml` to Google Search Console and
  Bing Webmaster Tools.
- English RSS: `https://esportscommunity.net/feed.xml`.
- Arabic RSS: `https://esportscommunity.net/feed-ar.xml`.
- IndexNow is optional. Enable `EWC_INDEXNOW_ENABLED` and configure a random
  `EWC_INDEXNOW_KEY`; verify `/indexnow/<key>.txt` before publishing. Do not
  publish or link that entropy-bearing verification URL.
- After a canonical or sitemap fix, request validation in Search Console. A
  redirect, intentional `noindex`, or private route exclusion is not an error.

## Cloudflare anonymous HTML cache

Create a Cache Rule for extensionless `GET`/`HEAD` HTML only when the request
has no cookies, query string, RSC header, or Next prefetch header. Exclude API,
Next assets, admin, login, and profile routes, including Arabic variants. Use
origin cache control, a 60-second edge TTL, and Cache Deception Armor. Never use
a blanket Cache Everything rule that ignores cookies.

Probe English and Arabic separately after deployment. The first anonymous
request should be a miss and the second a hit; cookie-bearing and private
requests must remain bypassed or dynamic.

## Reporting

The admin analytics dashboard reports privacy-safe acquisition categories and
bounded campaign tokens. It does not retain raw referrer URLs, destination
queries, or secret tokens. Review search traffic and article landing pages
monthly, then improve thin pages with useful original coverage rather than
generic filler.
