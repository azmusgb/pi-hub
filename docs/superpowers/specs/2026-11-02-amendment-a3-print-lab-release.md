# Amendment A3: print-lab gets a `release:` record, so step 5's gate can be met

Date: 2026-11-02 · Status: **approved**, option 1 (#57, merged 2 November 2026) · Amends: the platform
baseline (`2026-11-01-platform-product-architecture-design.md`, section 4's `release:<target>` list) and amendment A2.

## Why

A2 says step 5 waits until "Pi Hub, LocalAI and the sending Mac agents (print-lab and mac-watch) publish
`release:<target>` records". Section 4 lists the release targets as pi-hub, localai, netmon, firmware and the Mac agents,
and step 3 built those six (pi-hub, localai, firmware, netmon, mac-watch, x2d-bridge-mac). print-lab is not among them,
so A2's gate cannot be met as written.

A2's reason applies to print-lab: once Pi Hub is the only sender, a missing lab notification is diagnosed by asking
what each sender runs. print-lab's Mac agent (`com.printlab.pull`) runs `uv run --project ~/dev/print-lab lab pull`
straight from the working checkout. There is no install step, so what it runs is whatever that checkout holds,
uncommitted changes included. Today nothing records that.

## Options

1. **Add `print-lab` as a release target (recommended).** `lab pull` reports `release:print-lab` itself whenever the
   checkout's commit, or whether it has uncommitted changes, differs from what it last reported. That's a "deploy" for
   a checkout-run agent. It queues through mac-watch's outbox with the `mac` deploy key, the same path the other two
   Mac agents use (LocalAI #461). Mechanism: `lab-pull`. A dirty checkout shows "+ local changes" on Versions (#55).
   Cost: one Pi Hub change (the target, the mechanism, the `mac` key's targets) and one print-lab change.
2. **Drop print-lab from A2's gate.** Step 5 waits only on Pi Hub, LocalAI and mac-watch. print-lab's pushes move with
   no record of what it runs. That's cheaper, but it leaves the failure A2 names, "a silent sender looks the same as a
   quiet one", open for the lab.

## Change (option 1)

- Section 4, `release:<target>`: "for pi-hub, localai, netmon, firmware, **print-lab** and the Mac agents". For
  print-lab, the deploy is its checkout changing; `lab pull` writes the record.
- A2, "After 3": unchanged in meaning; print-lab now has a target that can meet it.
- Section 11, step 3's order: "… netmon and the Mac agents (mac-watch, x2d-bridge-mac, then print-lab), one at a time."

Nothing else changes. D1, D7 and the ownership model stay as they are: the target's own mechanism writes the record,
Pi Hub owns it, and probes only verify.

## Acceptance (for this amendment)

- Section 4 and section 11 read as above, and `## Amendments` names A3 with the option chosen.
- If option 2 is chosen instead, A2's "After 3" sentence drops print-lab, and nothing else changes.
