# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and Fleet products that need an OpenAI-compatible API while preferring free provider allowances and explicit fallback behavior.

## Product Purpose

AI Gateway routes chat, embedding, and multimodal requests across free-tier providers through one compatible API and exposes health, model, and operator surfaces.

## Positioning

The gateway treats free compute as a routed pool with capability filtering, health-aware selection, and hard cost guardrails rather than promising a paid-provider service level.

## Capabilities and Constraints

- Best-effort free tier, not an SLA.
- Workers AI stays fallback-only under a 9,500-neuron daily cap.
- Mutation routes require project identity and fail closed on missing authentication.
- Production deployment is manual.

## Evidence on Hand

Verified milestones live in `docs/current/timeline.md`; current operating state lives in `STATUS.md`; public API documentation lives in `site/src/content/docs/`.

## Product Principles

- Prefer free compute without hiding provider limits.
- Fail closed when credentials or project identity are absent.
- Keep routing health and model availability observable.
- Record only verified releases in public history.

