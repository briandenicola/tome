# Deployment Guide

This guide covers deploying Tome using Docker, including configuration, volume management, and production best practices.

## Calibre (optional)

Tome runs with or without a Calibre library.

- **Without Calibre**, leave `CALIBRE_DB_PATH` unset and skip the `/calibre` volume. Add books under **Library → Add book**: a title, authors, pages and a cover (an image file or its web address). **Look up** fills the form from the book's ISBN, using Open Library; it's the only time Tome calls a service on the internet, and only when you click it. Sync Calibre and OPDS are hidden or empty.
- **With Calibre**, its books sync as before, with covers from the library and ratings and tags written back to Calibre. You can still add books by hand beside them: they're never orphaned by a sync, and their ratings and tags stay in Tome. Edit a Calibre book's details in Calibre; edit a book added by hand from its page (**Edit details**, **Remove book**).

Covers of books added by hand are kept in `covers/` next to the database (`/app/data/covers`). Tome's backups copy them with the database (see [Database Backups](#database-backups)).

**Note**: With Calibre, Tome needs write access to sync ratings and tags back. You will need to provide an *absolute* path to your Calibre Library folder. Common Calibre library locations:
- **Linux**: `~/Calibre Library/metadata.db`
- **macOS**: `~/Documents/Calibre Library/metadata.db`
- **Windows**: `C:\Users\<username>\Calibre Library\metadata.db`

## Volumes

| Volume Mount | Container Path | Purpose | Required |
|-------------|----------------|---------|----------|
| `/path/to/storage` | `/app/data` | Tome SQLite database, covers of books added by hand, backups, logs | Yes |
| `/path/to/calibre/library` | `/calibre` | Location of your Calibre library | Only with Calibre |

## Docker Deployment Options

Currently, the *only way* to run Tome is through [Docker](https://www.docker.com/). If you're unfamiliar with Docker, I suggest option #1.

### 1. Docker Desktop

[Install Docker Desktop](https://www.docker.com/products/docker-desktop/) and create a container using their GUI, as described in [this article](https://www.educative.io/answers/how-to-create-a-docker-container-in-docker-desktop).

The image is: `ghcr.io/briandenicola/tome:latest`. Fill in the volumes detailed above.

**Image tags:** `latest` and the version (`0.7.0`, `0.7`) are built from `main`, for amd64 and arm64. `nightly` is built from `develop` on every push, amd64 only.

### 2. Docker CLI
After replacing the host volume references, run this from the command line or terminal:

```
docker run -d \
  --name tome \
  -p 3000:3000 \
  -v /path/to/storage:/app/data \
  -v /path/to/calibre/library:/calibre \
  -e PUID=1000 \
  -e PGID=1000 \
  --restart unless-stopped \
  ghcr.io/briandenicola/tome:latest
```

### 3. Preferred: Docker Compose

```
version: '3.8'

services:
  tome:
    image: ghcr.io/briandenicola/tome:latest
    container_name: tome
    ports:
      - "3000:3000"
    environment:
      - AUTH_PASSWORD=hello # remove to disable auth
      # Set PUID/PGID to match your user (run 'id' to find your values)
      - PUID=1000  # Change to your UID
      - PGID=1000  # Change to your GID
    volumes:
      # Persist SQLite database
      - /path/to/storage:/app/data
      # Calibre library
      - /path/to/calibre/folder:/calibre
    restart: unless-stopped
```

**Access the application** at http://localhost:3000. If needed, the `PORT` value in the `.env` can be adjusted to change your local port.


## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Runtime environment |
| `AUTH_PASSWORD` | (none) | Enables authentication when set. Example: `helloworld`. Every page and `/api` route then needs a sign-in or an API token; see [Authentication](#authentication) |
| `AUTH_SECRET` | (made for you) | The secret sign-ins are signed with. Unset, Tome makes one and keeps it in `.auth-secret` next to the database. Changing it, or the password, signs everyone out |
| `CALIBRE_DB_PATH` | (none) | Path to Calibre metadata.db inside container. Recommended: `/calibre/metadata.db`. Leave unset to run without Calibre |
| `AUDIOBOOKSHELF_URL` | (none) | Audiobookshelf's address, e.g. `http://audiobookshelf:80`. With `AUDIOBOOKSHELF_API_KEY`, turns on progress sync from it; see [Reading apps](#reading-apps) |
| `AUDIOBOOKSHELF_API_KEY` | (none) | An API key (or API token) of your Audiobookshelf user |
| `GRIMMORY_URL` | (none) | Grimmory's address, e.g. `http://grimmory:6060`. With the two below, turns on progress sync from it (Kobo progress included) |
| `GRIMMORY_USERNAME` | (none) | Your Grimmory username |
| `GRIMMORY_PASSWORD` | (none) | Your Grimmory password (Grimmory has no API keys) |
| `SOURCE_SYNC_MINUTES` | `15` | How often Tome reads progress from those apps |
| `PORT` | `3000` | Application port |
| `DATABASE_PATH` | `/app/data/tome.db` | Path to Tome's SQLite database |
| `PUID` | `1001` | User ID to run as (for fixing volume permissions) |
| `PGID` | `1001` | Group ID to run as (for fixing volume permissions) |

## Reading apps

Tome can log your progress from the apps you read in, so you don't type it in: **Audiobookshelf** for audiobooks (and its ebooks), and **Grimmory** for ebooks, which includes what your Kobo syncs to it. Set the variables above and restart Tome; **Settings → Reading apps** shows each app, its last sync, and a **Sync now** button.

- **The first sync** only notes where every book is. Nothing from before is logged, so history you logged by hand isn't doubled. After that, every sync logs the reading since the last one, as a percentage, with the note "Synced from Audiobookshelf" (or Grimmory). Several syncs on one day move that day's entry on rather than adding more.
- **Matching.** Each app book is matched to a Tome book by ISBN, else by title and an author's surname. A book Tome doesn't have is added, with its cover, once there's new reading on it. **Settings → Reading apps** lists every match; **Change** points one at another Tome book or adds it as a new book.
- **Finished** in the app marks the book read in Tome, on the day it was finished. Reading it again in the app starts a re-read.
- **Never backwards.** If Tome is already further on (you logged by hand, or the other app is ahead), nothing is logged.
- **Page counts.** Tome needs a book's page count to start it. Grimmory's books bring theirs; audiobooks don't, so an audiobook waits ("needs a page count" in Settings) until you set one on its page. Its reading is logged on the next sync.
- Physical books in Grimmory, podcasts, and books marked DNF in Tome are left alone.

Grimmory has no API keys, so Tome signs in as you with `GRIMMORY_USERNAME` and `GRIMMORY_PASSWORD`, keeps the token in memory, and signs in again only when it expires.

## Life store

The [life store](https://github.com/briandenicola/lifestore) reads Tome through `GET /api/lifestore/records`: every book with reading on it (books only on the to-read pile are left out), each with its reads, review, rating and the progress logged in them, a page at a time (`?page=<token>&limit=<1-500>`, answering `{ records, next }`). In Tome, make a token under **Settings → API tokens** with access **Read**, and paste it into the life store's Tome integration. Nothing in Tome is changed by it.

## Authentication

With `AUTH_PASSWORD` set:

- **Signing in** sets a session that lasts 30 days. It is signed with `AUTH_SECRET` (or the secret Tome keeps next to its database) and your password, so it can't be forged, and changing the password signs everyone out.
- **Every page and every `/api` route** needs a signed-in session. The exceptions are signing in and out, and OPDS, which asks e-readers for user `tome` and your password (HTTP Basic auth).
- **Other apps** (the life store, an AI assistant, scripts) use an **API token** from **Settings → API tokens**, sent as `Authorization: Bearer <token>`. A read token can only read (`GET`); a write token can do anything the app can. Tokens can't make or revoke tokens. A token is shown once, when it's made; revoke it there when it's no longer needed.
- **After five wrong passwords** from one address, sign-in waits a minute. Behind a reverse proxy, make sure it sends `X-Forwarded-For`, or every client counts as one.

Without `AUTH_PASSWORD`, Tome asks for no sign-in at all. Don't expose it to the internet that way.

## PUID/PGID Support

Tome supports PUID (User ID) and PGID (Group ID) environment variables to eliminate volume permission issues. This feature allows the container to run with the same user/group IDs as your host system, ensuring seamless file access.

### Finding Your UID/GID

On your host system, run:
```bash
id
```

This will output something like:
```
uid=1000(username) gid=1000(groupname) groups=1000(groupname),...
```

Use the `uid` and `gid` values for PUID and PGID.

### Common PUID/PGID Values

| System | Typical PUID | Typical PGID | Notes |
|--------|---------------|-------|-------|
| Linux (first user) | `1000` | `1000` | Most common on Linux machines |
| Docker default | `1001` | `1001` | Tome's default if not specified |
| Synology | `1026` | `100` | Check your NAS user settings |
| macOS/Windows + Docker Desktop | N/A | N/A | Less critical due to virtualization |

### Configuration Examples

**Docker Compose** (recommended):
```yaml
services:
  tome:
    image: ghcr.io/briandenicola/tome:latest
    environment:
      - PUID=1000
      - PGID=1000
```

**Docker CLI**:
```bash
docker run -d \
  -e PUID=1000 \
  -e PGID=1000 \
  ghcr.io/briandenicola/tome:latest
```

## Database Backups

### Using Built-in Backup Scripts

Tome includes automated backup scripts that work inside the container:

```bash
# Create a timestamped backup
docker exec tome npm run db:backup

# List available backups
docker exec tome npm run db:list-backups

# Restore from backup (interactive)
docker exec -it tome npm run db:restore
```

Backups are stored in `data/backups/` inside the container (part of the `tome-data` volume). Each backup holds the database and, beside it as `covers.backup-<time>/`, the covers of books added by hand. Restoring a backup puts its covers back too; the covers in place before are kept in `data/backups/<date>/covers.before-restore-<time>/`. A backup made before this version has no covers with it, and restoring it leaves the current covers as they are.

## Database Migrations

Tome uses Drizzle ORM for database schema management. The migrations run automatically on container startup (before the app starts).

If needed, you can run migrations manually:

```bash
docker exec -it tome npm run db:migrate
```

**However**, you're encouraged to run backups _before_ manually running migrations:

```bash
docker exec tome npm run db:backup
```
This is done automatically on container startup.

## Common Issues

### Permission Errors

**Recommended Solution**: Use PUID/PGID environment variables (see above). This automatically fixes permissions on container startup.

### Port Conflicts

If port 3000 is already in use on your host, remap your container's **external** port:

**Compose**:
```yaml
ports:
  - "3001:3000"
```
or via **CLI**:
```bash
-p 3001:3000
```

### Calibre Database Not Accessible

Verify the mount path and permissions:

```bash
# Check if file exists inside container
docker exec tome ls -l /calibre/metadata.db

# Verify environment variable
docker exec tome printenv CALIBRE_DB_PATH
```

## Support

For additional help:
- Check [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- Review [DATABASE.md](./DATABASE.md) for database operations
- Open an issue on GitHub
