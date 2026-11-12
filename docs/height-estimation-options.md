# Free options for height from photos (#118)

Compared on 12 November 2026. The height always comes from the year's reference stick: 3 ft (91.44 cm) in 2025, 1 m in 2026. Every option saves an estimate only after an administrator has checked it, and never changes field measurements.

| Option | Cost | Accuracy | Hosting | Privacy | Limits |
|---|---|---|---|---|---|
| **Mark the points by hand** (chosen) | Free | As good as the person marking: about the width of a fingertip on the photo | None: built into TMS | Photos stay in TMS | About 15 seconds per photo |
| Google Gemini API, free tier | Free within limits | Unknown on our photos; general models place points roughly | None | **On the free tier, Google uses what is sent to improve its products.** This needs a privacy review and a Privacy page change. | Daily limits are not published and can change; paid use costs money |
| Self-hosted Florence-2 (Microsoft, open source) | Software free; a server with about 2 GB of memory costs about $25 a month (or a free Hugging Face Space that sleeps when idle) | Unknown: finds "stick" and "tree" boxes, but thin sticks and seedlings among weeds are hard. Needs a test on 30–50 of our photos. | A separate small server | Photos stay on our own server | Slow on a CPU (seconds per photo) |
| Self-hosted Grounding DINO + SAM (open source, Apache 2.0) | Software free; needs a GPU server, which is not free | Better than Florence-2 at finding named objects | A GPU server | Photos stay on our own server | Running cost |
| Claude (current paid option) | A few US cents per photo | Good at reading the scene; points still need checking | None | Photos go to Anthropic, under its API terms | Needs `ANTHROPIC_API_KEY` |

## Decision

- **Default: mark the points by hand.** It is free, needs no key or extra server, and sends photos nowhere. It is always available, including when an AI service is off or has reached a limit.
- **AI suggestions stay optional.** They are used only when `ANTHROPIC_API_KEY` is set. TMS never switches to a paid service on its own.
- **No free automatic option is reliable enough yet.** None has been tested on our own photos. Florence-2 is the best candidate. The next step is to run it on 30–50 photos from 2025 and 2026 and compare its heights with hand-marked ones. If its error is small, it can run on a small server we host.
- **The Gemini free tier is not used.** It would send project photos to Google for product improvement, which the Privacy page does not allow.
