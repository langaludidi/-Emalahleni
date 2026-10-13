# Emalahleni beneficiary assurance

Development source and build package for the Emalahleni beneficiary verification platform.

## Download

Open [Emalahleni_Build.zip](./Emalahleni_Build.zip), then click **Download raw file** (the download arrow above the file). Unzip it on your computer.

Alternatively, use **Code → Download ZIP** to download the repository. The application is in `emalahleni-app/`.

## Run

From the `emalahleni-app` folder, using Node.js 24 or newer:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run dev
```

Open http://localhost:8787.

## Deploy

Read [the deployment guide](./emalahleni-app/README.md). The target is the existing Cloudflare staging Worker. Database, encryption and scanner secrets must be configured separately; credentials are excluded from this repository. Case access and uploads remain disabled by default.

The package includes the four-step form, authenticated encrypted draft API, conditional evidence requirements, private upload/scanning controls, assessor reviews and the DoHS section workspace. Twelve local tests passed and the Next.js/Worker bundles built successfully. Deployment, live scanner integration, phone-browser checks and final rules approval remain outstanding. This is a development build, not a production release.
