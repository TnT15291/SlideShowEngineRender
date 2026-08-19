# Deploying StoReel — G2.3, G2.4, G1.4

Everything here serves the semi-self-serve model in `GO-LIVE-PLAN.md` §2: the
customer registers, uploads, and pays on the web; you press render.

Nothing in this directory has been run against a real domain yet. It is
written, reviewed, and internally consistent — but "it deploys" is only true
once you have done §1 below and seen a padlock.

---

## 1. First deploy

**You need:** a Linux host with Docker, a domain pointed at its IP, and ports
80 and 443 reachable. Two vCPUs and 4 GB RAM is the floor; a render pegs one
core for 15–48 minutes and the cap in G2.6 is set to one render at a time for
exactly that reason.

```bash
git clone <your remote> storeel && cd storeel
cp .env.example .env
```

Edit `.env`. The deploy will not come up without these:

| Variable | Why it blocks |
|---|---|
| `STOREEL_DOMAIN` | Caddy cannot request a certificate without a real hostname |
| `STOREEL_TLS_EMAIL` | Let's Encrypt requires a contact address |
| `STOREEL_MAIL_FROM` | No sender ⇒ password reset returns 409 `EMAIL_NOT_CONFIGURED` |
| `RESEND_API_KEY` | Same |
| `STOREEL_ADMIN_USERNAMES` | Whoever is not listed cannot open the incident centre |

`STOREEL_PUBLIC_URL`, `STOREEL_WEB_ORIGINS`, `STOREEL_API_HOST/PORT` and
`FFMPEG_PATH` are set by `docker-compose.yml` from `STOREEL_DOMAIN`. Do not
also set them in `.env`; two sources for one value is how a reset link ends up
pointing at `127.0.0.1`.

```bash
docker compose up -d --build
docker compose logs -f web        # watch the certificate arrive
curl https://your-domain/api/health
```

### Prove the acceptance criteria

G2.3 asks for three specific things. Check all three, not just the first:

```bash
# Reachable over HTTPS on the real domain
curl -sS https://your-domain/api/health

# Kill it — Docker brings it back
docker compose kill api && sleep 15 && docker compose ps

# Reboot — the stack comes back on its own
sudo systemctl enable docker && sudo reboot
```

---

## 2. Backups — G2.4

Accounts are tiny and irreplaceable; photos are enormous and irreplaceable.
They are separate flags for that reason.

```bash
# Accounts, sessions, reset tokens, incidents. Seconds. Every night.
node scripts/backupStoreel.mjs --to /mnt/backup

# Also the customers' photos and films. Slow and large. Weekly, off-machine.
node scripts/backupStoreel.mjs --to /mnt/backup --full
```

`--to` must not be inside the engine directory; the script refuses, because a
backup on the disk that just died is not a backup.

Suggested crontab:

```cron
15 3 * * *  cd /srv/storeel && node scripts/backupStoreel.mjs --to /mnt/backup            >> /var/log/storeel-backup.log 2>&1
30 4 * * 0  cd /srv/storeel && node scripts/backupStoreel.mjs --to /mnt/backup --full     >> /var/log/storeel-backup.log 2>&1
0  6 * * 1  cd /srv/storeel && node scripts/restoreStoreel.mjs --from "$(ls -d /mnt/backup/storeel-* | tail -1)" --verify >> /var/log/storeel-backup.log 2>&1
```

All three exit non-zero on failure, so cron mail is the alarm.

### The part everyone skips

The plan is blunt: *backup chưa từng restore không phải backup.* Do this once,
on purpose, before you take money:

```bash
mkdir /tmp/blank && cd /tmp/blank
git clone <your remote> storeel && cd storeel
node scripts/restoreStoreel.mjs --from /mnt/backup/storeel-<stamp> --into .
docker compose up -d --build
# then actually sign in as a real customer account
```

`--verify` re-hashes every file against the manifest and writes nothing; it is
the cheap weekly check. Restoring onto a blank machine is the real test, and
`--verify` is not a substitute for it.

---

## 3. Storage discipline — G1.4

~700 MB per project. 41 GB across 58 projects today. The Privacy Policy
commits to deleting source files 30 days after delivery and the film after 90,
and `scripts/purgeDeliveredProject.mjs` is what makes that true rather than
aspirational — it reads both windows straight out of `legalContent.ts`.

```bash
node scripts/purgeDeliveredProject.mjs --all            # report only
node scripts/purgeDeliveredProject.mjs --all --apply
```

It never touches a project with no delivery receipt, at any age. Schedule it:

```cron
0 5 * * *  cd /srv/storeel && node scripts/purgeDeliveredProject.mjs --all --apply >> /var/log/storeel-purge.log 2>&1
```

Run the report by hand first and read what it plans to delete.

---

## 4. Before you take real money

- [ ] Fill in `businessDetails` in `apps/web/src/lib/legalContent.ts`. Until you
      do, both policy pages display a "Draft" banner listing what is missing.
      Have someone qualified read them against Vietnamese consumer and
      personal-data law — they are not lawyer-reviewed.
- [ ] Decide the actual prices (G1.2) and set `STRIPE_*` / `MOMO_*` in `.env`.
      The numbers in `.env.example` are placeholders nobody chose.
- [ ] Switch `MOMO_ENDPOINT` off `test-payment.momo.vn`.
- [ ] Run one real transaction and confirm the credit lands (G2.5).
- [ ] Confirm `music/` is absent from the running container:
      `docker compose exec api ls music` should fail.

## 5. Operational notes

**One render at a time.** `STOREEL_MAX_CONCURRENT_RENDERS` defaults to 1. Raise
it only after moving rendering to a machine with cores to spare; the queue
already tells waiting customers their position.

**Where the data is.** `./projects` and `./server/data` are bind-mounted from
the host. `docker compose down -v` destroys the Caddy volumes (certificates)
but not those two. Back them up anyway — see §2.

**Logs.** `docker compose logs api`. Per-render logs live in
`projects/<id>/logs/`, and the last 80 lines of a failed run are kept in that
run's job manifest, so a customer reload does not lose the explanation.
