# Request waterfall viewer

The locally bundled viewer is the exact version used by the supplied
`analysis/agent-latency-waterfall.html` and the approved activity prototype.

Source: https://persistent.oaistatic.com/plugins/visualize/widgets/1.0.59/waterfall.js

The application loads this pinned file locally, without a CDN or host API.
It uses the public `spans`, `durationMs`, `viewState`, `ready`, and
`viz-state-change` interfaces. Application telemetry and node details are
implemented separately and do not depend on the visualization host.
