# Dashboard Frontend

The v2 Dashboard frontend lives in `dashboard/` and uses Vue 3, Vite, TypeScript, Vue Router, and Pinia.

## Local Development

Run the backend with server config enabled, then start the frontend dev server:

```powershell
cd dashboard
npm install
npm run dev
```

Vite proxies `/health`, `/api/*`, and `/ws/*` to `http://localhost:8080`.

## Packaged Runtime

Build the frontend into the Kotlin distribution with:

```powershell
.\gradlew.bat --no-daemon clean installDist -PbuildDashboard=true
```

The Gradle task copies `dashboard/dist` into classpath resources under `dashboard/`. Ktor serves `/`, `/assets/*`, and nested frontend routes from those packaged resources while keeping `/api/*` and `/ws/*` as backend routes.

The NAS deploy script uses this packaged build path, so the Dashboard is available from the configured server port after deployment.
