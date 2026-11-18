# SkillOrbit

SkillOrbit is a role-based career preparation and hiring workspace for students, institutions, and employers. It is built with React, TypeScript, Express, and MongoDB.

## Requirements

- Node.js 22.12 or newer
- npm
- MongoDB Community Server running locally, or another accessible MongoDB deployment

## Run locally

```powershell
npm install
npm run dev
```

The Vite client runs at `http://localhost:5173` and proxies `/api` requests to the Express API at `http://localhost:5000`. The MongoDB connection and indexes are configured in `db/mongo.js`. By default, the backend connects to `mongodb://127.0.0.1:27017` and uses the `skillorbit_app` database. Set `MONGODB_URI` and `MONGODB_DB` in `.env` to use another MongoDB deployment. MongoDB stores its database files outside the project directory; a development signing key is created under `data/` on first startup.

For production, copy `.env.example` to `.env`, set `MONGODB_URI`, a unique `JWT_SECRET` (at least 32 characters), the public HTTPS `APP_BASE_URL`, and your SMTP host, port, user, password, sender address, and TLS mode for password-reset emails. Set `SENDGRID_API_KEY` and verify `MAIL_FROM` with SendGrid for job notification emails. Set `PORT` and `SKILLORBIT_DATA_DIR` as needed. The server refuses to start in production if the required settings are missing or unsafe. Keep `.env` private. Then run:

```powershell
npm run build
npm start
```

The production server serves the built client and API from one origin. Set `SKILLORBIT_DATA_DIR` to a persistent, private directory when deploying.

## Installable web app

The Vite build includes a web app manifest, install icons, an offline page, and a service worker. The service worker caches only the static install shell; it bypasses `/api/` and does not store authenticated or private responses. Serve production over HTTPS for browser installation.

## Android application

Capacitor packages the existing React build. The native project is in `android/` and calls the existing Express deployment, which continues to use the configured MongoDB database. The Android WebView origin (`https://localhost` by default) is allowlisted for API CORS; keep `CAPACITOR_SERVER_ORIGIN` in sync if you change Capacitor's Android scheme or hostname.

1. Copy `.env.android.example` to `.env.android` and set `VITE_API_BASE_URL` to the public HTTPS origin that serves the existing SkillOrbit website and `/api` endpoints. The Android build rejects HTTP and placeholder origins.
2. Build and sync the bundled React app with `npm run android:build`.
3. Run `npm run android:open` to open Android Studio or `npm run android:run` to install on a connected device/emulator. Android Studio and an Android SDK are required.
4. For signed release builds, create a private keystore and `android/keystore.properties`; use the Gradle signing setup in `android/app/build.gradle`. Never commit the keystore or its passwords.

Windows CMD release signing example (run from the project folder; keep both files private):

```cmd
copy .env.android.example .env.android
notepad .env.android
npm run android:build
cd android
keytool -genkeypair -v -keystore skillorbit-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias skillorbit
notepad keystore.properties
```

Put these values in `android/keystore.properties`, using your own passwords:

```properties
storeFile=../skillorbit-release.jks
storePassword=YOUR_STORE_PASSWORD
keyAlias=skillorbit
keyPassword=YOUR_KEY_PASSWORD
```

Then generate either release package:

```cmd
gradlew.bat assembleRelease
gradlew.bat bundleRelease
```

The signed outputs are under `android/app/build/outputs/apk/release/` and `android/app/build/outputs/bundle/release/`.

Example Android API configuration (replace with your actual production domain):

```dotenv
VITE_API_BASE_URL=https://skillorbit.example.com
```

## Implemented workflows

- Student and company registration and login, profile editing, profile image uploads, session expiry, and logout. Institution workspaces remain available to existing institution accounts.
- Accounts can sign in immediately after registration. One-time password reset links are sent by email; development without SMTP returns a local link in the interface, while production sends links through the configured SMTP service.
- New job postings create an in-app notification and attempt a SendGrid email for every student account, including accounts whose email is not verified. Configure `SENDGRID_API_KEY` and verify `MAIL_FROM` with SendGrid for email. Do not put provider credentials in client code or commit them.
- Student resumes (CRUD, formatted previews, and downloadable LaTeX source), PDF/TXT resume analysis with saved history, job discovery and filters, saved jobs, and applications with contact details, an attached saved or job-specific PDF/TXT resume, optional note, and status timeline. Companies can download the resume submitted with each application.
- Students can review submitted application details and attached resumes, edit or withdraw eligible applications, and set job alerts. Employers can filter applicants by status, skills, and experience.
- Aptitude and interview practice sessions with stored answers and session history; interview experience sharing; career guidance with external reference links; account activity and notifications.
- Institution student roster, department management with record-derived metrics, placement-drive records, analytics, and roster CSV export.
- Company job posting/closing/deletion, applicant review and status history, hiring metrics, and CSV export.
- Profile-completion guidance, keyboard focus and reduced-motion support, responsive layouts, loading/empty/error states, and owner/role-scoped API access.
- MongoDB Extended JSON backups with `npm run backup`. Backups are written to `data/backups/`; set `SKILLORBIT_BACKUP_DIR` to use another private, persistent location. Schedule this command with your deployment platform and define a retention policy for production.

## Intentionally not enabled

- Arbitrary code execution is not provided. A secure isolated execution service is required before exposing a code runner.
- Employee directories/performance, institution-company collaboration, and certification enrollment are excluded because their data ownership and product rules are not defined.
- ATS analysis is a local keyword/section heuristic, not a hiring prediction. Career guidance is deterministic and does not claim to be generative AI.

## Validation

```powershell
npm test
npm run build
npm run lint
```

The API and backup integration tests use separate, temporary MongoDB databases; they do not touch the application database. The backup command exports the configured database to a timestamped Extended JSON file without stopping the server.
