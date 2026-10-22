# Operational targets

This document gives the measurable targets for Kalkidan with Verdictan, and an owner for each.

Owners: **decided** on 2026-10-22. Dennis Otugo owns each target.
Target values: **proposed**. A product owner must approve each value.

## Telemetry and consent

Kalkidan sends no telemetry. The measurement hooks write only to
`<data folder>/diagnostics/measurements.json` on this computer.
Correlation IDs stay in memory. Diagnostics in the account menu shows all of it.
A support bundle includes a summary only when the user previews it and then exports it.
Fleet-wide numbers need an opt-in consent flow first. This change adds no such flow.

## Targets

| Measure                              | Definition                                                                                                    | Target (proposed)                                       | Local hook                                                              | Owner               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------- |
| Setup completion                     | Users who reach "signed in and runtime installed" in their first session, divided by users who start Kalkidan | ≥ 85% within 10 minutes                                 | `setup_completion_ms`: first start to sign-in with an installed runtime | Owner: Dennis Otugo |
| Time to the first successful request | First start to the first completed managed agent turn                                                         | p50 ≤ 5 min, p90 ≤ 15 min                               | `first_success_ms`                                                      | Owner: Dennis Otugo |
| Gateway overhead                     | Latency that the Verdictan gateway adds to a provider request, without provider time                          | p50 ≤ 25 ms, p95 ≤ 75 ms                                | None in Kalkidan. The gateway measures it.                              | Owner: Dennis Otugo |
| Stream responsiveness                | Turn start to the first streamed output that the user sees                                                    | p50 ≤ 2 s, p95 ≤ 5 s, plus provider time to first token | `stream_first_output_ms`                                                | Owner: Dennis Otugo |
| Recovery time                        | Lost broker connection to an account that is ready again                                                      | p95 ≤ 30 s, without user action                         | `recovery_ms`                                                           | Owner: Dennis Otugo |
| Crash rate                           | Crashes divided by sessions. A crash is an unclean stop, or a renderer or child process that crashed.         | ≤ 0.5% of sessions                                      | `sessions`, `crashes`                                                   | Owner: Dennis Otugo |
| Support incidents                    | Support tickets about setup, compatibility, or connection, per 100 weekly active users                        | ≤ 2 per week                                            | None. The support tracker counts them.                                  | Owner: Dennis Otugo |

Kalkidan also keeps `broker_request_ms` (each broker request) and `turn_ms` (each agent turn).
They help to explain the targets above.

## How to read the numbers

1. Open the account menu in the sidebar footer, and select Diagnostics. The "Local measurements" group shows the median and the
   95th percentile of each sample, with the counts of sessions, crashes, and turns.
2. To share them, select Preview in "Support bundle", read the bundle, and then select Export.
3. A team that collects bundles from consenting users can calculate the fleet targets.

The local values describe one computer. They are not fleet targets.
The SSH helper keeps its own values on each host. The desktop does not read them now.

## Gaps

- No fleet collection. Each fleet target needs an opt-in consent design before Kalkidan sends data.
- Gateway overhead needs a Verdictan gateway measurement that Kalkidan can read.
- Support incidents need a label in the support tracker.
