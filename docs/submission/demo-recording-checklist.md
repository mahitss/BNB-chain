# Demo Recording Checklist

Complete every item before recording. Do not check an item without verifying.

## Environment

- [ ] Browser window clean — no unrelated tabs, bookmarks bar hidden
- [ ] No personal information visible (name, email, bookmarks, history dropdowns)
- [ ] No API keys or secrets visible anywhere on screen (check env vars, open editors)
- [ ] No terminal with secrets in scrollback; clear before recording
- [ ] Production/dev URL tested and reachable (http://localhost:3000)
- [ ] Correct network displayed (BSC / chain 56 in UI and docs)
- [ ] Wallet connected if demonstrating wallet features (otherwise show the setup state deliberately)
- [ ] All services started: API, agent, risk engine, execution, PostgreSQL, frontend

## Content pre-flight

- [ ] Market page loaded with real data (or the honest empty/setup state is intentional)
- [ ] Opportunity page tested (signals or empty state with explanation)
- [ ] Strategy builder tested (parse or ADVANCED mode; clarification path known)
- [ ] Simulation flow tested (or the honest blocked state shown deliberately)
- [ ] Authorization flow tested
- [ ] Audit trail / activity timeline populated or its empty state explained
- [ ] Portfolio page state decided (wallet connected vs setup state)
- [ ] No console errors (DevTools clear before recording)
- [ ] No broken links (click through all nav items once)

## Recording quality

- [ ] Microphone tested (level, no background noise)
- [ ] Screen resolution tested (1920×1080 recommended; no scaling artifacts)
- [ ] Dark theme consistent; font size readable in recording
- [ ] Cursor/typing visible and steady; no accidental double-clicks
- [ ] Timer/script visible on second monitor if using docs/demo-script.md

## Content honesty

- [ ] No state narrated as "executed"/"confirmed" unless the API shows it
- [ ] No fabricated data, hashes, balances, or PnL
- [ ] Setup/empty states presented as intentional design (they are)
- [ ] Kill switch / security messaging shown at least once
