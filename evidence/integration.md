# Integration run: Pi Hub (this branch) against real Local AI fcc93128

Stack: Local AI (loopback, throwaway data, MODEL=qwen3:8b, real Ollama 127.0.0.1:11434, LOCALAI_SIGN_IN=required) behind a throwaway-CA TLS proxy that adds X-Forwarded-For 127.0.0.9; Pi Hub from this worktree as owner.

## 1. Status and models live
```
$ GET /api/ai/status (owner, Pi Hub -> real Local AI)
{"state":"live","fetched_at":1795582471,"mirror":false,"data":{"as_of":"2026-11-25T04:54:31.033Z","contract_version":1,"sources":{"services":{"state":"ok","checked_at":"2026-11-25T04:54:30.421Z"},"gridcraft":{"state":"failed","checked_at":"2026-11-25T04:54:30.418Z","error":"GridCraft bridge unavailable (ENOTFOUND)"},"artcraft":{"state":"failed","checked_at":"2026-11-25T04:54:30.419Z","error":"Windows computer bridge unavailable (ENOTFOUND)"},"workshop":{"state":"ok","checked_at":"2026-11-25T04:54:31.033Z"},"watch":{"state":"ok","checked_at":"2026-11-25T04:54:30.412Z"}},"overall":"DOWN","services":[{"name":"ollama","label":"Intelligence","required":true,"state":"HEALTHY","statusCode":200,"latencyMs":12,"checkedAt":"2026-11-25T04:54:30.421Z","availability":"available","displayState":"HEALTHY","severity":"ok","impact":"Ready"},{"name":"comfy","label":"Image generation","required":true,"state":"DOWN","statusCode":null,"latencyMs":4,"error":"fetch failed","checkedAt":"2026-11-25T04:54:30.414Z","availability":"unavailable","displayState":"DOWN","severity":"critical","impact":"Images are unavailable."},{"name":"n8n","label":"Automation engine","required":true,"state":"DOWN","statusCode":null,"latencyMs":4,"error":"fetch failed","checkedAt":"2026-11-25T04:54:30.414Z","availability":"unavailable","displayState":"DOWN","severity":"critical","impact":"Workflows and scheduled automations are paused."},{"name":"proxy","label":"Conversation compatibility","required":true,"state":"DOWN","statusCode":null,"latencyMs":5,"error":"fetch failed","checkedAt":"2026-11-25T04:54:30.415Z","availability":"unavailable","displayState":"DOWN","severity":"critical","impact":"Apps that talk to Local AI through its compatible endpoint are cut off."},{"name":"search","label":"Web research","required":true,"state":"DOWN","statusCode":null,"latencyMs":6,"error":"fetch failed","checkedAt":"2026-11-25T04:54:30.416Z","availability":"unavailable","displayState":"DOWN","severity":"critical","impact":"Research and current facts are unavailable."},{"name":"home","label":"Companion home","required":false,"state":"DOWN","statusCode":null,"latencyMs":3,"error":"fetch failed","checkedAt":"2026-11-25T04:54:30.413Z","availability":"unavailable","displayState":"OPTIONAL_OFFLINE","severity":"info","impact":"Core appliance unaffected"},{"name":"dsh","label":"Developer assistant","required":false,"state":"DOWN","statusCode":null,"latencyMs":2,"error":"fetch failed","checkedAt":"2026-11-25T04:54:30.413Z","av```
```
$ GET /api/ai/models (owner)
{"state":"live","fetched_at":1795582471,"mirror":false,"data":{"as_of":"2026-11-25T04:54:31.092Z","contract_version":1,"sources":{"installed":{"state":"ok","checked_at":"2026-11-25T04:54:31.091Z"},"loaded":{"state":"ok","checked_at":"2026-11-25T04:54:31.092Z"},"pulls":{"state":"ok","checked_at":"2026-11-25T04:54:31.087Z"},"routing":{"state":"ok","checked_at":"2026-11-25T04:54:31.087Z"}},"default":"qwen3:8b","protectedModels":["qwen3:8b","qwen3:4b-instruct"],"installed":[{"name":"qwen3:8b","digest":"500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41","sizeBytes":5225388164,"modifiedAt":"2026-11-10T23:23:15.674390894-05:00","details":{"format":"gguf","family":"qwen3","families":["qwen3"],"parameterSize":"8.2B","quantizationLevel":"Q4_K_M"}}],"loaded":[{"name":"qwen3:8b","model":"qwen3:8b","digest":"500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41","sizeBytes":6194766806,"sizeVramBytes":6194766806,"contextLength":8192,"expiresAt":"2026-11-25T00:21:06.654564-05:00","details":{"format":"gguf","family":"qwen3","families":["qwen3"],"parameterSize":"8.2B","quantizationLevel":"Q4_K_M"}}],"defaultInstalled":true,"defaultLoaded":true,"pulls":[],"routing":{"cloud":false,"providers":{"groq":{"name":"Groq","key":false,"today":0,"parkedUntil":null,"lastError":null},"cerebras":{"name":"Cerebras","key":false,"today":0,"parkedUntil":null,"lastError":null}},"table":[{"kind":"quick","label":"Quick jobs: titles, intent, voice, image prompts","where":"Always on this PC","cloud":false},{"kind":"chat","label":"Ask: on this PC unless you choose \"Use a bigger model\"","where":"On this PC, unless you tap \"Use a bigger model\" and it isn't private","cloud":true},{"kind":"research","label":"Research about public topics","where":"A cloud model when it isn't private, else this PC","cloud":true},{"kind":"plan","label":"Change planning and mission summaries","where":"A cloud model for Local AI's own code when it isn't private, else this PC","cloud":true},{"kind":"code","label":"Code changes to Local AI's own code","where":"A cloud code model for Local AI's own code when it isn't private, else this PC","cloud":true},{"kind":"mission","label":"Mission steps","where":"Always on this PC","cloud":false}]}}}
HTTP 200
```
### Local AI with OLLAMA_URL at a dead port (second Local AI 38072, second Pi Hub 38801)
```
$ GET /api/ai/models (dead Ollama)
{"state":"live","fetched_at":1795582483,"mirror":false,"data":{"as_of":"2026-11-25T04:54:43.750Z","contract_version":1,"sources":{"installed":{"state":"failed","checked_at":"2026-11-25T04:54:43.750Z","error":"fetch failed"},"loaded":{"state":"failed","checked_at":"2026-11-25T04:54:43.750Z","error":"fetch failed"},"pulls":{"state":"ok","checked_at":"2026-11-25T04:54:43.750Z"},"routing":{"state":"ok","checked_at":"2026-11-25T04:54:43.750Z"}},"default":"qwen3:8b","protectedModels":["qwen3:8b","qwen3:4b-instruct"],"installed":null,"loaded":null,"defaultInstalled":null,"defaultLoaded":null,"pulls":[],"routing":{"cloud":false,"providers":{"groq":{"name":"Groq","key":false,"today":0,"parkedUntil":null,"lastError":null},"cerebras":{"name":"Cerebras","key":false,"today":0,"parkedUntil":null,"lastError":null}},"table":[{"kind":"quick","label":"Quick jobs: titles, intent, voice, image prompts","where":"Always on this PC","cloud":false},{"kind":"chat","label":"Ask: on this PC unless you choose \"Use a bigger model\"","where":"On this PC, unless you tap \"Use a bigger model\" and it isn't private","cloud":true},{"kind":"research","label":"Research about public topics","where":"A cloud model when it isn't private, else this PC","cloud":true},{"kind":"plan","label":"Change planning and mission summaries","where":"A cloud model for Local AI's own code when it isn't private, else this PC","cloud":true},{"kind":"code","label":"Code changes to Local AI's own code","where":"A cloud code model for Local AI's own code when it isn't private, else this PC","cloud":true},{"kind":"mission","label":"Mission steps","where":"Always on this PC","cloud":false}]}}}
HTTP 200
```
```
$ GET /api/ai/status (dead Ollama), cut
live overall= DOWN
{'services': ('ok', None), 'gridcraft': ('failed', 'GridCraft bridge unavailable (ENOTFOUND)'), 'artcraft': ('failed', 'Windows computer bridge unavailable (ENOTFOUND)'), 'workshop': ('ok', None), 'watch': ('ok', None)}
HTTP  200

```

### Mirror after Local AI is stopped (Local AI 38071 killed)
```
$ GET /api/ai/status (Local AI stopped; first read after the stop)
{'state': 'mirror', 'fetched_at': 1795582492, 'why': 'unreachable', 'mirror': True, 'stored_at': 1795582471, 'age': 21}
as_of 2026-11-25T04:54:31.033Z sources ['services', 'gridcraft', 'artcraft', 'workshop', 'watch']
HTTP  200

```
```
$ GET /api/ai/models (second read, 3 s later)
{'state': 'mirror', 'fetched_at': 1795582495, 'why': 'unreachable', 'mirror': True, 'stored_at': 1795582471, 'age': 24}
HTTP  200

```

## 2. Submit a Mission through Pi Hub (restarted Local AI 38071; mirror step above passed)
```
$ POST /api/ai/tasks
{"state":"submitted","fetched_at":1795582537,"runId":"run-1795582537564-000c231","threadId":"run-1795582537564-000c231"}
HTTP 202
```
```
$ Local AI directly: GET /api/runs?id=run-1795582537564-000c231
{"item":{"id":"run-1795582537564-000c231","projectId":null,"threadId":"run-1795582537564-000c231","pinned":false,"type":"agent","title":"In two sentences, why do heat pumps work in winter?","status":"running","progress":33,"createdAt":"2026-11-25T04:55:37.564Z","startedAt":"2026-11-25T04:55:37.565Z","updatedAt":"2026-11-25T04:55:37.577Z","finishedAt":null,"summary":"","input":{"goal":"In two sentences, why do heat pumps work in winter?","projectId":"","agentIds":[],"webSearch":false},"output":null,"error":null,"artifactIds":[],"source":null,"meta":{"missionId":"mission-mwvnhd2g-288ca1"},"cancellable":true,"attempt":1,"retryOf":null,"events":[{"at":"2026-11-25T04:55:37.564Z","status":"queued","detail":"Run queued"},{"at":"2026-11-25T04:55:37.565Z","status":"running","detail":"Mission started"},{"at":"2026-11-25T04:55:37.576Z","status":"running","detail":"Mission created"},{"at":"2026-11-25T04:55:37.577Z","status":"running","detail":"Mission progress: 1 of 3 steps"}],"retryable":false,"card":{"kind":"agent","icon":"automate","title":"In two sentences, why do heat pumps work in winter?","summary":"","badge":{"label":"Running","tone":"accent"},"preview":{"type":"mission","text":""},"action":{"label":"Open"},"approval":null,"view":"agents","route":null,"memory":null,"facts":null}}}
HTTP 200
```

## 3. Follow: Pi Hub follow reply and Local AI run, sampled over time
Samples (t = seconds after submit; every reply state ok, progress 33, router complete, UX Analyst running, Coordinator pending) until completion about 130 s later:
```
t=5s
{"id": "run-1795582537564-000c231", "status": "running", "progress": 33, "summary": "", "error": null, "cancellable": true, "createdAt": "2026-11-25T04:55:37.564Z", "startedAt": "2026-11-25T04:55:37.565Z", "updatedAt": "2026-11-25T04:55:37.577Z", "finishedAt": null, "missionId": "mission-mwvnhd2g-288ca1", "outcome": null}
t=10s
{"id": "run-1795582537564-000c231", "status": "running", "progress": 33, "summary": "", "error": null, "cancellable": true, "createdAt": "2026-11-25T04:55:37.564Z", "startedAt": "2026-11-25T04:55:37.565Z", "updatedAt": "2026-11-25T04:55:37.577Z", "finishedAt": null, "missionId": "mission-mwvnhd2g-288ca1", "outcome": null}
t=15s
{"id": "run-1795582537564-000c231", "status": "running", "progress": 33, "summary": "", "error": null, "cancellable": true, "createdAt": "2026-11-25T04:55:37.564Z", "startedAt": "2026-11-25T04:55:37.565Z", "updatedAt": "2026-11-25T04:55:37.577Z", "finishedAt": null, "missionId": "mission-mwvnhd2g-288ca1", "outcome": null}
t=20s
{"id": "run-1795582537564-000c231", "status": "running", "progress": 33, "summary": "", "error": null, "cancellable": true, "createdAt": "2026-11-25T04:55:37.564Z", "startedAt": "2026-11-25T04:55:37.565Z", "updatedAt": "2026-11-25T04:55:37.577Z", "finishedAt": null, "missionId": "mission-mwvnhd2g-288ca1", "outcome": null}
```
```
$ GET /api/ai/tasks/run-1795582537564-000c231 mid-run
(worker line above: router complete, ux_analyst running, synthesis pending; mission_read ok)
```
```
$ GET /api/ai/tasks/run-1795582537564-000c231 after completion
{"state":"ok","fetched_at":1795582679,"run":{"id":"run-1795582537564-000c231","status":"completed","progress":100,"summary":"Heat pumps work in winter by reversing the refrigeration cycle to extract heat from outdoor air, even at low temperatures, using a refrigerant that absorbs thermal energy. This process transfers heat indoors via a heat exchanger, relying on refrigerant phase changes and thermodynamic principles. - The project evidence contains no technical details about heat pumps, thermodynamics, or HVAC systems [E-7e4c64cce4eb9c58][E-e01f88a8c75521ad]. - `find_in_project(\"heat pump\")` returns no matches (search evidence ID:). - The term \"heat\" in the project refers only to UI styling (e.g., `.claude-matrix .","error":null,"cancellable":false,"createdAt":"2026-11-25T04:55:37.564Z","startedAt":"2026-11-25T04:55:37.565Z","updatedAt":"2026-11-25T04:57:47.516Z","finishedAt":"2026-11-25T04:57:47.516Z","missionId":"mission-mwvnhd2g-288ca1","outcome":"complete"},"mission":{"workers":[{"id":"router","name":"Mission Router","state":"complete","model":"","error":null},{"id":"ux_analyst","name":"UX Analyst","state":"complete","model":"qwen3:8b","error":null},{"id":"synthesis","name":"Coordinator","state":"complete","model":"","error":null}],"answer":"Heat pumps work in winter by reversing the refrigeration cycle to extract heat from outdoor air, even at low temperatures, using a refrigerant that absorbs thermal energy. This process transfers heat indoors via a heat exchanger, relying on refrigerant phase changes and thermodynamic principles.\n\n- The project evidence contains no technical details about heat pumps, thermodynamics, or HVAC systems [E-7e4c64cce4eb9c58][E-e01f88a8c75521ad].\n- `find_in_project(\"heat pump\")` returns no matches (search evidence ID:).\n- The term \"heat\" in the project refers only to UI styling (e.g., `.claude-matrix .heat`) [E-e01f88a8c75521ad].\nNot checked:\n- Whether refrigerant phase changes or thermodynamic laws are documented in external technical sources.\n- How the refrigeration cycle is implemented in HVAC systems outside the project’s scope."},"mission_read":"ok"}
HTTP 200
```
```
$ Local AI directly: run status after completion
completed 100 {'missionId': 'mission-mwvnhd2g-288ca1', 'route': {'provider': 'ollama', 'model': 'qwen3:8b', 'class': 'shareable', 'why': 'Cloud models are switched off'}}
['Run queued', 'Mission started', 'Mission created', 'Mission progress: 1 of 3 steps', 'Mission progress: 2 of 3 steps', 'Run completed']
```
Finding: the real run and mission shapes match the adapter (worker state complete, run status completed, outcome complete). Pi Hub's follow reply does not carry the run's events array (the page draws workers and progress); noted, not a defect.

## 4. Navigate away and return
Run run-1795582688708-000116c loaded in a fresh Chromium context (cookie only, no local state) mid-run: page showed Running, '1 of 3 steps', Cancel the task, steps Mission Router Done / Documentation Agent qwen3:8b Running / Coordinator Waiting. Run run-1795582537564-000c231 loaded in a new context after completion: Done, Finished, the Answer drawn as text, three Done steps. Screenshots: tests/browser/out/live-local/run-mid-390-light.png and run-completed-390-light.png.

## 6a/7 Submit failures through Pi Hub and directly
```
$ Pi Hub POST /api/ai/tasks, empty goal
{"state":"refused","fetched_at":1795582804,"error":"Say what the task is."}
HTTP 400
```
```
$ Local AI direct, unknown model: POST /api/agents/missions/start workerModel nope:1b
{"error":"Unknown model \"nope:1b\". Installed: qwen3:8b","code":"UNKNOWN_MODEL","installed":["qwen3:8b"]}
HTTP 400
```
```
$ Local AI direct, unknown model name via model field
{"runId":"run-1795582805102-0002950","threadId":"run-1795582805102-0002950"}
HTTP 202
```

(The second direct call above used a field Local AI ignores, so it started a real run run-1795582805102-0002950 for goal 'hi'; used below for the cancel step.)

## 8. Cancel mid-run
Ollama before cancel: [('qwen3:8b', '2026-11-25T00:30:24.06075-05:00')]; Ollama CPU: 55.6% 2.2% 0.5% 0.0% 0.0% 0.0% 
```
$ Pi Hub follow before cancel
{"state":"ok","fetched_at":1795582824,"run":{"id":"run-1795582805102-0002950","status":"running","progress":33,"summary":"","error":null,"cancellable":true,"createdAt":"2026-11-25T05:00:05.102Z","startedAt":"2026-11-25T05:00:05.106Z","updatedAt":"2026-11-25T05:00:05.132Z","finishedAt":null,"missionId":"mission-mwvnn3ig-55348c","outcome":null},"mission":{"workers":[{"id":"router","name":"Mission Router","state":"complete","model":"","error":null},{"id":"ux_analyst","name":"UX Analyst","state":"ru```
```
$ Pi Hub POST cancel
{"state":"ok","fetched_at":1795582824,"run":{"id":"run-1795582805102-0002950","status":"cancelled","progress":33,"summary":"","error":"Cancelled by user","cancellable":false,"createdAt":"2026-11-25T05:00:05.102Z","startedAt":"2026-11-25T05:00:05.106Z","updatedAt":"2026-11-25T05:00:24.361Z","finishedAt":"2026-11-25T05:00:24.361Z","missionId":"mission-mwvnn3ig-55348c","outcome":null}}
HTTP 200
```
```
$ Local AI direct run after cancel
cancelled False Cancelled by user
['Run queued', 'Mission started', 'Mission created', 'Mission progress: 1 of 3 steps', 'Cancelled by user']
```
```
$ cancel again (already cancelled)
{"state":"not_cancellable","fetched_at":1795582828,"error":"This run is not cancellable"}
HTTP 409
```
```
$ cancel a finished run (run 1)
{"state":"not_cancellable","fetched_at":1795582828,"error":"This run is not cancellable"}
HTTP 409
```
```
$ cancel an unknown run id
{"state":"not_found","fetched_at":1795582828,"error":"Run not found or is managed by a legacy executor"}
HTTP 404
```
Ollama CPU after cancel, every 5 s:
```
t+5s cpu: 0.4% 0.4% 0.0% 0.0% 0.0% 0.0% 0.0% 
t+10s cpu: 0.4% 0.3% 0.3% 0.0% 0.0% 0.0% 0.0% 
t+15s cpu: 0.4% 0.0% 0.0% 0.0% 0.0% 0.0% 0.0% 
t+20s cpu: 0.7% 0.5% 0.4% 0.3% 0.0% 0.0% 0.0% 
```

## 7b Real mid-run failure (Local AI 38072 whose Ollama is a dead port, through Pi Hub 38801)
```
$ Pi Hub POST /api/ai/tasks (dead-Ollama Local AI)
{"state":"submitted","fetched_at":1795582861,"runId":"run-1795582861708-0003c8f","threadId":"run-1795582861708-0003c8f"}
HTTP 202
```
```
$ Pi Hub follow, terminal
{"state":"ok","fetched_at":1795582861,"run":{"id":"run-1795582861708-0003c8f","status":"failed","progress":5,"summary":"","error":"fetch failed","cancellable":false,"createdAt":"2026-11-25T05:01:01.707Z","startedAt":"2026-11-25T05:01:01.711Z","updatedAt":"2026-11-25T05:01:01.713Z","finishedAt":"2026-11-25T05:01:01.713Z","missionId":null,"outcome":null},"mission":null,"mission_read":"none"}
HTTP 200
```
```
$ Local AI direct (38944) run
failed 5 'fetch failed'
['Run queued', 'Mission started', 'Run failed']
```
The dead-Ollama run failed at once (before a mission existed) with Local AI's own error 'fetch failed'; the other real failure, a mission interrupted by a Local AI restart mid-run (step 5), shows a failed mission with per-step errors.

## 9. Authorization
### Local AI directly with the hub key (LOCALAI_SIGN_IN=required; the TLS front adds X-Forwarded-For so the caller is not 'host')
```
hub key GET  /api/contract/status                              -> HTTP 200 {"as_of":"2026-11-25T05:01:34.642Z","contract_version":1,"sources":{"services":{"state":"ok","checked_at":"202
hub key GET  /api/contract/models                              -> HTTP 200 {"as_of":"2026-11-25T05:01:34.686Z","contract_version":1,"sources":{"installed":{"state":"ok","checked_at":"20
hub key GET  /api/runs?id=<run>                                -> HTTP 200 {"item":{"id":"run-1795582537564-000c231","projectId":null,"threadId":"run-1795582537564-000c231","pinned":fal
hub key GET  /api/agents/mission?id=<mission>                  -> HTTP 200 {"mission":{"id":"mission-mwvnhd2g-288ca1","goal":"In two sentences, why do heat pumps work in winter?","proje
hub key POST /api/runs/cancel (unknown id)                     -> HTTP 404 {"error":"Run not found or is managed by a legacy executor"}
hub key POST /api/agents/missions/start (empty goal)           -> HTTP 400 {"error":"goal is required"}
hub key POST /api/runs/retry                                   -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key POST /api/agents/run                                   -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key POST /api/chat/stream                                  -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key POST /api/models/pull                                  -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key GET  /api/powershell/status                            -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key POST /api/powershell/run                               -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key GET  /api/runs (list, no id)                           -> HTTP 200 {"items":[{"id":"run-1795582880053-000acfe","projectId":null,"threadId":"run-1795582880053-000acfe","pinned":f
hub key GET  /api/status (not on the list)                     -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
hub key GET  /api/settings                                     -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
no key  GET  /api/contract/status                              -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
wrong key GET /api/contract/status                             -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
no key  POST /api/agents/missions/start                        -> HTTP 401 {"error":"Sign in on this device first: pair it under Improve › Claude Code.","signIn":true}
```

### Through Pi Hub (38800)
```
no cookie GET /api/ai/status                                           -> 401 {"detail":"Sign in as the owner first."}
gate-role cookie GET /api/ai/status                                    -> 401 {"detail":"Sign in as the owner first."}
no cookie GET /api/ai/models                                           -> 401 {"detail":"Sign in as the owner first."}
gate-role cookie GET /api/ai/models                                    -> 401 {"detail":"Sign in as the owner first."}
no cookie GET /api/ai/tasks/run-1795582537564-000c231                  -> 401 {"detail":"Sign in as the owner first."}
gate-role cookie GET /api/ai/tasks/run-1795582537564-000c231           -> 401 {"detail":"Sign in as the owner first."}
no cookie POST /api/ai/tasks                                           -> 401 {"detail":"Sign in as the owner first."}
gate-role POST /api/ai/tasks                                           -> 401 {"detail":"Sign in as the owner first."}
no cookie POST /api/ai/tasks/<id>/cancel                               -> 401 {"detail":"Sign in as the owner first."}
gate-role POST /api/ai/tasks/<id>/cancel                               -> 401 {"detail":"Sign in as the owner first."}
owner POST tasks, cross-origin Origin                                  -> 403 {"error":"This change has to come from the hub's own page."}
owner POST tasks, no Origin                                            -> 403 {"error":"This change has to come from the hub's own page."}
owner POST tasks, text/plain body                                      -> 415 {"detail":"Send JSON."}
browser header X-LocalAI-Hub-Key: bogus + X-Hub-Owner: 1, no cookie    -> 401 {"detail":"Sign in as the owner first."}
same headers WITH gate cookie                                          -> 401 {"detail":"Sign in as the owner first."}
owner + bogus X-LocalAI-Hub-Key (hub's own key must still be used)     -> 200 {"state":"live","fetched_at":1795582912,"mirror":false,"data":{"as_of":"2026-11-25T05:01:5
owner GET /api/ai/chat (outside allow-list)                            -> 404 {"detail":"Not Found"}
owner GET /api/ai/runs (list)                                          -> 404 {"detail":"Not Found"}
owner GET /api/ai/powershell/run                                       -> 404 {"detail":"Not Found"}
owner POST /api/ai/models/pull                                         -> 405 {"detail":"Method Not Allowed"}
owner GET tasks/../status                                              -> 404 {"detail":"Not Found"}
owner GET tasks/%2e%2e%2fstatus                                        -> 404 {"detail":"Not Found"}
owner GET tasks/run-1795582537564-000c231%2f..%2fsettings              -> 404 {"detail":"Not Found"}
owner GET tasks/<id>?id=other (query smuggle)                          -> 200 {"state":"ok","fetched_at":1795582912,"run":{"id":"run-1795582537564-000c231","status":"co
owner GET tasks/<id>&x                                                 -> 400 {"detail":"That isn't a task id."}
owner GET tasks/ (empty id)                                            -> 404 {"detail":"Not Found"}
owner GET tasks/<300 chars>                                            -> 400 {"detail":"That isn't a task id."}
owner GET tasks/run-1 (bad shape)                                      -> 200 {"state":"not_found","fetched_at":1795582912,"error":"Run not found"}
owner GET tasks/<id>%00                                                -> 400 {"detail":"That isn't a task id."}
owner POST cancel tasks/..%2f..%2fapi%2fruns%2fretry                   -> 405 {"detail":"Method Not Allowed"}
owner POST tasks projectId=../x                                        -> 400 {"state":"refused","fetched_at":1795582912,"error":"That isn't a project id."}
```

## 5. Reconnect (run run-1795582688708-000116c, real Local AI killed with kill -9 mid-run, then restarted on the same data dir)
- While down: Pi Hub follow reply {"state":"unreachable","why":"unreachable"}; the page says "Can't reach the Assistant. The task may still be running; not seen from this browser yet. Trying again." with state "Can't reach it". Not Failed.
- After restart (about 35 s later): Local AI ledger says status failed, progress 33, error "Run interrupted by appliance restart"; events end "Run interrupted by appliance restart". Mission workers: Mission Router complete, Documentation Agent error ("Local AI restarted for an update while this was running"), Coordinator blocked (same text).
- The page shows Failed, "The task failed / Run interrupted by appliance restart", steps Done / Failed / Skipped, and Start a new task.
- Defect found and fixed (commit 4a520cd): the page drew the raw words "error" and "blocked" for those steps; now Failed and Skipped (regression test in tests/test_assistant_native.mjs).

## 6. Result drawn as text
Run run-1795582537564-000c231: the completed answer is drawn as text (bullets and 'Not checked:' lines shown as plain text; see step 4 output). Run run-1795582880053-000acfe: goal was '<script>window.__pwn=1</script> **bold** # Heading <img src=x onerror=window.__pwn=2>'; Local AI echoed it in summary and answer. Page text shows the literal tags; in the page: window.__pwn=null, #view script=0, img=0, [onerror]=0.
```
INJECT {"pwn":null,"scripts":0,"imgs":0,"onerror":0}
```

### Findings from this step: Local AI's hub key also reaches GET /api/runs with no id (the run list, with each run's input.goal). Pi Hub never calls it (route requires an id; /api/ai/runs is 404), so no Pi Hub change; reported for Local AI.


## D. live-local screenshots (Playwright, tests/browser/live-local.mjs, real local stack)
In tests/browser/out/live-local/ (untracked), 390x844 and 1366x900, light and dark each: assistant-start-a-task, task-running, task-completed, task-failed (no mission, "fetch failed"), task-failed-restart (mission interrupted), task-cancelled, task-unreachable. Also 390 light only: run-mid, run-after-restart, run-cancelled, run-completed, run-injection, run-failed-nomission, run-unreachable.
