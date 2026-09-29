# Gamma AI — Presentation Generation Prompt

> **How to use this file**
>
> 1. Go to **gamma.app** → **Create new** → **Generate**
> 2. Choose **Presentation** (not Document or Webpage)
> 3. Set **Number of cards: 24**
> 4. Set **Text amount: Medium** (Detailed makes slides too dense to present from)
> 5. Set **Image source: AI images** or **Web images** — either works
> 6. Paste **everything below the line marked `PROMPT STARTS HERE`**
> 7. Pick a theme — recommended: **Oasis**, **Vortex**, **Chisel** or **Night Sky** (dark, high-contrast themes suit an emergency/control-room subject)
>
> **Alternative (gives you more control):** use **Create new → Paste in text**, paste the same content, and set *"Cards: split by `---`"*. Gamma will then follow the slide breaks exactly instead of re-interpreting them.
>
> After generation, delete any slide Gamma invents that isn't in the outline, and check that no statistic was fabricated.

---

# PROMPT STARTS HERE

## ROLE AND GOAL

You are creating a **professional final-year Computer Science and Engineering project presentation** for a university project review panel.

**Project title:** *Intelligent Disaster Monitoring and Emergency Communication Network*

**Format:** PowerPoint-style presentation, **16:9 landscape orientation**, designed to be projected on screen and presented aloud in **12–15 minutes**.

**Audience:** University project guide, an evaluation panel of professors, and fellow engineering students. They are technically literate but are **not** specialists in disaster management. They will judge on: clarity of the problem, rigour of the design decisions, technical depth, and feasibility.

**Presentation stage:** This is a **pre-implementation design review** — the system has been fully designed but not yet built. Use future tense ("the system will…"), never claim results that do not yet exist.

---

## DESIGN AND FORMATTING RULES — FOLLOW STRICTLY

- **Orientation:** 16:9 landscape, PowerPoint-style. Every slide must be projector-legible from the back of a room.
- **Text density:** Maximum **6 bullet points per slide**, maximum **12 words per bullet**. Slides are speaking aids, not documents. If content will not fit, split it across two slides rather than shrinking the font.
- **Headline style:** Every slide title must be a **statement, not a label**. Write "Detection Is Already Solved — Delivery Is Not", never "Problem Statement".
- **Visual priority:** Prefer **tables, comparison layouts, numbered process flows, icon grids, timelines and stat callouts** over plain bullet lists. At least **half of all slides** must use a structured visual layout rather than bullets.
- **Numbers:** Wherever a figure appears (37%, 93%, ₹0, 33 screens, 10 limitations), render it as a **large stat callout**, not buried in body text.
- **Colour language:** Use a consistent severity palette throughout — **red** for problems, hazards and the hardware option's weaknesses; **green** for solutions, advantages and the chosen approach. Dark background with high-contrast text suits the emergency-response subject.
- **Icons:** Use icons liberally — satellite, earthquake, flood, fire, smartphone, map pin, bell/alert, ambulance, shield, database, cloud, wifi-off.
- **Imagery:** Use restrained, professional imagery — control rooms, flood scenes, maps, mobile devices, emergency responders. **Do not use cartoonish, clip-art or overly dramatic disaster imagery.**
- **Speaker notes:** Generate concise speaker notes for **every** slide — 3 to 4 sentences of what the presenter should say aloud, expanding on the slide rather than repeating it.

---

## STRICT CONTENT RULES — DO NOT VIOLATE

1. **This project contains ZERO hardware.** It is entirely software. Never suggest sensors, Arduino, Raspberry Pi or IoT devices as part of the final solution. Hardware appears **only** in the comparison slides, as the approach that was evaluated and **rejected**.
2. **Do not invent statistics.** Use only the figures given in this outline. Never fabricate casualty counts, percentages, dates or citations.
3. **Do not mention team size, number of members, or individual names.**
4. **Do not describe this as a machine learning or AI project.** The intelligence is explicitly **rule-based and explainable**, and this is a deliberate design decision.
5. **Backend language is Node.js with TypeScript.** Never mention Python, FastAPI or Django.
6. **Do not use the words "revolutionary", "cutting-edge", "game-changing"** or similar marketing language. The tone is engineering-serious.

---

## SLIDE-BY-SLIDE OUTLINE

Generate exactly these slides, in this order.

---

### SLIDE 1 — TITLE

**Intelligent Disaster Monitoring and Emergency Communication Network**

Subtitle: *A Fully Software-Based Platform for Multi-Source Hazard Detection, Geofenced Alerting and Real-Time Emergency Coordination*

Include placeholder lines for: Department of Computer Science and Engineering · `[University Name]` · Project Guide: `[Guide Name]` · `[Academic Year]`

Label clearly: **Initial Project Review — Design Phase**

Visual: a dark, atmospheric hero image — a satellite view of a storm system, or an emergency control room.

---

### SLIDE 2 — THE CENTRAL INSIGHT (the hook)

Title: **Disasters Are Not Missed. Warnings Are.**

Content:
- Satellites, seismic networks and weather models **already detect hazards reliably**
- That data is **published openly and free of charge**
- People still die — because detection never becomes a warning the right person actually receives
- The failure is not in **sensing**. It is in **communication, verification and coordination**

Large pull-quote treatment: **"The bottleneck is no longer detection. It is the last mile."**

---

### SLIDE 3 — WHAT GOES WRONG TODAY

Title: **The Same Failures Repeat in Every Disaster**

Present as a 2-column grid of 6 icon cards:
1. **Fragmented data** — hazard information scattered across separate portals, no unified picture
2. **Untargeted alerts** — warnings issued to whole districts; a person 60 km away gets the same message as one 600 m away
3. **No citizen channel** — people see the danger first but can only phone a helpline
4. **Duplicate chaos** — hundreds of calls about one event, with no way to tell one flood from twenty
5. **Manual coordination** — teams dispatched by phone call, tracked on paper
6. **Networks fail** — towers lose power exactly when the disaster peaks

---

### SLIDE 4 — CONSEQUENCE: ALERT FATIGUE

Title: **An Untargeted Warning Trains People to Ignore Warnings**

Content:
- Broad-area broadcasts reach mostly people who are **not** in danger
- Recipients cannot judge whether **they personally** must act
- After enough irrelevant alerts, people stop reading them
- The system then fails **silently** — it appears to work while actually reducing response

Callout: **A system that over-alerts is worse than no system at all.**

---

### SLIDE 5 — WHAT ALREADY EXISTS, AND WHAT IT LEAVES OUT

Title: **Every Existing System Solves Part of the Problem**

Render as a comparison table — Column 1 "System", Column 2 "Does Well", Column 3 "Gap Left":

| System | Does Well | Gap Left |
|---|---|---|
| Meteorological & seismic agencies | Authoritative, calibrated detection | Publishes data, not personalised warnings. No citizen input, no coordination. |
| SMS / cell broadcast alerting | Reaches large populations fast | One-way. Coarse targeting. No verification, no acknowledgement, no coordination. |
| Ushahidi (crowdmapping) | Strong citizen reporting | No automated feed ingestion, no severity engine, no geofenced dispatch. |
| Sahana Eden | Good resource & shelter management | Heavyweight, not real-time-first, weak automated ingestion. |
| Social media | Fast and ubiquitous | Unverified, rumour-prone, not geospatially queryable, no official workflow. |

Closing line: **No single system does all of it. That space is where this project sits.**

---

### SLIDE 6 — PROBLEM STATEMENT

Title: **The Problem, Stated Formally**

Present as a single centred, boxed quotation:

> *Existing disaster management systems suffer from a fragmented, one-directional and untargeted information flow. Hazard data is scattered across isolated sources; warnings are broadcast to broad regions rather than to individuals at risk; citizens hold real-time ground truth but have no structured way to contribute it; response coordination is manual and unauditable; and the entire chain depends on connectivity that fails at the moment of greatest need.*

Below it, one line: **We need a unified, resilient software platform that aggregates, verifies, targets, delivers and coordinates.**

---

### SLIDE 7 — OBJECTIVES

Title: **Eight Objectives**

Numbered grid of 8 short cards:
1. Ingest hazard data from **4+ independent public sources** continuously
2. **Correlate and de-duplicate** related signals into single confidence-scored incidents
3. Resolve **who is inside an alert zone** in under half a second
4. Dispatch **multi-channel alerts** with retry, escalation and delivery tracking
5. Accept citizen emergency reports **even with no network connection**
6. Provide **real-time coordination** — verification, dispatch, hazard-aware routing
7. Enforce **role-based access control** and an immutable audit trail
8. Deploy publicly at **zero recurring cost** and validate against measurable targets

---

### SLIDE 8 — TWO APPROACHES WERE EVALUATED

Title: **Two Ways to Build This. Only One Actually Works.**

Split-screen comparison, two large cards side by side:

**LEFT — Option A: Hardware Sensor Network** (red accent)
Raspberry Pi / ESP32 nodes with physical sensors — water level, rainfall, vibration, smoke, temperature — connected by LoRa or GSM to a cloud server.

**RIGHT — Option B: Software Platform** (green accent)
A cloud-hosted web platform that consumes existing public hazard feeds and crowdsources citizen reports, then verifies, targets, alerts and coordinates.

Footer: *Both were designed in full and compared across 15 weighted criteria.*

---

### SLIDE 9 — OPTION A: THE HARDWARE APPROACH

Title: **Option A — Build a Physical Sensor Network**

Left side — a horizontal flow diagram:
**Physical world → Sensor node (ESP32 / Raspberry Pi) → LoRa / GSM gateway → Cloud server → Dashboard**

Right side — cost table titled *Per Node*:
- Microcontroller / SBC — ₹400 – 5,500
- Ultrasonic water-level sensor — ₹150
- Rain gauge — ₹1,200 – 3,000
- Vibration sensor — ₹200
- Smoke / gas sensor — ₹200
- GPS module — ₹400
- GSM / LoRa module — ₹350 – 900
- Solar panel + battery — ₹1,500 – 3,000
- Weatherproof enclosure — ₹800 – 2,000

Large stat callout: **₹6,000 – ₹15,000 PER NODE**

---

### SLIDE 10 — OPTION A: HONEST ADVANTAGES

Title: **What the Hardware Approach Genuinely Offers**

Green-tinted list of 5 items:
- Produces **original physical measurements** unavailable from any public feed
- **Physically demonstrable** — an examiner can watch a device respond
- Demonstrates embedded systems and IoT protocol skills
- **Hyper-local resolution** no satellite provides
- Can operate **independently of internet infrastructure** via LoRa mesh

Footer note: *These are real strengths. They were weighed seriously before the approach was rejected.*

---

### SLIDE 11 — OPTION A: WHY IT FAILS (Part 1 of 2)

Title: **Ten Reasons the Hardware Approach Cannot Work — 1 to 5**

Red-accented numbered cards, each with a bold heading and one line:

1. **Coverage — fatal.** One sensor monitors one point. A flood covers hundreds of km². A city needs thousands of nodes; a student project can build one to three. The actual system could never be demonstrated.
2. **Cost does not scale.** At ₹6,000–15,000 per node, meaningful coverage costs crores. There is no path from prototype to deployment.
3. **Deployment is legally impossible.** Installing sensors on rivers, bridges or embankments requires permissions unobtainable in an academic timeline. The demo reduces to a sensor in a bucket of water.
4. **Power fails exactly when needed.** Disasters cause outages. The sensor most likely to go offline is the one inside the disaster zone.
5. **Calibration is unachievable.** Hobby sensors drift. An uncalibrated reading cannot justify a public evacuation order.

---

### SLIDE 12 — OPTION A: WHY IT FAILS (Part 2 of 2)

Title: **Ten Reasons the Hardware Approach Cannot Work — 6 to 10**

6. **Maintenance burden.** Weatherproofing, corrosion, debris blocking sensors, battery replacement, theft and vandalism.
7. **It duplicates national infrastructure — worse.** Meteorological radar networks, national seismic networks and Earth-observation satellites already exist, are rigorously calibrated, and publish free. Three hobby sensors add nothing.
8. **Demonstration risk.** A dry solder joint, a dead battery, no Wi-Fi, interference in the exam hall. Not reproducible on demand.
9. **Curriculum misalignment.** Soldering, circuit design and power management belong to Electronics. It displaces the Computer Science substance the project should demonstrate.
10. **It solves the wrong problem.** Detection is not the bottleneck. Adding a fourth-rate detector to a world with first-rate detectors saves nobody.

Bottom banner in bold: **The lives are lost between detection and action. That gap is entirely software.**

---

### SLIDE 13 — OPTION B: THE SOFTWARE APPROACH

Title: **Option B — Build the Layer That Is Actually Missing**

Central architecture diagram, left to right:

**INPUTS** (two stacked groups)
- *Institutional:* Satellites · Seismic networks · Weather models · Global alert feeds
- *Human:* Citizen smartphones — GPS, camera, human judgment

**→ PLATFORM** (vertical stack)
Ingestion → Correlation → Severity scoring → Human verification → Geofenced alerting → Coordination

**→ USERS**
Citizens · Responders · Coordinators · Administrators

---

### SLIDE 14 — OPTION B: THE ADVANTAGES

Title: **Why Software Wins on Every Criterion That Matters**

Icon grid of 6:
- 🌍 **Planetary coverage on day one** — every coordinate on Earth, zero marginal cost per city
- 🛰️ **Better sensors than we could ever build** — we consume agency-grade calibrated data
- 📱 **Every citizen becomes a sensor** — GPS, camera, network **and human judgment**
- 🎯 **It attacks the real bottleneck** — verification, targeting, delivery, coordination
- 💰 **Zero recurring cost** — free-tier cloud, keyless public APIs
- 🎓 **Full CS curriculum** — databases, geospatial queries, networks, algorithms, security, cloud

---

### SLIDE 15 — THE DECIDING ARGUMENT

Title: **No Sensor Can Report This**

Full-slide centred pull quote, large type:

> **"The embankment on the east side has cracked, water is coming through, and about forty families are still inside."**

Below, three short lines:
- A smartphone has GPS, a camera, a network and a battery
- It also has **a human being attached to it who can interpret what they are seeing**
- Hundreds of millions are already deployed, powered and maintained — **at zero cost to this project**

---

### SLIDE 16 — THE DECISION MATRIX

Title: **Fifteen Criteria, Weighted. The Result Is Not Close.**

Comparison table with three columns — Criterion / Hardware / Software — using a visual rating (filled vs empty blocks, or red vs green bars):

| Criterion | Hardware | Software |
|---|---|---|
| Geographic coverage | Very poor | Excellent |
| Cost to build and operate | Poor | Excellent |
| Scalability | Very poor | Excellent |
| Real-world deployability | Very poor | Excellent |
| Addresses the identified problem | Poor | Excellent |
| Reliability of demonstration | Poor | Excellent |
| Data accuracy and credibility | Poor | Excellent |
| CSE curriculum alignment | Poor | Excellent |
| Resilience during a real disaster | Poor | Good |
| Originality of physical measurement | Excellent | Poor |

Two large stat callouts side by side:
**HARDWARE — 37%** (red) · **SOFTWARE — 93%** (green)

Footer: *The single criterion hardware wins carries the lowest weight — because original measurement is not the problem this project exists to solve.*

---

### SLIDE 17 — DECISION AND SENSING LAYERS

Title: **Decision: A Fully Software-Based Platform**

Top banner: **This project contains no hardware at any stage. None is needed — the sensing already exists.**

Two large cards side by side:

**LAYER 1 — Institutional Instrumentation (wide)**
Earth-observation satellites · seismic networks · Doppler radar · weather models. Decades of calibration, global continuous coverage, **published openly and free**. We operate a research-grade sensor network at zero cost.

**LAYER 2 — Citizen Smartphones (deep)**
GPS · camera · network · power · **a human observer capable of judgment**. Supplies exactly what satellites cannot: the hyper-local ground truth of one street, one building, one embankment.

Footer: **Global coverage from one. Street-level resolution from the other. Nothing to manufacture, install, power or calibrate.**

---

### SLIDE 18 — SYSTEM ARCHITECTURE

Title: **Eight Components, One Pipeline**

Vertical numbered flow diagram:
1. **Ingestion worker** — polls public feeds on schedule, normalises, rejects duplicates
2. **Incident engine** — correlates related signals, scores severity, enforces the state machine
3. **Geofence matcher** — resolves exactly who is inside an affected area
4. **Alert dispatcher** — queued multi-channel fan-out with retry and escalation
5. **Citizen PWA** — SOS reporting, offline queue, safe check-in
6. **Responder console** — assignments, status tracking, hazard-aware routing
7. **Admin & analytics** — user management, feed health, audit log, metrics
8. **Realtime gateway** — live push to every connected dashboard

---

### SLIDE 19 — HOW IT WORKS: DETECTED FROM OFFICIAL DATA

Title: **Scenario 1 — A Flood, Detected Automatically**

Timeline layout with timestamps:
- **09:04** — Weather feed reports 118 mm rainfall in Zone 4. Ingested automatically; no human involved.
- **09:04** — Rules fire: threshold exceeded, no matching open incident → **new incident created**, severity **78/100 → WARNING**
- **09:04** — Appears instantly on the coordinator's dashboard. No page refresh — the live connection pushed it.
- **09:06** — Coordinator reviews and clicks **Verify**. Only now may the public be alerted.
- **09:07** — Coordinator draws the alert zone on the map. Preview: **"will reach approximately 1,240 people"**
- **09:07** — 1,240 phones alerted. **Someone 40 km away receives nothing.**
- **09:08** — Live delivery counter: **Delivered 1,198 · Pending 25 · Failed 17**

---

### SLIDE 20 — HOW IT WORKS: REPORTED BY A CITIZEN

Title: **Scenario 2 — When the Public Sees It First**

Timeline layout:
- **09:15** — A resident sees a wall collapse. Presses SOS, selects hazard type, GPS captured automatically, adds a photo. **Eight seconds.**
- **09:15** — Incident created but marked **UNVERIFIED** — one report from one person is not evidence enough to alert a population.
- **09:17** — Two more independent reports arrive from the same area. The system **merges all three into one incident** and raises confidence.
- **09:18** — Rises in the priority queue. Coordinator views the photographs, verifies, assigns **Rescue Team 3**.

Highlighted callout box:
**In a real disaster, one flood may generate 500 reports. The control room must see one incident supported by 500 reports — not 500 incidents. Without this, situational awareness collapses exactly when it is needed most.**

---

### SLIDE 21 — THE FEATURE THAT MATTERS MOST

Title: **It Keeps Working When the Network Does Not**

Four-step horizontal flow with icons:
1. 📵 **Network fails.** A woman is trapped. The tower has lost power; data is dead.
2. 🆘 **She reports anyway.** The app is already on her phone. She presses SOS. It confirms: *"Saved — will send automatically when connectivity returns."*
3. 📡 **Signal returns 19 minutes later.** She does nothing. She does not even open the app.
4. ✅ **It sends itself.** Background sync transmits the report — timestamped **09:32**, the moment of the emergency, not **09:51** when it was transmitted. The control room knows how long she has been waiting.

Footer callout: **Demonstrated live: enable aeroplane mode → submit a report → disable aeroplane mode → watch it appear on the control-room screen.**

---

### SLIDE 22 — THE PORTAL

Title: **One Platform. Four Roles. About 33 Screens.**

Four-column layout, one icon card per role:

**👤 CITIZEN** — SOS reporting · live incident map · alerts inbox · shelter finder · "I'm safe" check-in · offline queue

**🚑 RESPONDER** — assigned tasks with SLA timers · incident detail with photos · hazard-aware route · field status updates

**🏢 COORDINATOR** — live command dashboard · incident verification · alert composer with map-drawn geofence · delivery tracking · team and resource dispatch

**🛡️ ADMINISTRATOR** — user and role management · data-source health monitoring · analytics · immutable audit log · scenario simulator

Footer: *One codebase, one login, four role-based interfaces, built on roughly 30 shared components.*

---

### SLIDE 23 — THE CONTROL ROOM

Title: **The Coordinator's Command Dashboard**

Describe a three-panel control-room interface mockup:
- **Left panel** — live incident queue, sorted by severity, colour-coded red/orange/yellow, updating in real time
- **Centre panel** — live map showing incident clusters, responder team positions, shelters, and roads marked as blocked
- **Right panel** — selected incident detail with severity score, report count, citizen photographs, and four action buttons: **Verify · Alert · Assign · Reject**

Footer strip: *Teams: 8 available, 4 deployed · Alerts today: 4 sent, 96% delivered*

Note: **Everything updates live over a WebSocket connection. The operator never refreshes the page.**

---

### SLIDE 24 — TECHNOLOGY STACK

Title: **TypeScript End to End. Zero Hardware. Zero Cost.**

Layered diagram or 4-column table:

| Layer | Technology |
|---|---|
| **Frontend** | React + TypeScript, Vite, Tailwind CSS, Leaflet maps, Progressive Web App with service worker |
| **Backend** | Node.js + TypeScript (Express / NestJS) — REST API, ingestion adapters, rule engine, alert dispatch |
| **Database** | PostgreSQL + **PostGIS** — geospatial queries are the core of the system |
| **Platform services** | Supabase — authentication, row-level security, file storage, real-time streaming |
| **Offline** | IndexedDB + Service Worker + Background Sync API |

Callout: **One language across the entire stack — shared types and shared validation between client and server, so a data-model change becomes a compile error rather than a runtime failure.**

---

### SLIDE 25 — DATA SOURCES

Title: **Every Data Source Is Free. Most Need No API Key.**

Table with three columns — Source / Provides / Key Required:

| Source | Provides | Key |
|---|---|---|
| **USGS** | Global earthquakes, updated every minute | None |
| **Open-Meteo** | Rainfall, wind, temperature, forecasts — worldwide | None |
| **GDACS** | Global multi-hazard alerts with severity classification | None |
| **ReliefWeb (UN)** | Declared ongoing disasters and situation reports | None |
| **NASA FIRMS** | Satellite-detected active fires | Free key |
| **OpenStreetMap / Overpass** | Base maps, hospitals, shelters, road network | None |
| **Browser Geolocation** | The user's live coordinates | Built in |

Alert delivery row: **Web Push · Telegram Bot · Email — all free.** SMS has no free option, so it is implemented as a simulated gateway behind a swappable adapter.

Large stat callout: **TOTAL RECURRING COST — ₹0**

---

### SLIDE 26 — DEPLOYMENT

Title: **Four Cloud Platforms, All Free Tier**

Four connected boxes in a horizontal flow:

- **🐙 GITHUB** — source control, CI pipeline, **scheduled ingestion triggers**, keep-alive pings
- **▲ VERCEL** — React PWA, global CDN, automatic HTTPS, preview deploy per branch
- **🚂 RAILWAY / RENDER** — Node API, ingestion adapters, rule engine, alert dispatch workers
- **⚡ SUPABASE** — PostgreSQL + PostGIS, authentication, row-level security, storage, real-time

Below: **Scheduled GitHub Actions workflows trigger ingestion every 5 to 60 minutes depending on the source** — a free and reliable alternative to paid schedulers.

---

### SLIDE 27 — DESIGN CHALLENGES IDENTIFIED

Title: **Fifteen Problems Solved on Paper Before Writing Code**

Two-column table — Challenge / Mitigation — showing 6 of the 15:

| Challenge | Mitigation |
|---|---|
| False alarms would destroy public trust | Four severity tiers; **mandatory human verification** before any mass alert |
| One event produces hundreds of duplicate reports | Spatio-temporal correlation merges them into a single confidence-scored incident |
| Networks fail during the disaster itself | Offline-first PWA, local queue, background sync, idempotent report IDs |
| "Who is in this zone?" is slow across a large user table | PostGIS geography type with a GiST spatial index and `ST_DWithin` |
| SMS has no free option | Simulated gateway behind a swappable channel adapter, fully documented |
| No disaster will occur during evaluation | Scenario simulator drives the full pipeline end to end in 90 seconds |

Footer: *All fifteen are documented with Problem → Impact → Mitigation in the project report.*

---

### SLIDE 28 — HOW SUCCESS WILL BE MEASURED

Title: **The Project Will Be Judged on Numbers, Not Screenshots**

Table — Metric / Target:

| Metric | Target |
|---|---|
| Geofence query latency across 100,000 users | Under 500 ms |
| End-to-end alert latency, verification to device | Under 30 seconds |
| Alert delivery success rate | Above 95% |
| Real-time dashboard update latency | Under 2 seconds |
| Offline sync — 50 queued reports | 100% delivered, zero duplicates |
| Correlation accuracy across 200 synthetic reports | 90% correctly grouped |
| Concurrent load | 500 users, stable response time |
| Time to submit an emergency report | Under 10 seconds, 3 taps |

---

### SLIDE 29 — TIMELINE

Title: **Eight Phases, Each With a Demonstrable Gate**

Horizontal timeline:
- **Phase 0 — Design.** Report, SRS, diagrams · *Gate: guide approval*
- **Phase 1 — Foundation.** All four platforms connected, schema, authentication · *Gate: a logged-in user sees a map*
- **Phase 2 — Ingestion.** Four live data sources · *Gate: **real earthquakes appear on the map automatically***
- **Phase 3 — Intelligence.** Correlation, severity, verification, live dashboard · *Gate: one incident, many reports, updating live*
- **Phase 4 — Communication.** Geofencing, alert composer, multi-channel dispatch · *Gate: **drawing a zone alerts only the people inside it***
- **Phase 5 — Citizen app.** SOS, offline queue, background sync · *Gate: **the aeroplane-mode demonstration works***
- **Phase 6 — Coordination.** Responder portal, routing, resources · *Gate: full dispatch cycle*
- **Phase 7–8 — Admin, validation.** Analytics, audit, load testing · *Gate: all metrics recorded*

---

### SLIDE 30 — CLOSING

Title: **Monitoring on One Side. Communication on the Other.**

Five numbered steps, large and clean:
1. **Watch** — public hazard feeds and citizen reports, continuously and automatically
2. **Decide** — related signals merge into one incident with a transparent severity score
3. **Verify** — a human confirms, so false alarms never reach the public
4. **Warn** — only the people standing inside the danger zone, with delivery confirmed
5. **Coordinate** — teams assigned, routed around blocked roads, tracked to resolution, every action logged

Closing pull quote:
> **Detection is already solved. The last mile is not. The last mile is software — and that is where this project intervenes.**

---

### SLIDE 31 — THANK YOU

Title: **Thank You**

Subtitle: **Questions?**

Small footer: Project title · Department of Computer Science and Engineering · `[University Name]`

---

# PROMPT ENDS HERE

---

## Post-Generation Checklist

After Gamma produces the deck, verify:

- [ ] No slide suggests hardware, sensors or IoT are part of the **final** solution (only slides 8–12 and 16 mention hardware, always as the rejected option)
- [ ] No invented statistics, casualty figures or fake citations appear anywhere
- [ ] No mention of Python, FastAPI, machine learning, or team size
- [ ] Slides 11, 12 and 16 use **red** styling; slides 13–17 use **green**
- [ ] The 37% vs 93% figures render as large stat callouts on slide 16
- [ ] Every slide has speaker notes
- [ ] Placeholders (`[University Name]`, `[Guide Name]`, `[Academic Year]`) are filled in
- [ ] Export as **PowerPoint (.pptx)** via *Share → Export → PowerPoint*, then check the export in PowerPoint — Gamma's web layouts occasionally shift on export

## If You Need a Shorter Deck

For a 7–8 minute slot, cut to **18 slides** by removing: 4, 10, 14, 23, 27, 29 — and merging slides 11 and 12 into a single "Top 5 reasons hardware fails" slide.

## If Gamma Runs Out of Credits

Split into two generations:
- **Generation 1 (slides 1–17):** problem, gap analysis, objectives, and the full hardware-vs-software comparison
- **Generation 2 (slides 18–31):** architecture, working scenarios, portal, stack, deployment, metrics, timeline, closing

Then merge the two decks after exporting to PowerPoint.
