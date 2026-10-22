# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository
(<https://github.com/Offxc/GitCrook/security/advisories/new>).

Include what you found, how to reproduce it, and what an attacker gains. A proof of concept against your
own deployment is plenty; please don't test against someone else's.

This is a small project maintained by one person, so responses are best-effort, but a report will be read
and acknowledged, and a confirmed issue is fixed before it is discussed publicly.

## Scope

In scope: the web app, the worker, the Docker/Caddy configuration shipped in this repository, and the
sign-in, access-control, upload, domain-verification and (once it ships) Git Sync code paths.

Out of scope: problems that need an already-compromised server or admin account, missing hardening on a
deployment you configured differently from `docker-compose.yml`, and findings in third-party services
(Discord, GitHub, your DNS provider).

## What is protected, in short

- Sites are `PUBLIC`, `PASSWORD`, or `PRIVATE`; page content, titles, search, feeds and files follow the
  same rule as the page. Password sessions are bound to the password's version, so changing it signs
  everyone out.
- Sign-up is closed by default (`SIGNUP_MODE=closed`): new accounts need an allow-listed Discord ID or a
  verified-email invitation. See the README's configuration table.
- Outbound requests to user-supplied URLs go through `safeFetch`, which pins the connection to the address
  it validated and refuses private ranges.

## Supported versions

Only the latest commit on `main`. There are no release branches.
