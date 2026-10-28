# NODE share server

Stores shared trails for share links (B82 phase 2, `docs/19-trail-sharing.md`). A Cloudflare Worker with one R2 bucket.

NODE encrypts the trail on the sender's computer (AES-256-GCM, `core/share-link.js`) and uploads only the encrypted bytes. The key is in the link after `#`, which browsers never send to a server, so this server cannot read what it stores.

| Address | What it does |
| --- | --- |
| `POST /api/trails` | Stores an encrypted trail (at most 1 MB; NODE's format only). Returns an id, a delete key and the expiry date. At most 10 a minute from one network address |
| `GET /api/trails/<id>` | The encrypted trail, for NODE |
| `DELETE /api/trails/<id>` | Removes it, with the delete key (Stop Sharing in NODE) |
| `GET /t/<id>` | A page that decrypts the trail in the browser and shows it, with Open in NODE and Download NODE |

Links look like `https://noderesearch.app/t/<id>#k=<key>`. The website (Vercel, `site/vercel.json`) passes `/t/…` to this Worker. NODE talks to the Worker directly at its workers.dev address (`core/share-link.js` → `API_BASE`).

Trails are deleted after 30 days: by an R2 lifecycle rule, and the Worker refuses anything older in case the rule runs late. The server keeps no names, no logs of what is inside, and nothing else.

## Deploying

`.github/workflows/deploy-share.yml` deploys on every change to `worker/` on `main`, or by hand (Actions → Deploy share server → Run workflow). It needs two repository secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with **Workers Scripts: Edit** and **Workers R2 Storage: Edit** on the account.

The first run creates the `node-share-trails` bucket and the 30-day rule.

## Testing

- `node test/share-worker-demo.js`: the Worker with an in-memory bucket.
- `node test/share-server.js`: the Worker on `http://127.0.0.1:8790`. Start NODE with `NODE_SHARE_API` and `NODE_SHARE_LINK_BASE` set to that address to try links locally. `test/e2e/40-share-link.js` does this.
