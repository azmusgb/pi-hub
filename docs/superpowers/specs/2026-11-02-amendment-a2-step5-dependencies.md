# Amendment A2: Step 5 waits on an accepted step 2 and on step 3

Date: 2026-11-02 · Status: proposed, for the owner's review. Merging this amendment approves it. · Amends: the
platform baseline (`2026-11-01-platform-product-architecture-design.md`, section 11, step 5). Documentation only.

## Why

Section 11 says step 5 (pushes onto Pi Hub) comes "after 2". On 2 Nov 2026, while reviewing roadmap answers, the owner
ruled that step 5 waits on **both** step 2, accepted, **and** step 3. That ruling conflicts with the frozen text.
Until an amendment adopts it, the frozen text governs, so this amendment exists to make the ruling the baseline.

Step 5 makes Pi Hub the only sender for LocalAI, print-lab and mac-watch. Two things must hold before that:

- **The outage path must be proven, not just deployed.** Once Pi Hub is the only sender, the D2 outside alarm is the
  only thing that reports Pi Hub being down. The D2 code is live (#34, #35, #36). Its acceptance test
  (`docs/operations.md`, "Outside heartbeat", acceptance test) has not been recorded.
- **Every sender's deployed version must be readable.** When pushes from three senders go through one channel, a
  missing or wrong notification is diagnosed by asking what each sender is running. Step 3's `release:<target>`
  records and System › Versions are the one place that answers that (D1 + D7 amendment). Without them, a silent sender
  looks the same as a quiet one.

## Change

Section 11, step 5 changes:

- **From:** "5. **Pushes onto Pi Hub (D2), after 2.**"
- **To:** "5. **Pushes onto Pi Hub (D2), after 2 is accepted and after 3** (amendment A2)."

"Step 2 is accepted" means its acceptance test has been run and recorded:
1. `home-platform-alive` shows Up, with a recent ping.
2. Only `pi-hub-heartbeat.timer` is stopped, while Pi Hub, Caddy, the network and the database stay healthy.
3. The check goes Late, then Down, and the external alert arrives.
4. The timer is restarted, and the check returns to Up with the recovery notice.

"After 3" means Pi Hub, LocalAI and the sending Mac agents (print-lab and mac-watch) publish `release:<target>`
records. These are the targets whose senders step 5 moves.

Nothing else in the step changes. LocalAI's Web Push still retires once ntfy is seen delivering the Assistant's
events.

## Fit with the baseline

- **D2 is unchanged.** One phone channel, plus the failure-independent path. Only the order of the move changes.
- **Steps 3, 4, 6, 7 and 10 are unchanged.** Step 3 still does not wait on step 2. Steps 6 and 7 stay independent.
- **A1 is unaffected.** It is neither a gate for step 5 nor gated by it.
- **The sequence's shape:** step 5 moves from the line "after 2" to the line after both 2 and 3. That line can start
  when both are met.

## Acceptance (for this amendment)

- Section 11's step 5 reads as above, and the `## Amendments` list names A2.
- No other baseline text changes.
