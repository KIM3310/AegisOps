# Search Growth Implementation - AegisOps

This repository now exposes a search-readable service surface in addition to the system architecture. The implementation is designed to support organic discovery, AI answer surfaces, and a free-to-paid service path without committing to paid infrastructure first.

## Implemented Surface

| Surface | Path |
| --- | --- |
| Machine-readable offer | [docs/service-offer.json](./service-offer.json) |
| Revenue architecture | [docs/revenue-architecture.md](./revenue-architecture.md) |
| System architecture | [docs/system-architecture.md](./system-architecture.md) |
| Public canonical URL | https://aegisops-ai-incident-doctor.pages.dev/ |
| Lead capture URL | mailto:ehdjs1351@gmail.com?subject=AegisOps%20private%20workspace&body=I%20am%20interested%20in%20team%20workspace%20for%20incident%20packs%2C%20replay%20history%2C%20export%20branding%2C%20and%20private%20provider%20keys%20for%20AegisOps. |

## Search Positioning

- Primary query: AegisOps incident replay copilot
- Secondary queries: AegisOps demo; AegisOps system architecture; AegisOps business tool; incident replay copilot with evidence capture, runbook drafting, and post-incident summary export service
- Public entry point: public replay demo plus downloadable incident-readout template
- Paid boundary: team workspace for incident packs, replay history, export branding, and private provider keys

## Conversion Boundary

The public surface stays crawlable and free. Paid value starts when a visitor wants private data, saved history, branded export packs, customer-specific connectors, recurring reports, or implementation support.

## Deployment Notes

- Keep the sitemap and robots file aligned with the final production domain.
- Submit the canonical URL and sitemap in Google Search Console after the domain is connected.
- Use a real checkout or lead-capture endpoint only after the free demo shows repeated intent.
- Keep exact free-tier quotas out of public promises because provider limits change.
