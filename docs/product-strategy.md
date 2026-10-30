# Product strategy: make client work safer and easier to deliver

Research reviewed October 30, 2026. This is a product hypothesis and delivery plan, not evidence that customers will pay or that the current app is enterprise-ready.

## A focused buyer and problem

**Proposed customer:** a 10–50-person agency, consultancy, or other client-service team handling several confidential client projects. Their delivery lead needs to know who has access and what is at risk without chasing status updates across chat and files.

Evidence supporting the direction:

- CISA recommends granular, least-privilege access to limit unauthorized access to data and services. [3](https://www.cisa.gov/stopransomware/ransomware-guide)
- PMI reports that 31% of **complex projects** in its 2026 research failed to achieve the full scope of their intended benefits; this is not a failure rate for all projects. [2](https://www.pmi.org/about/press-media/2026/pulse-why-complex-projects-fail-best-practices-are-not-enough-system-thinking)
- The 2025 Professional Services Maturity Benchmark reports 73.4% of surveyed projects delivered on time and an 11.3% project overrun figure for 2024. These are survey benchmarks, not expected outcomes from Nexa. [3](https://get.kantata.com/rs/677-LEJ-696/images/2025-ps-maturity-benchmark.pdf)

**Positioning to test:** “Keep client work private and see delivery risks before they become client problems.” Privacy is a baseline, not a premium add-on. Competing products already offer far more functionality, so validating a distinctive workflow matters more than making unsupported savings claims.

## Pricing hypothesis, not a price commitment

Test an offer around **$249/month per workspace for up to 15 teammates**, with storage limits and actual packaging to be determined through interviews. This is only a hypothesis; billing, limits, and hosted provisioning are not implemented. For context, monday.com lists Pro at $19/seat/month billed annually and includes private boards, while Asana lists Starter at $10.99/user/month and Advanced at $24.99/user/month billed annually. Product scope, billing terms, and seat minimums differ, so these are comparisons rather than proof that Nexa can command the same price. [1](https://monday.com/pricing) [1](https://asana.com/pricing)

Talk to at least 10 delivery/operations leads about their last missed deadline and access-review process, then run three opt-in pilots before making a pricing decision. Record the number of projects reviewed, actual time spent preparing status updates, adoption over several weeks, objections, and willingness to pay. Do not promise specific ROI until it has been measured with customers. For Nexa’s own profitability, track subscription revenue against hosting, storage, support, payment fees, onboarding, acquisition costs, and churn; a list price alone is not profit.

## Proposed sequence: one feature and one reviewable PR at a time

1. **Private workspaces and project access — this change.** Close public signup after first-owner setup; enforce membership across project data and realtime; make access manageable in the UI. This addresses a trust blocker, not the whole enterprise-security requirement.
2. **Secure password lifecycle.** Add user-controlled password changes, a safe reset/invitation flow, and session invalidation. Today, a member manager chooses an initial password that the member cannot change, so the manager can impersonate that account. Treat this as a blocker for sensitive deployments, and split the work into reviewable features rather than a single large release.
3. **Project health and delivery risks.** For accessible projects, show overdue and upcoming tasks, unassigned work, and a clear route to resolve each item. Define date/time-zone semantics and permissions, support empty states, and test that aggregates cannot leak other projects. Validate whether a weekly review actually takes less time.
4. **Project budget and margin visibility.** Explore budget versus logged costs or hours, restricted to appropriately authorized roles. Confirm the source of rates, currency, and time entries before building; distinguish estimates from actuals and avoid presenting incomplete data as profit.
5. **Security and operational foundations.** Prioritize MFA, rate limiting, SSO/SCIM, a secure audit trail, reliable backups and restore tests, production-grade persistence/object storage, monitoring, and independent security review. Security controls should not be withheld behind a higher-priced tier. These are separate, scoped PRs rather than a claim of compliance.
6. **Self-service evaluation and billing.** Only after workspace isolation, provisioning, data lifecycle, support, and security are ready: offer a real trial, transparent pricing, billing, cancellation, and onboarding. Do not describe a demo as a production trial.

Each item should have a clear owner, success metric, tests, documented migration/limitations, and its own PR. Reprioritize after customer interviews instead of treating this list as a guaranteed revenue plan.
