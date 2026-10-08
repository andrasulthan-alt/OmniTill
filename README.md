# OmniTill

A point of sale for cafes and small hotels, built as a website and an Android app.
It works offline, syncs between devices in real time, and keeps your data in **your own** Supabase project.

- **Cafe till:** menu, cart, discounts, tax and service charge, cash/QRIS/card/transfer, printable receipts, shifts with cash count.
- **Hotel:** rooms, reservations, check-in and check-out, room charges from the till, folio billing, housekeeping states. The database makes double-booking impossible.
- **Stock:** ingredients with recipes. Every sale takes stock out automatically, atomically, with a full movement history. A paid sale is never refused for low stock.
- **Reports:** revenue, cost of goods, expenses, profit, top items, payment methods, CSV export.
- **Offline first:** sales are saved on the device and uploaded when the connection returns. Each sale has an ID made on the device, so a retry can never create a duplicate.
- **Security:** Row Level Security per role, device PIN lock with a scrambled keypad, duress PIN, audit log, strict Content Security Policy, no secrets in the code.
- **Design:** Nothing OS style. Monochrome, one red accent, dot-matrix type, thin line icons. No UI framework.

OmniTill is a ground-up rewrite of the earlier SENJA POS (Firebase). It no longer uses Firebase or any Google service.

## Roles

| Role | Can do |
| --- | --- |
| Pending | Nothing. New accounts wait for approval. |
| Cashier | Sell, open and close own shift, hotel bookings and room charges, see own sales. |
| Manager | Everything a cashier can, plus menu, stock, reports, expenses, voids, all sales. |
| Admin | Everything, plus staff roles, business settings and the audit log. |

The first account that signs up becomes the admin. Everyone after that starts as Pending until an admin approves them under **Staff**.

## Setup (about 10 minutes)

You need a free [Supabase](https://supabase.com) account. Creating the account and the project must be done by you.

1. **Create a project** at supabase.com. Pick a region close to your business and save the database password somewhere safe.
2. **Turn off email confirmation** (recommended for a small business): Authentication, Sign In / Providers, Email, switch off *Confirm email*. If you leave it on, new staff must confirm their email before they can sign in.
3. **Create the tables:** open SQL Editor, New query, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), press Run. It is safe to run again after updates.
4. **Optional sample data:** paste [`supabase/seed.sql`](supabase/seed.sql) and run it to get a sample cafe menu, ingredients, recipes and six hotel rooms. Skip this for a real launch and add your own menu in the app.
5. **Copy two values:** Project settings, API. Take the **Project URL** and the **anon (public) key**. Never use the `service_role` key anywhere in this app.
6. **Open the app,** paste the URL and key on the first screen, create your account. You are the admin.
7. **Realtime (optional but nice):** Database, Replication. The schema already adds the tables to the `supabase_realtime` publication. If a device does not update by itself, it still catches up every 30 seconds.

To ship the app pre-connected for your staff, put the two values into [`app/js/config.js`](app/js/config.js) before publishing. Both values are public by design. Row Level Security is what protects the data.

## Use it

### Website (GitHub Pages)

The `app/` folder is a static site. The included workflow publishes it to GitHub Pages on every push to `main`.
Enable it once: repository Settings, Pages, Source: **GitHub Actions**.

### Android app

The included workflow builds a signed APK (a Trusted Web Activity wrapper around the website) and attaches it to a GitHub Release.
See [`android/README.md`](android/README.md) for the one-time signing key setup. Install the APK from the Releases page, or add the repository to
[Obtainium](https://github.com/ImranR98/Obtainium) to get updates automatically.

### Install as an app from the browser

Open the site in Chrome, Edge or Safari and choose *Install app* or *Add to Home Screen*.

## Device security

- **PIN lock:** 4 to 8 digits, stored only as a salted PBKDF2 hash on the device. The screen locks after the idle time you choose. The keypad can scramble its digits each time.
- **Wrong PIN throttling:** delays start after 5 mistakes and grow up to 5 minutes. After 12 mistakes the device signs out and clears its cached data.
- **Duress PIN:** typing it on the lock screen signs the device out and clears cached data, with no warning on screen.
  Sales not yet uploaded stay on the device so no money is lost.
- The PIN protects a signed-in device that is left alone. Account security is the Supabase login. Use a strong, unique password for every staff account.

## How the money stays correct

- Prices, tax and totals are **recomputed on the server** from the catalog. The device cannot make a sale cheaper. (A sale made offline before a price change keeps the price the customer saw.)
- Sales, stock, bookings and shifts can only change through database functions, never by direct table writes.
- Stock is taken out in one transaction with the sale. Ingredient rows are locked in a fixed order, so busy tills never deadlock.
- A receipt number clash between two offline devices is resolved by the server, which issues a new number.
- Voiding a sale puts the stock back. Only managers and admins can void, and a reason is required.

## Project layout

```
app/                  the website (static, no build step)
  js/                 application code (plain ES modules)
  js/views/           one file per screen
  css/app.css         Nothing-style design
  vendor/             supabase-js and the fonts, copied in so the app works offline
supabase/schema.sql   tables, Row Level Security, database functions
supabase/seed.sql     optional sample data
android/              Android (TWA) wrapper and signing instructions
test/                 database and browser tests, plus a local Supabase stand-in
.github/workflows/    GitHub Pages and Android release workflows
```

## Develop and test locally

The tests need Postgres 15+ (port 54329), [PostgREST](https://postgrest.org) (port 54331, config in `test/postgrest.conf`), Node 18+ and Playwright for Python.
A small stand-in server (`test/mock-supabase.js`) plays the part of Supabase sign-up and sign-in, so no cloud account is needed.

```bash
(cd test && npm install) && bash test/restart.sh                                   # fresh database with schema + sample data, and the stand-in server
psql -h /tmp -p 54329 -U postgres -d ot -f test/db_test.sql   # database rules: roles, double booking, stock, voids
python3 test/e2e2.py                                    # 19 browser checks on a phone-sized screen
```

The stand-in mimics only what the app uses (sign-up, password sign-in, REST). Real Supabase behaves the same for these.

## Credits and licence

- OmniTill is released under the [MIT licence](LICENSE).
- It began as a fork of SENJA POS (MIT, andrasulthan-alt) and keeps its feature ideas. The code was rewritten from scratch.
- [Doto](https://fonts.google.com/specimen/Doto), [Space Mono](https://fonts.google.com/specimen/Space+Mono) and [Inter](https://rsms.me/inter/) are used under the SIL Open Font Licence 1.1.
- [supabase-js](https://github.com/supabase/supabase-js) is used under the MIT licence.
- Visual direction inspired by Nothing OS. This project is not affiliated with Nothing Technology Limited.
