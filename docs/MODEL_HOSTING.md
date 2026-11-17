# Model hosting and deployment

## 1. Prepare the verified mirror

The manifest at `public/model-manifest.json` is generated from pinned upstream commits and includes exact byte sizes and SHA-256 hashes. Create a resumable local mirror with:

```powershell
npm run models:mirror
```

The output uses this immutable layout:

```text
.model-mirror/
  2026-11-17.2/
    stt/...
    tts/...
    llm/...
    model-manifest.json
```

The script skips files whose size and digest already match, writes new downloads to `.partial` files, and removes a partial file after failure.

## 2. Upload to R2

Create a private R2 bucket, upload the contents of `.model-mirror/`, and expose it through a read-only custom domain or an equivalent CDN origin. Keep old version directories during a deployment rollout. Never overwrite files inside an existing version directory.

An S3-compatible upload tool can sync the directory; credentials must be supplied through that tool's secure credential store, not committed to this repository.

## 3. Configure browser access

Use an R2 CORS policy equivalent to:

```json
[
  {
    "AllowedOrigins": [
      "https://YOUR-PAGES-PROJECT.pages.dev",
      "https://YOUR-CUSTOM-APP-DOMAIN"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

The model origin must return `Access-Control-Allow-Origin` for the app origin. Add `Cross-Origin-Resource-Policy: cross-origin` with a Cloudflare response-header transform rule or Worker. Serve correct MIME types and do not HTML-rewrite missing model paths.

Recommended cache policy for versioned files:

```text
Cache-Control: public, max-age=31536000, immutable
```

## 4. Point the build at the mirror

Set this Cloudflare Pages build environment variable:

```text
VITE_MODEL_BASE_URL=https://models.example.com
```

Do not add the manifest version to the value; the runtime appends `/<version>/<model>/<asset>`.

## 5. Deploy Pages

Connect the GitHub repository to Cloudflare Pages or use a direct upload:

```powershell
npm ci
npm run verify
npx wrangler pages deploy dist --project-name YOUR_PROJECT
```

Pages configuration:

- Build command: `npm run build`
- Output directory: `dist`
- Production branch: your protected release branch

## 6. Verify production headers and offline behavior

Confirm the application response includes:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Then use a fresh Chrome or Edge profile:

1. Open the production link and confirm the capability tier.
2. Download recommended models and wait for every integrity check to finish.
3. Reload and confirm no model redownload occurs.
4. Complete one typed turn, one push-to-talk turn, and one spoken patient response.
5. Switch the browser offline, reload the installed page, and repeat a cached encounter.
6. Use **Verify** on each model, then test removal and redownload on one model.

If any model origin header is missing, keep the app in compatibility mode until the origin is corrected; do not weaken the Pages isolation headers.
