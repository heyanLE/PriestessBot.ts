# Native Node deployment on NAS

The production archive uses the existing strict TypeScript and Dashboard builds.
It includes compiled application modules, compiled migration entrypoints,
Dashboard assets, locked npm dependency manifests and the required postinstall
hook. It contains no local runtime database, environment file, token, bot
configuration, `node_modules`, Git directory, source maps or local test launcher.
Do not upload a whole checkout or reuse macOS native dependencies on Linux.

## Build and install

Run from the repository with its locked dependencies already installed:

```sh
python3 scripts/prepare-nas-ts-release.py --output /tmp/priestess-native-release.tar.gz
```

The command rebuilds both applications and emits a SHA-256 sidecar. Archives
created from identical build outputs have identical hashes. Each included file
also has a checksum in `release-manifest.json`. Transfer the archive through an
authenticated SSH connection and check its hash before extraction into a new
release directory. Never overwrite an existing release in place.

Node >= 22.18 is required. Node 22.22.1 supports the native SQLite API and the
TypeScript stripping used by the postinstall hook. The pinned node-pty 1.1.0
package requires compilation on Linux; install Python 3, make and g++ if absent.
The npm install also needs access to the package registry and Node headers.

Inside the newly extracted release run:

```sh
npm ci --omit=dev
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(':memory:'); console.log(db.prepare('select 1 as ok').get()); db.close(); require('node-pty');"
```

Use the selected Node installation's `bin` directory in PATH for npm lifecycle
scripts and for the service's configured PATH. Verify a real PTY spawn, not just
the import, before activation. Do not use `--ignore-scripts`: the native module
and SDK declaration patch have required install steps.

## Persistent layout and service

Use separate directories under an application root:

- `releases/<release>`: extracted code and production dependencies.
- `current`: atomic symlink to the active release.
- `config/runtime.env`: service settings and environment credentials, mode 0600.
- `data`: runtime SQLite database, private secret records, token and artifacts,
  directory mode 0700; survives release changes.
- `backups/<timestamp>`: source backups, migration reports and rollback evidence,
  private to the service owner.

Configure the environment file using absolute paths:

```dotenv
HOST=10.77.0.2
PORT=6185
PRIESTESS_DATA_DIR=/home/heyanhub/apps/priestess/data
PRIESTESS_DASHBOARD=/home/heyanhub/apps/priestess/current/dashboard
PRIESTESS_PUBLIC_BASE_URL=http://10.77.0.2:6185
```

These defaults listen on the verified NAS EasyTier address only, rather than
all interfaces. Adapt the root/user/port to verified local deployment values. A bootstrap
configuration, when needed, is supplied by `PRIESTESS_CONFIG`; persistent
configuration thereafter lives in the runtime database. Bot/API keys belong in
the private environment file or runtime secret store, never the release archive.
If no API token environment variable is supplied, the runtime creates a private
`data/management-token` file. Do not print it in deployment logs.

Render `deploy/priestess-ts.service.example` by replacing `@ROOT@` with the
application root and `@NODE@` with the absolute selected Node binary. Install as
a user service and verify that user lingering is enabled for unattended startup.
If using an NVM Node install, set a complete PATH in `runtime.env`; user systemd
does not read interactive shell startup files.

## Cutover and rollback

Back up the old service configuration, state and systemd definition before
changes. Stop and disable the old bot consumer before starting the new one;
never permit the two services to poll the same Telegram account or receive the
same NapCat events simultaneously. Keep the old release and state available.
Perform data migration into the new application's private data directory and
review its explicit compatibility report before activation.

Verify all of these after starting the new service: HTTP health, authenticated
Dashboard API, rendered Dashboard assets, loaded resource counts and identities,
platform transport connection, no duplicate consumer errors, persistent state
after restart and the intended workflow on each bound platform. An active
systemd unit alone does not establish application health. Sending chat messages
requires explicit user authorization; read-only transport checks can be used
before the user tests the bot.

For rollback, stop the new consumer first, restore any altered platform endpoint
configuration from backup, and start the preserved old service. For a later
Priestess release rollback, restore the pre-upgrade data backup when migrations
are not backward compatible, then atomically select the old release. Do not
share one live SQLite database between old and new processes.
