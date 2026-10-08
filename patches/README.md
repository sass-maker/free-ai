# HTTP cache semantics security patch

GitHub's reviewed advisory GHSA-ch52-4w7c-c8xp has no upstream patched version. The published `http-cache-semantics@4.3.0` source also needs a behavior fix: client `max-stale` must not bypass non-storable or revalidation rules, or shared-cache restrictions for `proxy-revalidate` and `Set-Cookie`.

The existing Astro documentation build resolves the package through `site > astro > http-cache-semantics`. This workspace pins that existing build dependency to 4.3.0 and applies the reviewed local patch; no runtime dependency or vulnerability allowlist is added.

`pnpm test:dependency-security` runs 27 cache behavior cases against the package resolved through the `site` Astro install, including policy serialization and ordinary `max-stale` age and URL bounds. Keep the patch until upstream source itself passes the same behavior tests.
