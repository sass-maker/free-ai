# Free AI Marketing Event Map

## Landing Events

| Event | Where fired | Key properties |
| --- | --- | --- |
| `landing_viewed` | Marketing home page load | `path`, `utm_source`, `utm_medium`, `utm_campaign`, `referrer` |
| `hero_cta_clicked` | Primary CTA | `cta_label`, `destination`, `position`, `utm_campaign` |
| `docs_cta_clicked` | Docs link | `cta_label`, `source_section`, `destination` |
| `playground_cta_clicked` | Playground link | `cta_label`, `source_section`, `destination` |

## Demo Events

| Event | Where fired | Key properties |
| --- | --- | --- |
| `demo_started` | Playground/demo start | `demo_type`, `model_mode`, `provider_hint` |
| `demo_request_sent` | Demo request submission | `route`, `model`, `streaming`, `has_tools`, `has_json_mode` |
| `demo_response_received` | Demo success | `route`, `model`, `provider`, `latency_ms`, `fallback_count` |
| `demo_failed` | Demo failure | `route`, `model`, `error_class`, `provider`, `fallback_count` |

## Signup And Key Events

| Event | Where fired | Key properties |
| --- | --- | --- |
| `key_request_started` | API key request flow | `entry_point`, `utm_campaign` |
| `key_request_submitted` | API key form submit | `entry_point`, `intended_use`, `company_size` |
| `key_request_failed` | API key form failure | `error_class`, `field`, `entry_point` |
| `key_request_completed` | API key flow success | `entry_point`, `time_to_complete_ms` |

## Activation Events

| Event | Where fired | Key properties |
| --- | --- | --- |
| `first_api_request_received` | Gateway request handler | `route`, `model`, `project_id`, `sdk`, `utm_campaign` |
| `first_api_request_succeeded` | Gateway success response | `route`, `model`, `provider`, `latency_ms`, `fallback_count` |
| `first_api_request_failed` | Gateway failure response | `route`, `model`, `error_class`, `status_code` |
| `repeat_api_request_succeeded` | Later gateway success | `route`, `model`, `provider`, `request_count_bucket` |

## Review Notes

- Do not capture prompt text, API keys, raw responses, or personally identifying request content.
- Prefer aggregate project and route properties over user-level tracking.
- Keep UTM fields attached from landing through first successful request when possible.
- Use error classes instead of raw provider messages in analytics.
