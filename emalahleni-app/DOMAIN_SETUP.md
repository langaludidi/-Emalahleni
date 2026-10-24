# Connect app.vectrasa.co.za

The selected platform address is **https://app.vectrasa.co.za**. Keep registration at Domains.co.za and keep the main domain available for Vectra Solutions. The existing app, Worker, bucket and GitHub names stay unchanged.

## Current, verified position

Public DNS checked on 24 October 2026 is hosted on `ns1.mysecurecloudhost.com`, `ns2.mysecurecloudhost.com`, `ns3.mysecurecloudhost.com` and `ns4.mysecurecloudhost.com`. The app hostname is not published yet. The main website returns a 404 page; this does not establish whether email is working.

The main address is also the mail server's MX target. Preserve these current records during onboarding:

| Type | Name | Value | Cloudflare proxy setting |
| --- | --- | --- | --- |
| A | @ | 192.250.229.108 | DNS only |
| CNAME | www | vectrasa.co.za | DNS only |
| MX | @ | vectrasa.co.za, priority 0 | DNS only |
| TXT | @ | v=spf1 +a +mx +ip4:192.250.229.108 include:spf.mysecurecloudhost.com ~all | Not applicable |

This is a public-record snapshot, **not a complete zone export**. Obtain and import the full existing DNS zone, including any DKIM, DMARC, mail, verification, SRV and other subdomain records. Public lookup and Cloudflare's quick scan cannot establish that the complete zone was copied. Mail hostnames and the apex must remain DNS only while mail depends on the apex address.

## Dashboard steps that require account access

The current workspace has no Cloudflare or Domains.co.za DNS connection. The app source and Neon Auth can be prepared here; account-side zone and nameserver changes require dashboard access.

1. In the existing Cloudflare account `f887a522ca852a80491c2485853d4363`, open `vectrasa.co.za` if it is already listed. Otherwise add/onboard that domain using the Free DNS plan. The existing Workers subscription remains separate.
2. Import the full existing DNS zone and review it against the current provider's export. Check the records above, especially the DNS-only apex used by email. Keep the existing MX/TXT records and all additional mail records.
3. Copy the **two nameservers assigned by Cloudflare to this zone**. They are unique to the account/zone; do not use example nameservers.
4. In Domains.co.za, open this domain's nameserver settings and replace the current four nameservers with Cloudflare's assigned pair. Registration stays at Domains.co.za. If the interface labels differ, stop at the domain settings and report the visible options.
5. Wait for Cloudflare to show the zone as **Active**. Check that the existing website and mail DNS still resolve to their preserved values.

Once the zone is active, the platform domain can be attached to the existing Worker. A CNAME to the workers.dev address alone is not the Worker custom-domain setup.

## App-side activation after the zone is Active

The following route belongs in the **existing** `wrangler.jsonc`, alongside its current configuration:

```json
"routes": [{ "pattern": "app.vectrasa.co.za", "custom_domain": true }]
```

This entry is deliberately not active in the current deployment configuration: Cloudflare requires an active owned zone, and enabling it earlier would block working app deployments. Once DNS is ready, add it to the canonical config and deploy the existing `emalahleni-api-staging` Worker through the normal verified release path. Keep `workers_dev: true` as the fallback address. Cloudflare creates the custom hostname's DNS record and certificate.

The equivalent dashboard operation is **Workers & Pages → emalahleni-api-staging → Settings → Domains & Routes → Add → Custom Domain → app.vectrasa.co.za**. Record this route in the source config too so the source continues to describe the deployment.

Neon Auth's staging branch already accepts `https://app.vectrasa.co.za`; the original workers.dev origin is retained. The app uses relative `/api` requests, so frontend and API share the custom hostname. No database, authentication provider, storage or encryption-context rename is needed.

## Verify the cutover

Run with Node.js 24 or newer:

```sh
node scripts/check-domain.mjs
```

The read-only check returns exit code 2 while DNS, HTTPS/app routing or the auth origin remains pending, and 0 when those public checks pass. It does not sign in, send email or prove an authenticated user journey. Proxy-managed environments can run it with `NODE_USE_ENV_PROXY=1` while retaining their inherited proxy and CA configuration.

After public checks pass, verify real sign-in, session restoration, project access, save/reopen, upload/scan and ID confirmation on the new hostname. Existing browser sessions on workers.dev do not automatically move to the new origin. Check email DNS before and after the nameserver change; send/receive testing needs the mail account owner.

Reference: [Cloudflare Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).
