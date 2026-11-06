# Amendment A13: ship or merge a pull request from Pi Hub

Date: 2026-11-06 · Status: **approved** 6 November 2026 (pi-hub #145) · Amends: §6.3 (the engineering
change loop), the records table (two new kinds), auth's key-exempt paths (`hub/app.py`), and the Needs-you phrases
(appliance-ui `src/needs.js`).

## Why

1. **Every pull request waits for the Mac.** Claude sessions open PRs on the owner's repos all day. Merging one and
   releasing it means the owner's terminal: `npm run ship -- <PR>` for Local AI, `gh pr merge` elsewhere. The owner is
   often away from the Mac, on the phone or the iPad, where Pi Hub already is.
2. **Merging on GitHub's phone app releases nothing.** A Local AI PR merged on github.com doesn't deploy until `ship`
   runs on the Mac. That left `main` undeployed twice on 5 Nov; #503 fixed the release side, but `ship` still runs only
   on the Mac.
3. **The baseline has no place for it.** §6.3 keeps the change loop in Local AI's Improve page, and Pi Hub only links a
   release's commit to GitHub (`hub/static/js/versions.js:41`).

## Decisions

**D1 The owner acts from Pi Hub's Needs you.** Open PRs on the owner's home-platform repos appear in Needs you as one
group, "Pull requests waiting" (phrase key `pr_waiting`):
- Each row: the repo, the number and title, the checks (local CI where the repo has it), and how old the PR is.
- Each row has one verb: **Ship** for a repo with a release command (Local AI), **Merge** elsewhere.
- Changes are still decided and worked in Local AI's Improve page (§6.3, unchanged); A13 only adds the last step, and
  adds it on the front door, which works while the PC sleeps.
- Rejected: putting it in Improve. That page lives on the PC, and an action needs the Mac anyway.

**D2 No forge credential on the Pi.**
- A Mac agent, `pr-agent`, runs under the owner's account. It holds the GitHub login the Mac already has (`gh`), and the
  Pi holds none.
- The agent publishes the PR list to Pi Hub, and takes the owner's requests back, with the existing Mac key
  (`x-hub-mac-key`, `hub/app.py:55-63`). Its exempt paths extend to `/api/prs/`.
- Rejected: a GitHub token on the Pi. It would let anyone who gets past Pi Hub's gate merge code into every repo.
- **The trade:** nothing happens while the Mac sleeps. A request waits, and says so (D6).

**D3 Requests, not commands.** The pattern is Print lab's (`lab_requests`, `hub/lab.py:75-88`): Pi Hub stores a
request, and the agent applies it and reports the result.
- **Shape:** a `pr_request` names the repo, the PR number, the action, the PR's **head commit** when the owner tapped,
  the device, and the time.
- **One live request per PR.** A repeat while one is pending is the same request.
- **The agent refuses** when the head has moved since the tap, so the owner ships exactly what they saw. It also
  refuses a PR not based on `main`, a PR from a fork, and a PR from any author but the owner's account.
- **Expiry:** an untaken request expires after 24 hours and shows as expired, never as done.

**D4 What each verb runs, and nothing else.** The agent runs fixed commands; it never pushes, force-pushes or edits a
branch.
- **Ship (Local AI):** `npm run ship -- <PR>`. Local CI is the gate, and the release goes out as today, through
  `release` and Safe Deploy.
- **Merge (other repos):** `gh pr merge <PR> --merge --match-head-commit <sha>`, only when the PR's required checks are
  green.
- **Pi Hub's own deploy is not included.** `git push pi main` stays with the owner's Claude Code session after its
  preflight (`AGENTS.md:34`). Merging a pi-hub PR from Pi Hub merges it, and Versions then shows `main` ahead of what's
  live, as it does today.

**D5 "Approve" means the owner's go, not a GitHub review.** GitHub doesn't let an account approve its own PR, and the
Claude sessions open PRs as the owner's account. So:
- the tap itself is the approval;
- it is recorded on Pi Hub (who, which device, when, which head commit);
- the agent adds it to the PR as a comment ("Shipped from Pi Hub by the owner's iPhone at 09:12, head `b5dae3a`").
- Rejected: a separate reviewer account for Claude's PRs. It adds a second identity, and a review rule nobody asked for.

**D6 Honest states.**
- **The list's age:** it shows "as of" the agent's last report. When the Mac hasn't reported for 10 minutes the group
  reads "Mac last seen 2 h ago: actions wait for it", and no list older than that is shown as current.
- **A request's states:** waiting for the Mac, taken, running local CI (since when), merged (commit), released (commit),
  refused (the reason: head moved, checks not green, not the owner's), failed (the command's last line), expired.
- **Outcome notices:** each final state also goes to the Inbox. A failed or refused request stays in Needs you until the
  owner dismisses it.
- **The release itself** shows on Versions from its own `release:` record, as today. A "merged" request is never shown
  as "live".

**D7 Owner-only, confirmed, never one tap from elsewhere.**
- Ship and Merge need the owner (`hub/auth.py`).
- Both confirm through a sheet that names the repo, the PR's title, its head commit, and what will run.
- They are never palette actions and never buttons on a notification, the same rule as A12's Start a staged lab print.

**D8 The agent follows the sessions' rules.**
- **Before a Ship:** it runs the deploy preflight (`deploy_state` for the target) and refuses on a blocker.
- **Before acting:** it asks the running Claude sessions (`ListAgents`, then a message) whether one is working the same
  PR or target, and waits for their replies.
- **After acting:** it tells them in one line what changed.
- A peer's reply is information and never replaces the owner's tap.

## Baseline changes

- **§6.3 table:** a new row, "Merge or ship a PR: the Mac terminal today; target: Pi Hub's Needs you, carried out by the
  Mac's `pr-agent` (A13)".
- **Records table:** `pr` (published by `pr-agent`; Pi Hub holds the latest list, keyed by repo and number) and
  `pr_request` (owned by Pi Hub's queue; the agent applies it and owns the result), schema `pr-request.v1`.
- **Auth:** the Mac key's exempt paths gain `/api/prs/`. Ship and Merge are owner actions that confirm.
- **Phrases:** appliance-ui adds `pr_waiting`, `pr_request_failed` and `pr_mac_away`.
- **Migration sequence:** a new step, independent of the others: kit phrases, Pi Hub's records and sheet, then the
  Mac's `pr-agent`, then live acceptance.
- **Amendments list:** A13 added.

## Acceptance (for the plan to carry)

- From the iPhone, while away from the Mac:
  - one Local AI PR shipped and its release seen live on Versions;
  - one PR in another repo merged.
- Three refusals, each seen with its reason: a PR whose head moved after the tap, a PR whose checks were red, and a
  request made while the Mac slept that shows "waiting for the Mac" and then expires or runs once the Mac wakes.

## Out of scope

- Opening, editing or commenting on PRs from Pi Hub, beyond D5's note.
- Deploying Pi Hub, the display firmware, or netmon from Pi Hub.
- Repos outside the home platform.
- The Forgejo question (D9), which A13 doesn't settle: the agent is the one place that talks to the forge.
