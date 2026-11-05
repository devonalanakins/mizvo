# Mizvo V0.18 — disposable local review session

**Status: local-only, fictional-data development utility.** This is neither private cloud staging nor a hosted Mizvo preview. It does not send invitations or emails, touch customer records, change DNS, configure TLS or deploy anything.

## What the reviewer can inspect

The real Mizvo application launches against a *fresh temporary SQLite database* with three fictional accounts, deliberately scoped to one fictional client project. This is not a screenshot, mockup or replacement implementation. Use **Studio** for founder and engineer roles, and **Client Space** for the fictional client. The data contains a shared Living Brief, a milestone, a delegated task with due date, an internal-only record and a pending client decision. A client must not see the internal-only record, assignee identity or internal task.

This is a read/write demonstration in which changes last only until termination. It has no external services; the GitHub source adapter has an empty repository allowlist.

## Start on a trusted local computer

Requires Node 24.22.1+, npm and an interactive local terminal. Work from the cloned, reviewed branch:

```sh
npm ci
npm run build
npm run review:local
```

The command prints a random **loopback** URL and three unique one-time passwords to the local terminal. The application binds only `127.0.0.1`; the URL is `http://localhost:<random-port>/studio`. It does not choose a fixed port and does not read `MIZVO_DATABASE`, `MIZVO_ACCOUNT_PASSWORD`, `MIZVO_GITHUB_TOKEN` or other deployment credentials. Do not save or paste terminal passwords into tickets, logs, screen recordings or third-party chats.

Sign in as the fictional founder or engineer at `/studio`, and as the fictional client at `/space`. Use different browser profiles or log out between roles.

Press **Ctrl+C** in the launching terminal to close the server and delete the temporary database folder. The code also cleans up on a normal initialization error; an abrupt forced kill, kernel crash or power loss cannot guarantee cleanup. Do not use any real personal or customer data in this temporary experience.

The source uses an OS-private temporary folder and random credentials. Reviewers should still use a trusted local computer, because OS administrators and local processes with equivalent privileges may access temporary data. This is not a trusted multi-user sandbox or a production security boundary.

## Verify

```sh
npm test
npm run build
```

`tests/review-local.test.ts` starts an actual localhost listener, logs in with all three synthetic roles through HTTP, checks project-scoped access and the Client Space projection, and asserts the directory is gone after normal shutdown. The normal CI pipeline also builds, checks distribution integrity, exercises private container staging and runs Chromium/WebKit workflows. None of that proves the utility is reachable remotely or establishes hosted production readiness.

## What still blocks a hosted review

A persistent authorized Node/SQLite host; approved private HTTPS ingress and client access controls; encrypted off-host backups with observed restore; independent security review; nontechnical and mobile acceptance; and explicit release authorization. The local review command deliberately does **not** make any of those choices or change `compose.staging.yaml`.

**Never expose the generated local server to the public internet or run it against production/client data.** See [Release](RELEASE.md), [Container staging](CONTAINER-STAGING.md), and [Capabilities](STATUS.md) for the separate gates.
